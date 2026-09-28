<?php

namespace App\Services;

use App\Models\HabitLog;
use App\Models\User;
use App\Models\UserDailyStat;

/**
 * Consolida el agregado cross-hábito de un usuario para una fecha ya
 * cerrada — ver domain/user-daily-stat.md. "Debido" no distingue
 * recurrence_type: la sola existencia de un HabitLog esa fecha ya
 * significa que el hábito contaba para ese día (pre-generado en fixed,
 * creado al loguear en quota).
 */
class UserDailyStatConsolidator
{
    public function consolidate(User $user, string $date): void
    {
        // Día cerrado: cuenta también hábitos archivados después — sus logs
        // de ese día son historia real. Filtrar por `active` hacía que
        // archivar un hábito hoy reescribiera el agregado de ayer (este
        // consolidado se re-ejecuta cada 30 min).
        $counts = $this->countForDate($user, $date, onlyActiveHabits: false);

        // Sin nada debido ese día no hay fila: "sin dato" (gris) no es "0%"
        // (ver domain/user-daily-stat.md → Reglas de negocio).
        if ($counts['due_count'] === 0) {
            UserDailyStat::where('user_id', $user->id)->whereDate('date', $date)->delete();

            return;
        }

        UserDailyStat::updateOrCreate(
            ['user_id' => $user->id, 'date' => $date],
            $counts,
        );
    }

    /**
     * Mismo conteo que `consolidate()`, sin persistir — usado para el
     * día en curso (nunca tiene fila propia, ver domain/user-daily-stat.md).
     *
     * @return array{due_count: int, completed_count: int, weighted_completed_count: float}
     */
    public function countForDate(User $user, string $date, bool $onlyActiveHabits = true): array
    {
        $logs = HabitLog::query()
            ->whereHas('habit', fn ($q) => $q->where('user_id', $user->id)
                ->when($onlyActiveHabits, fn ($q) => $q->where('status', 'active')))
            ->where('occurrence_date', $date)
            ->with(['habit.metrics.targetVersions', 'metricLogs'])
            ->get();

        return [
            'due_count' => $logs->count(),
            'completed_count' => $logs->where('status', 'completed')->count(),
            'weighted_completed_count' => round((float) $logs->sum(fn ($log) => $this->completionRatio($log, $date)), 4),
        ];
    }

    /**
     * Qué tan cumplida quedó una ocurrencia concreta, en [0, 1] — a
     * diferencia de `status = 'completed'` (todo-o-nada), un hábito
     * cuantificable a medio camino de su meta cuenta parcialmente acá (ej.
     * 8 de 10 vasos de agua = 0.8). Pensado exclusivamente para el índice
     * que colorea el heatmap (Memento Mori/Calendario) — nunca para
     * streaks ni para `completed_count` (esos siguen siendo estrictamente
     * todo-o-nada, ver domain/habit.md).
     *
     * Un hábito con varias métricas promedia el ratio de cada una — mismo
     * criterio de "todas cuentan igual" que ya usa HabitCompletionService
     * para decidir completed/pending, solo que acá no se recorta a 0/1
     * hasta el final.
     */
    private function completionRatio(HabitLog $log, string $date): float
    {
        $habit = $log->habit;

        if ($habit->tracking_type === 'binary' || $habit->metrics->isEmpty()) {
            return $log->status === 'completed' ? 1.0 : 0.0;
        }

        $metricLogsByMetricId = $log->metricLogs->keyBy('habit_metric_id');

        $ratios = $habit->metrics->map(function ($metric) use ($metricLogsByMetricId, $date) {
            // Filtra en memoria sobre la relación ya cargada (targetVersions
            // viene eager-loaded) — nunca usar targetVersionEffectiveOn()
            // acá, que dispara una query nueva por métrica (N+1).
            $target = $metric->targetVersions
                ->filter(fn ($v) => $v->effective_from->toDateString() <= $date)
                ->sortByDesc('effective_from')
                ->first()?->target_value;

            if ($target === null || (float) $target <= 0) {
                return 0.0;
            }

            $value = (float) ($metricLogsByMetricId->get($metric->id)?->value ?? 0);

            return min(1.0, $value / (float) $target);
        });

        return (float) $ratios->avg();
    }
}
