<?php

namespace App\Console\Commands;

use App\Models\Habit;
use App\Models\HabitLog;
use App\Models\User;
use App\Services\StreakService;
use App\Services\UserDailyStatConsolidator;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * Evalúa cierres de tiempo por timezone de usuario (ver decisions/
 * architecture.md → Jobs). Pensado para correr frecuente vía el
 * Scheduler (cada 15-60 min):
 *   1. `fixed`: ocurrencias `pending` cuyo día ya cerró → `missed`.
 *   2. `quota`: recalcula streak de todos los hábitos activos — el
 *      StreakService ya solo evalúa semanas completamente cerradas, así
 *      que re-correr esto de más es seguro (idempotente), simplemente no
 *      encuentra semanas nuevas que cerrar.
 *   3. Consolida user_daily_stats de "ayer" (en timezone de cada
 *      usuario) — ver domain/user-daily-stat.md. Idempotente (upsert).
 *   4. Auto-archiva hábitos cuya vigencia (duration_type end_date/
 *      duration_days) ya venció — reusa el estado `archived` existente
 *      (mismo efecto que archivar a mano: deja de generar ocurrencias,
 *      deja de disparar recordatorios, sale de "Hoy") en vez de introducir
 *      un estado nuevo. Idempotente: un hábito ya archivado no vuelve a
 *      procesarse (el query solo trae `active`).
 */
class EvaluateHabitClosures extends Command
{
    protected $signature = 'habits:evaluate-closures';

    protected $description = 'Marca ocurrencias fixed vencidas como missed, recalcula streaks y consolida stats diarios';

    public function handle(StreakService $streaks, UserDailyStatConsolidator $dailyStats): int
    {
        $missedCount = 0;
        $affectedFixedHabits = [];

        HabitLog::query()
            ->where('status', 'pending')
            ->whereHas('habit', fn ($q) => $q->where('recurrence_type', 'fixed'))
            ->with('habit.user')
            ->chunkById(200, function ($logs) use (&$missedCount, &$affectedFixedHabits) {
                foreach ($logs as $log) {
                    $timezone = $log->habit->user->timezone;
                    $todayInTz = CarbonImmutable::now($timezone)->toDateString();

                    if ($log->occurrence_date->toDateString() < $todayInTz) {
                        $log->update(['status' => 'missed']);
                        $affectedFixedHabits[$log->habit_id] = $log->habit;
                        $missedCount++;
                    }
                }
            });

        foreach ($affectedFixedHabits as $habit) {
            $streaks->recalculate($habit);
        }

        $quotaHabitsCount = 0;
        Habit::query()
            ->where('status', 'active')
            ->where('recurrence_type', 'quota')
            ->chunkById(200, function ($habits) use ($streaks, &$quotaHabitsCount) {
                foreach ($habits as $habit) {
                    $streaks->recalculate($habit);
                    $quotaHabitsCount++;
                }
            });

        $usersProcessed = 0;
        User::query()->chunkById(200, function ($users) use ($dailyStats, &$usersProcessed) {
            foreach ($users as $user) {
                $yesterday = CarbonImmutable::now($user->timezone)->subDay()->toDateString();
                $dailyStats->consolidate($user, $yesterday);
                $usersProcessed++;
            }
        });

        $expiredCount = 0;
        Habit::query()
            ->where('status', 'active')
            ->where('duration_type', '!=', 'indefinite')
            ->with('user')
            ->chunkById(200, function ($habits) use (&$expiredCount) {
                foreach ($habits as $habit) {
                    $effectiveEndDate = $habit->effectiveEndDate();
                    $todayInTz = CarbonImmutable::now($habit->user->timezone)->toDateString();

                    if ($effectiveEndDate !== null && $effectiveEndDate < $todayInTz) {
                        $habit->update(['status' => 'archived']);
                        $expiredCount++;
                    }
                }
            });

        $this->info("Ocurrencias marcadas missed: {$missedCount}. Hábitos quota re-evaluados: {$quotaHabitsCount}. Usuarios con stats diarios consolidados: {$usersProcessed}. Hábitos auto-archivados por vigencia vencida: {$expiredCount}.");

        return self::SUCCESS;
    }
}
