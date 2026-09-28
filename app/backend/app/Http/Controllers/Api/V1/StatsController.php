<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Stats\DailyStatsRequest;
use App\Http\Resources\UserDailyStatResource;
use App\Models\Habit;
use App\Models\HabitLog;
use App\Models\HabitMonthlyStat;
use App\Models\UserDailyStat;
use App\Services\HabitOccurrenceMaterializer;
use App\Services\UserDailyStatConsolidator;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;

class StatsController extends Controller
{
    /**
     * Cuenta en vivo de hoy — nunca cacheada, el día en curso no tiene
     * fila en user_daily_stats (ver domain/user-daily-stat.md).
     */
    public function today(
        Request $request,
        UserDailyStatConsolidator $consolidator,
        HabitOccurrenceMaterializer $materializer,
    ) {
        $user = $request->user();
        $today = $user->today();

        // El conteo de "debidos" depende de que existan las filas de hoy —
        // no confiar solo en el job mensual (ver ensureToday()).
        Habit::query()
            ->where('user_id', $user->id)
            ->where('status', 'active')
            ->where('recurrence_type', 'fixed')
            ->with('user')
            ->get()
            ->each(fn (Habit $habit) => $materializer->ensureToday($habit));
        $counts = $consolidator->countForDate($user, $today);

        return response()->json([
            'data' => [
                'date' => $today,
                'due_count' => $counts['due_count'],
                'completed_count' => $counts['completed_count'],
                'weighted_completed_count' => $counts['weighted_completed_count'],
            ],
        ]);
    }

    /**
     * Fecha del HabitLog más antiguo del usuario — único consumidor:
     * Memento Mori, para saber desde qué semana deja de pintarse gris
     * "sin registro" (ver domain/user.md → Onboarding, intent/vision.md
     * → Memento Mori).
     */
    public function firstLogDate(Request $request)
    {
        $date = HabitLog::query()
            ->whereHas('habit', fn ($q) => $q->where('user_id', $request->user()->id))
            ->min('occurrence_date');

        return response()->json(['data' => ['date' => $date]]);
    }

    public function daily(DailyStatsRequest $request)
    {
        $stats = UserDailyStat::query()
            ->where('user_id', $request->user()->id)
            ->whereBetween('date', [$request->validated('from'), $request->validated('to')])
            ->orderBy('date')
            ->get();

        return UserDailyStatResource::collection($stats);
    }

    /**
     * Suma HabitMonthlyStat de todos los hábitos activos del usuario,
     * agrupado por año/mes — cross-hábito, no requiere tabla nueva.
     */
    public function monthlyTrend(Request $request)
    {
        $months = (int) $request->query('months', 6);
        $months = max(1, min(24, $months));

        $user = $request->user();
        $cutoff = CarbonImmutable::now($user->timezone)->subMonthsNoOverflow($months - 1)->startOfMonth();

        $rows = HabitMonthlyStat::query()
            ->whereHas('habit', fn ($q) => $q->where('user_id', $user->id))
            ->get(['year', 'month', 'completed_count', 'missed_count'])
            ->filter(fn ($row) => CarbonImmutable::create($row->year, $row->month, 1)->greaterThanOrEqualTo($cutoff))
            ->groupBy(fn ($row) => $row->year.'-'.$row->month)
            ->map(fn ($group) => [
                'year' => $group->first()->year,
                'month' => $group->first()->month,
                'completed_count' => $group->sum('completed_count'),
                'missed_count' => $group->sum('missed_count'),
            ])
            ->sortBy(fn ($row) => $row['year'].str_pad((string) $row['month'], 2, '0', STR_PAD_LEFT))
            ->values();

        return response()->json(['data' => $rows]);
    }
}
