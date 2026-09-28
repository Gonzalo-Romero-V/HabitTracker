<?php

namespace App\Console\Commands;

use App\Models\Habit;
use App\Models\HabitLog;
use App\Models\User;
use App\Services\HabitMonthlyStatConsolidator;
use App\Services\UserDailyStatConsolidator;
use Carbon\CarbonImmutable;
use Illuminate\Console\Command;

/**
 * Reconstruye las tablas-cache de estadísticas (user_daily_stats y
 * habit_monthly_stats) desde el historial de HabitLog — ver
 * domain/user-daily-stat.md y domain/habit-monthly-stat.md. Los jobs
 * programados solo consolidan "ayer" y "el mes recién cerrado", así que si
 * el scheduler estuvo caído quedan huecos que nunca se recuperan solos.
 * Idempotente (upsert): se puede correr cuantas veces haga falta. Solo
 * cubre días y meses ya cerrados — nunca hoy ni el mes en curso.
 */
class RebuildStats extends Command
{
    protected $signature = 'habits:rebuild-stats';

    protected $description = 'Reconstruye estadísticas diarias y mensuales ya cerradas desde el historial de registros';

    public function handle(UserDailyStatConsolidator $daily, HabitMonthlyStatConsolidator $monthly): int
    {
        $days = 0;
        $months = 0;

        User::query()->chunkById(100, function ($users) use ($daily, &$days) {
            foreach ($users as $user) {
                $first = HabitLog::query()
                    ->whereHas('habit', fn ($q) => $q->where('user_id', $user->id))
                    ->min('occurrence_date');

                if ($first === null) {
                    continue;
                }

                $yesterday = CarbonImmutable::parse($user->today())->subDay();
                for ($day = CarbonImmutable::parse($first); $day->lte($yesterday); $day = $day->addDay()) {
                    $daily->consolidate($user, $day->toDateString());
                    $days++;
                }
            }
        });

        Habit::query()->with('user')->chunkById(100, function ($habits) use ($monthly, &$months) {
            foreach ($habits as $habit) {
                $currentMonth = CarbonImmutable::parse($habit->user->today())->startOfMonth();

                for (
                    $month = CarbonImmutable::parse($habit->createdDateInUserTz())->startOfMonth();
                    $month->lt($currentMonth);
                    $month = $month->addMonthNoOverflow()
                ) {
                    $monthly->consolidate($habit, $month->year, $month->month);
                    $months++;
                }
            }
        });

        $this->info("Días consolidados: {$days}. Meses consolidados: {$months}.");

        return self::SUCCESS;
    }
}
