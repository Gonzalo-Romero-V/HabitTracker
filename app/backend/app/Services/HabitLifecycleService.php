<?php

namespace App\Services;

use App\Models\Habit;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * Transiciones del ciclo de vida de un hábito que afectan a sus ocurrencias
 * materializadas — ver domain/habit.md (Estados) y domain/habit-log.md.
 *
 * - Archivar: el hueco archivado es neutro. Se borran las ocurrencias
 *   `pending` desde hoy en adelante (todavía no ocurrieron / no se
 *   cumplieron), así el job de cierres nunca las convierte en `missed`.
 * - Reactivar: se re-materializa desde hoy y `current_streak` arranca en 0
 *   (`reactivated_on`) — no es modo vacaciones (fuera de alcance, ver
 *   intent/vision.md). `best_streak` se conserva.
 * - Reprogramar: editar `recurrence_rule` o la vigencia afecta solo el
 *   futuro — se regeneran las `pending` posteriores a hoy; el historial y
 *   la ocurrencia de hoy quedan intactos.
 */
class HabitLifecycleService
{
    public function __construct(
        private readonly HabitOccurrenceMaterializer $materializer,
        private readonly StreakService $streaks,
    ) {}

    public function archive(Habit $habit): void
    {
        DB::transaction(function () use ($habit) {
            $habit->logs()
                ->where('status', 'pending')
                ->where('occurrence_date', '>=', $habit->user->today())
                ->delete();

            $habit->update(['status' => 'archived']);
        });
    }

    public function unarchive(Habit $habit): void
    {
        DB::transaction(function () use ($habit) {
            $habit->update([
                'status' => 'active',
                'reactivated_on' => $habit->user->today(),
            ]);

            $this->materializeFrom($habit, CarbonImmutable::parse($habit->user->today()));
            $this->streaks->recalculate($habit);
        });
    }

    /**
     * Regenera las ocurrencias `pending` posteriores a hoy según la regla y
     * vigencia actuales. No toca hoy ni el pasado.
     */
    public function rescheduleFuture(Habit $habit): void
    {
        if ($habit->recurrence_type !== 'fixed' || $habit->status !== 'active') {
            return;
        }

        $tomorrow = CarbonImmutable::parse($habit->user->today())->addDay();

        DB::transaction(function () use ($habit, $tomorrow) {
            $habit->logs()
                ->where('status', 'pending')
                ->where('occurrence_date', '>=', $tomorrow->toDateString())
                ->delete();

            $this->materializeFrom($habit, $tomorrow);
        });
    }

    /**
     * Materializa desde `$start` hasta fin de ese mes — y el mes siguiente
     * completo si hoy es el último día del mes, porque el job mensual de
     * esta noche puede haber corrido ya (ver MaterializeMonthlyHabits).
     */
    private function materializeFrom(Habit $habit, CarbonImmutable $start): void
    {
        if ($habit->recurrence_type !== 'fixed') {
            return;
        }

        $today = CarbonImmutable::parse($habit->user->today());
        $end = $today->day === $today->daysInMonth
            ? $today->addMonthNoOverflow()->endOfMonth()
            : $today->endOfMonth();

        if ($start->toDateString() > $end->toDateString()) {
            return;
        }

        $this->materializer->materializeRange($habit, $start, $end);
    }
}
