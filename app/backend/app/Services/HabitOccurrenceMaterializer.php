<?php

namespace App\Services;

use App\Models\Habit;
use Carbon\CarbonImmutable;

/**
 * Materializa filas `pending` de HabitLog para un hábito `fixed` dentro de
 * un rango de fechas — ver domain/habit-log.md → Notas de implementación
 * (bootstrap síncrono al crear + job mensual usan el mismo mecanismo).
 * Idempotente: no duplica si la fila ya existe.
 */
class HabitOccurrenceMaterializer
{
    public function __construct(
        private readonly RecurrenceExpansionService $expansion,
    ) {}

    public function materializeRange(Habit $habit, CarbonImmutable $start, CarbonImmutable $end): int
    {
        // Nunca generar ocurrencias pending más allá de la vigencia del
        // hábito (ver Habit::effectiveEndDate() — null si `indefinite`).
        // Si la vigencia ya venció antes del inicio del rango pedido, no
        // hay nada que materializar acá — el job de cierres se encarga de
        // archivar el hábito por separado, esto solo evita crear "deuda"
        // de ocurrencias que nunca deberían haber existido.
        $effectiveEndDate = $habit->effectiveEndDate();
        if ($effectiveEndDate !== null) {
            $end = CarbonImmutable::parse(min($end->toDateString(), $effectiveEndDate));
            if ($end->toDateString() < $start->toDateString()) {
                return 0;
            }
        }

        $occurrences = $this->expansion->occurrencesBetween($habit, $start, $end);
        $created = 0;

        foreach ($occurrences as $date) {
            $log = $habit->logs()->firstOrCreate(
                ['occurrence_date' => $date->toDateString()],
                ['status' => 'pending'],
            );

            if ($log->wasRecentlyCreated) {
                $created++;
            }
        }

        return $created;
    }
}
