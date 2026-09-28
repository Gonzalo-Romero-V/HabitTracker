<?php

namespace App\Services;

use App\Models\Habit;
use Carbon\CarbonImmutable;

/**
 * Recalcula current_streak/best_streak de un hábito desde el historial
 * completo de HabitLog — nunca de agregados (ver domain/habit.md y
 * domain/habit-log.md → Reglas de negocio). Se invoca tras cualquier
 * mutación de HabitLog y desde el job de cierre de ocurrencias vencidas.
 */
class StreakService
{
    public function recalculate(Habit $habit): void
    {
        [$current, $best] = $habit->recurrence_type === 'quota'
            ? $this->calculateQuota($habit)
            : $this->calculateFixed($habit);

        $habit->update([
            'current_streak' => $current,
            'best_streak' => $best,
        ]);
    }

    /**
     * @return array{0: int, 1: int} [current, best]
     */
    private function calculateFixed(Habit $habit): array
    {
        $logs = $habit->logs()
            ->whereIn('status', ['completed', 'missed'])
            ->orderBy('occurrence_date')
            ->get(['occurrence_date', 'status']);

        $resetOn = $habit->reactivated_on?->toDateString();
        $running = 0;
        $best = 0;
        $crossedReset = $resetOn === null;

        foreach ($logs as $log) {
            // Reactivar un hábito archivado reinicia la racha actual (el
            // hueco archivado no es modo vacaciones, ver intent/vision.md).
            if (! $crossedReset && $log->occurrence_date->toDateString() >= $resetOn) {
                $running = 0;
                $crossedReset = true;
            }

            if ($log->status === 'completed') {
                $running++;
                $best = max($best, $running);
            } else {
                $running = 0;
            }
        }

        if (! $crossedReset) {
            $running = 0;
        }

        return [$running, $best];
    }

    /**
     * Unidad de evaluación: semana ISO en el timezone del usuario (ver
     * domain/habit-log.md → Streak en `quota`).
     *
     * - Semana cerrada: suma si alcanzó la cuota vigente, si no rompe.
     * - Semana en curso: suma apenas alcanza la cuota; nunca rompe antes de
     *   cerrar (mismo criterio que `fixed`, donde completar hoy suma ya).
     * - Semana de creación (o de reactivación): parcial por definición —
     *   suma si se cumplió, pero no rompe si no.
     *
     * @return array{0: int, 1: int} [current, best]
     */
    private function calculateQuota(Habit $habit): array
    {

        // occurrence_date es una fecha de calendario pura (columna `date`) —
        // no necesita conversión de timezone. created_at sí: se resuelve
        // con createdDateInUserTz() (setTimezone explícito, nunca
        // parse($valor, $tz), ver decisions/architecture.md).
        $completedCountsByWeek = [];
        foreach ($habit->logs()->where('status', 'completed')->get(['occurrence_date']) as $log) {
            $key = $log->occurrence_date->format('o-W');
            $completedCountsByWeek[$key] = ($completedCountsByWeek[$key] ?? 0) + 1;
        }

        $versions = $habit->quotaVersions()
            ->orderBy('effective_from')
            ->orderBy('id')
            ->get(['quota_target', 'effective_from']);

        $cursor = CarbonImmutable::parse($habit->createdDateInUserTz())->startOfWeek(CarbonImmutable::MONDAY);
        // Todas las semanas se construyen desde strings Y-m-d (mismo
        // timezone por default), nunca mezclando un instante en el timezone
        // del usuario con uno en UTC — equalTo()/lte() compararían instantes
        // desfasados por el offset.
        $currentWeekStart = CarbonImmutable::parse($habit->user->today())->startOfWeek(CarbonImmutable::MONDAY);
        $resetWeekStart = $habit->reactivated_on
            ? CarbonImmutable::parse($habit->reactivated_on->toDateString())->startOfWeek(CarbonImmutable::MONDAY)
            : null;

        $running = 0;
        $best = 0;
        $isFirstWeek = true;

        while ($cursor->lte($currentWeekStart)) {
            $isResetWeek = $resetWeekStart !== null && $cursor->equalTo($resetWeekStart);
            if ($isResetWeek) {
                $running = 0;
            }

            $target = $this->quotaTargetForWeek($versions, $cursor);

            if ($target !== null) {
                $count = $completedCountsByWeek[$cursor->format('o-W')] ?? 0;
                $isPartialWeek = $isFirstWeek || $isResetWeek || $cursor->equalTo($currentWeekStart);

                if ($count >= $target) {
                    $running++;
                    $best = max($best, $running);
                } elseif (! $isPartialWeek) {
                    $running = 0;
                }
            }

            $isFirstWeek = false;
            $cursor = $cursor->addWeek();
        }

        return [$running, $best];
    }

    /**
     * Cuota vigente al inicio de la semana; si la primera versión nació a
     * mitad de semana (semana de creación), la vigente al final de ella.
     *
     * @param  \Illuminate\Support\Collection<int, \App\Models\HabitQuotaVersion>  $versions  ascendente por effective_from
     */
    private function quotaTargetForWeek($versions, CarbonImmutable $weekStart): ?int
    {
        $weekStartDate = $weekStart->toDateString();
        $weekEndDate = $weekStart->addDays(6)->toDateString();

        $atStart = $versions->last(fn ($v) => $v->effective_from->toDateString() <= $weekStartDate);
        $version = $atStart ?? $versions->last(fn ($v) => $v->effective_from->toDateString() <= $weekEndDate);

        return $version?->quota_target;
    }
}
