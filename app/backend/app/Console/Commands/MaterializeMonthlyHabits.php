<?php

namespace App\Console\Commands;

use App\Models\Habit;
use App\Services\HabitMonthlyStatConsolidator;
use App\Services\HabitOccurrenceMaterializer;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * Job mensual de hábitos (ver decisions/architecture.md → Jobs). Evaluado
 * por timezone de cada usuario, corre diariamente vía el Scheduler y es
 * idempotente:
 *   1. Materializa las ocurrencias `pending` de hábitos `fixed` activos
 *      desde hoy hasta fin de mes (y el mes siguiente completo si hoy es el
 *      último día, para que existan antes de que empiece el día 1). Correr
 *      todos los días, no solo a fin de mes, hace que el job se recupere
 *      solo si el scheduler estuvo caído.
 *   2. Consolida habit_monthly_stats del mes que acaba de cerrar, para
 *      todos los hábitos que existían ese mes (activos o archivados): el
 *      día 1 en cada corrida, y cualquier otro día si la fila todavía falta
 *      (servidor apagado el día 1). Consolidar el último día, con ese día
 *      todavía en curso, dejaba sus completados/fallados fuera del agregado.
 */
class MaterializeMonthlyHabits extends Command
{
    protected $signature = 'habits:materialize-month';

    protected $description = 'Materializa ocurrencias del próximo mes (fixed) y consolida stats del mes cerrado, por timezone de usuario';

    public function handle(
        HabitOccurrenceMaterializer $materializer,
        HabitMonthlyStatConsolidator $consolidator,
    ): int {
        $totalCreated = 0;
        $statsConsolidated = 0;

        Habit::query()
            ->with('user')
            ->chunkById(100, function ($habits) use ($materializer, $consolidator, &$totalCreated, &$statsConsolidated) {
                foreach ($habits as $habit) {
                    $today = CarbonImmutable::parse($habit->user->today());

                    if ($habit->status === 'active' && $habit->recurrence_type === 'fixed') {
                        // Desde hoy hasta fin de mes en CADA corrida (no solo
                        // el último día): si el scheduler estuvo caído, la
                        // próxima corrida recupera el mes en curso. Nunca
                        // rellena días pasados — quedan neutros.
                        $end = $today->day === $today->daysInMonth
                            ? $today->addMonthNoOverflow()->endOfMonth()
                            : $today->endOfMonth();
                        $totalCreated += $materializer->materializeRange($habit, $today, $end);
                    }

                    // El día 1 se re-consolida en cada corrida (idempotente:
                    // la última del día ya ve el último día del mes cerrado
                    // marcado missed/completed). Cualquier otro día, solo si
                    // falta la fila — si el servidor estuvo apagado el día 1,
                    // el mes se recupera en la siguiente corrida.
                    $closedMonth = $today->subMonthNoOverflow();
                    $missing = ! $habit->monthlyStats()
                        ->where('year', $closedMonth->year)
                        ->where('month', $closedMonth->month)
                        ->exists();

                    if ($today->day === 1 || $missing) {
                        if ($habit->createdDateInUserTz() <= $closedMonth->endOfMonth()->toDateString()) {
                            $consolidator->consolidate($habit, $closedMonth->year, $closedMonth->month);
                            $statsConsolidated++;
                        }
                    }
                }
            });

        $this->info("Ocurrencias nuevas: {$totalCreated}. Stats consolidados: {$statsConsolidated}.");

        return self::SUCCESS;
    }
}
