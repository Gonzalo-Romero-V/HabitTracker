<?php

namespace App\Services;

use App\Models\Habit;
use Carbon\CarbonImmutable;
use RRule\RRule;

/**
 * Expande la `recurrence_rule` (RRULE, RFC5545) de un hábito `fixed` a
 * fechas concretas de ocurrencia — ver domain/habit.md y decisions/stack.md.
 */
class RecurrenceExpansionService
{
    /**
     * @return CarbonImmutable[] fechas de ocurrencia dentro de [$start, $end] (inclusive)
     */
    public function occurrencesBetween(Habit $habit, CarbonImmutable $start, CarbonImmutable $end): array
    {
        // DTSTART = día de creación en el timezone del usuario, nunca la
        // fecha UTC de created_at: un hábito creado de noche en
        // America/Guayaquil ya es "mañana" en UTC, y la regla excluía el
        // propio día de creación.
        $rrule = new RRule($habit->recurrence_rule, $habit->createdDateInUserTz());

        // Se pasan strings "Y-m-d" a propósito, no objetos DateTime con
        // timezone real: la librería ancla sus ocurrencias en el timezone
        // por default de PHP (UTC en esta app), así que comparar contra
        // instantes con el timezone real del usuario corre el límite del
        // rango varias horas — se probó y confirmó (excluía "hoy" e
        // incluía el día 1 del mes siguiente). $start/$end ya vienen
        // correctamente calculados en el timezone del usuario por el
        // caller; acá solo importa la fecha de calendario, no el instante.
        $occurrences = $rrule->getOccurrencesBetween(
            $start->toDateString(),
            $end->toDateString()
        );

        return array_map(
            fn ($date) => CarbonImmutable::parse($date->format('Y-m-d')),
            $occurrences
        );
    }

    /** ¿`$date` (Y-m-d) es una ocurrencia programada de este hábito `fixed`? */
    public function isOccurrence(Habit $habit, string $date): bool
    {
        $day = CarbonImmutable::parse($date);

        return $this->occurrencesBetween($habit, $day, $day) !== [];
    }
}
