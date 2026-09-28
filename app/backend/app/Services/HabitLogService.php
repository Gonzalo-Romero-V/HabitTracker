<?php

namespace App\Services;

use App\Models\Habit;
use App\Models\HabitLog;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Mutaciones de HabitLog (registrar, actualizar, deshacer) — ver
 * domain/habit-log.md. Concentra las reglas que el Controller no debe
 * decidir (decisions/architecture.md → Separación de responsabilidades):
 *
 * - Solo se registra la ocurrencia de HOY (timezone del usuario). `missed`
 *   es terminal y los períodos cerrados no se re-evalúan (intent/
 *   vision.md), así que el pasado es inmutable; el futuro todavía no
 *   ocurrió.
 * - En `fixed`, solo se registra un día programado por la RRULE.
 * - Deshacer en `fixed` revierte la ocurrencia a `pending` (la fila
 *   programada nunca desaparece — si desapareciera, el job de cierres no
 *   la marcaría `missed` y la racha quedaría protegida). En `quota` es un
 *   borrado físico: el log nace solo cuando el usuario registra algo.
 */
class HabitLogService
{
    public function __construct(
        private readonly HabitCompletionService $completion,
        private readonly StreakService $streaks,
        private readonly RecurrenceExpansionService $expansion,
    ) {}

    /**
     * @param  array<int, array{habit_metric_id: int, value: float}>  $metrics
     */
    public function create(Habit $habit, ?string $occurrenceDate, array $metrics): HabitLog
    {
        $today = $habit->user->today();
        $occurrenceDate ??= $today;

        $this->assertActive($habit);
        $this->assertToday($occurrenceDate, $today);

        if ($habit->logs()->where('occurrence_date', $occurrenceDate)->exists()) {
            throw ValidationException::withMessages([
                'occurrence_date' => ['Ya existe un registro para esa fecha — usa el endpoint de actualización.'],
            ]);
        }

        if ($habit->recurrence_type === 'fixed' && ! $this->expansion->isOccurrence($habit, $occurrenceDate)) {
            throw ValidationException::withMessages([
                'occurrence_date' => ['Este hábito no está programado para hoy.'],
            ]);
        }

        $effectiveEndDate = $habit->effectiveEndDate();
        if ($effectiveEndDate !== null && $occurrenceDate > $effectiveEndDate) {
            throw ValidationException::withMessages([
                'occurrence_date' => ['La vigencia de este hábito ya terminó.'],
            ]);
        }

        return DB::transaction(function () use ($habit, $occurrenceDate, $metrics) {
            $log = $habit->logs()->create([
                'occurrence_date' => $occurrenceDate,
                'status' => 'pending',
            ]);

            $this->saveAndEvaluate($habit, $log, $metrics);

            return $log;
        });
    }

    /**
     * @param  array<int, array{habit_metric_id: int, value: float}>  $metrics
     */
    public function update(Habit $habit, HabitLog $log, array $metrics): HabitLog
    {
        $this->assertActive($habit);
        $this->assertToday($log->occurrence_date->toDateString(), $habit->user->today());

        return DB::transaction(function () use ($habit, $log, $metrics) {
            $this->saveAndEvaluate($habit, $log, $metrics);

            return $log;
        });
    }

    /**
     * @return HabitLog|null el log revertido a `pending` (fixed), o null si
     *                       se borró físicamente (quota)
     */
    public function undo(Habit $habit, HabitLog $log): ?HabitLog
    {
        $this->assertActive($habit);
        $this->assertToday($log->occurrence_date->toDateString(), $habit->user->today());

        return DB::transaction(function () use ($habit, $log) {
            if ($habit->recurrence_type === 'fixed') {
                $log->metricLogs()->delete();
                $log->update(['status' => 'pending', 'completed_at' => null]);
                $result = $log;
            } else {
                $log->delete();
                $result = null;
            }

            $this->streaks->recalculate($habit);

            return $result;
        });
    }

    /**
     * @param  array<int, array{habit_metric_id: int, value: float}>  $metrics
     */
    private function saveAndEvaluate(Habit $habit, HabitLog $log, array $metrics): void
    {
        foreach ($metrics as $metricInput) {
            $log->metricLogs()->updateOrCreate(
                ['habit_metric_id' => $metricInput['habit_metric_id']],
                ['value' => $metricInput['value']],
            );
        }

        $this->completion->evaluate($log);
        $this->streaks->recalculate($habit);
    }

    private function assertActive(Habit $habit): void
    {
        if ($habit->status !== 'active') {
            throw ValidationException::withMessages([
                'habit' => ['No puedes registrar un hábito archivado — reactívalo primero.'],
            ]);
        }
    }

    private function assertToday(string $occurrenceDate, string $today): void
    {
        if ($occurrenceDate !== $today) {
            throw ValidationException::withMessages([
                'occurrence_date' => ['Solo puedes registrar o modificar el día de hoy.'],
            ]);
        }
    }
}
