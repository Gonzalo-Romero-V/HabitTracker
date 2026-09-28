<?php

namespace App\Services;

use App\Models\HabitLog;

/**
 * Evalúa si un HabitLog pasa a `completed` — ver domain/habit.md y
 * domain/habit-metric-log.md. Nunca lo decide el Controller directamente
 * (decisions/architecture.md → Separación de responsabilidades).
 */
class HabitCompletionService
{
    public function evaluate(HabitLog $log): void
    {
        $habit = $log->habit;

        if ($habit->tracking_type === 'binary') {
            $log->update(['status' => 'completed', 'completed_at' => now()]);

            return;
        }

        $metricLogsByMetricId = $log->metricLogs()->get()->keyBy('habit_metric_id');
        $occurrenceDate = $log->occurrence_date->toDateString();

        // Sin métricas no hay meta que alcanzar — `every()` sobre una
        // colección vacía devolvería true y completaría el log con
        // cualquier PATCH.
        $allMet = $habit->metrics->isNotEmpty() && $habit->metrics->every(function ($metric) use ($metricLogsByMetricId, $occurrenceDate) {
            $metricLog = $metricLogsByMetricId->get($metric->id);
            if (! $metricLog) {
                return false;
            }

            $target = $metric->targetVersionEffectiveOn($occurrenceDate)?->target_value;

            return $target !== null && (float) $metricLog->value >= (float) $target;
        });

        if ($allMet) {
            $log->update(['status' => 'completed', 'completed_at' => now()]);
        } else {
            $log->update(['status' => 'pending', 'completed_at' => null]);
        }
    }
}
