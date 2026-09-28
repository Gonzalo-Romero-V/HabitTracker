<?php

namespace Tests\Feature;

use App\Models\Habit;
use App\Models\HabitLog;
use App\Models\HabitMonthlyStat;
use App\Models\User;
use App\Models\UserDailyStat;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * Regresiones de la auditoría de lógica de dominio (2026-09-28). Cada test
 * reproduce un bug concreto; ver vault/domain/habit.md y habit-log.md.
 */
class HabitLogicTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        $this->user = User::factory()->create(['timezone' => 'America/Guayaquil']);
        Sanctum::actingAs($this->user);
    }

    protected function tearDown(): void
    {
        CarbonImmutable::setTestNow();
        parent::tearDown();
    }

    /** Miércoles 9-sep-2026 20:30 en Guayaquil = jueves 10-sep 01:30 UTC. */
    private function freezeEvening(): void
    {
        CarbonImmutable::setTestNow('2026-09-10 01:30:00');
        \Illuminate\Support\Carbon::setTestNow('2026-09-10 01:30:00');
    }

    private function freezeAt(string $utc): void
    {
        CarbonImmutable::setTestNow($utc);
        \Illuminate\Support\Carbon::setTestNow($utc);
    }

    private function createHabit(array $overrides = []): Habit
    {
        $payload = array_merge([
            'name' => 'Meditar',
            'tracking_type' => 'binary',
            'recurrence_type' => 'fixed',
            'recurrence_rule' => 'FREQ=DAILY',
        ], $overrides);
        $payload = array_filter($payload, fn ($v) => $v !== null);

        $response = $this->postJson('/api/v1/habits', $payload)->assertCreated();

        return Habit::findOrFail($response->json('data.id'));
    }

    public function test_fixed_habit_created_in_the_evening_includes_today(): void
    {
        $this->freezeEvening();

        $habit = $this->createHabit();

        $this->assertTrue($habit->logs()->where('occurrence_date', '2026-09-09')->exists());
        $this->assertFalse($habit->logs()->where('occurrence_date', '<', '2026-09-09')->exists());
    }

    public function test_quantifiable_habit_created_in_the_evening_can_complete_today(): void
    {
        $this->freezeEvening();

        $habit = $this->createHabit([
            'tracking_type' => 'quantifiable',
            'metrics' => [['name' => 'Vasos', 'metric_type' => 'count', 'unit' => 'vasos', 'target_value' => 8]],
        ]);
        $log = $habit->logs()->where('occurrence_date', '2026-09-09')->firstOrFail();
        $metricId = $habit->metrics()->first()->id;

        $this->patchJson("/api/v1/habits/{$habit->id}/logs/{$log->id}", [
            'metrics' => [['habit_metric_id' => $metricId, 'value' => 8]],
        ])->assertOk()->assertJsonPath('data.status', 'completed');
    }

    public function test_quota_version_is_effective_from_the_users_today(): void
    {
        $this->freezeEvening();

        $habit = $this->createHabit([
            'recurrence_type' => 'quota',
            'recurrence_rule' => null,
            'quota_target' => 3,
            'quota_period' => 'week',
        ]);

        $this->assertSame('2026-09-09', $habit->quotaVersions()->first()->effective_from->toDateString());
    }

    public function test_only_today_can_be_logged(): void
    {
        $this->freezeAt('2026-09-09 15:00:00');
        $habit = $this->createHabit([
            'recurrence_type' => 'quota',
            'recurrence_rule' => null,
            'quota_target' => 3,
            'quota_period' => 'week',
        ]);

        $this->postJson("/api/v1/habits/{$habit->id}/logs", ['occurrence_date' => '2026-09-08'])->assertUnprocessable();
        $this->postJson("/api/v1/habits/{$habit->id}/logs", ['occurrence_date' => '2026-09-10'])->assertUnprocessable();
        $this->postJson("/api/v1/habits/{$habit->id}/logs", ['occurrence_date' => '2026-09-09'])->assertCreated();
    }

    public function test_missed_log_cannot_be_flipped_to_completed(): void
    {
        $this->freezeAt('2026-09-09 15:00:00');
        $habit = $this->createHabit();
        $this->freezeAt('2026-09-11 15:00:00');
        $this->artisan('habits:evaluate-closures')->assertSuccessful();

        $missed = $habit->logs()->where('occurrence_date', '2026-09-09')->firstOrFail();
        $this->assertSame('missed', $missed->status);

        $this->patchJson("/api/v1/habits/{$habit->id}/logs/{$missed->id}")->assertUnprocessable();
        $this->assertSame('missed', $missed->fresh()->status);
    }

    public function test_fixed_habit_cannot_log_an_unscheduled_day(): void
    {
        // Miércoles; el hábito solo es los lunes.
        $this->freezeAt('2026-09-09 15:00:00');
        $habit = $this->createHabit(['recurrence_rule' => 'FREQ=WEEKLY;BYDAY=MO']);

        $this->postJson("/api/v1/habits/{$habit->id}/logs")->assertUnprocessable();
    }

    public function test_undo_on_fixed_habit_reverts_to_pending_and_the_miss_still_counts(): void
    {
        $this->freezeAt('2026-09-09 15:00:00');
        $habit = $this->createHabit();
        $log = $habit->logs()->where('occurrence_date', '2026-09-09')->firstOrFail();

        $this->patchJson("/api/v1/habits/{$habit->id}/logs/{$log->id}")->assertOk();
        $this->deleteJson("/api/v1/habits/{$habit->id}/logs/{$log->id}")
            ->assertOk()
            ->assertJsonPath('data.status', 'pending');

        $this->assertDatabaseHas('habit_logs', ['id' => $log->id, 'status' => 'pending']);

        $this->freezeAt('2026-09-10 15:00:00');
        $this->artisan('habits:evaluate-closures')->assertSuccessful();
        $this->assertSame('missed', $log->fresh()->status);
    }

    public function test_undo_on_quota_habit_deletes_the_log(): void
    {
        $this->freezeAt('2026-09-09 15:00:00');
        $habit = $this->createHabit([
            'recurrence_type' => 'quota',
            'recurrence_rule' => null,
            'quota_target' => 3,
            'quota_period' => 'week',
        ]);
        $logId = $this->postJson("/api/v1/habits/{$habit->id}/logs")->assertCreated()->json('data.id');

        $this->deleteJson("/api/v1/habits/{$habit->id}/logs/{$logId}")->assertOk()->assertJsonPath('data', null);
        $this->assertDatabaseMissing('habit_logs', ['id' => $logId]);
    }

    public function test_metric_from_another_habit_is_rejected(): void
    {
        $this->freezeAt('2026-09-09 15:00:00');
        $metricPayload = ['tracking_type' => 'quantifiable', 'metrics' => [['name' => 'Km', 'metric_type' => 'count', 'target_value' => 5]]];
        $habitA = $this->createHabit($metricPayload);
        $habitB = $this->createHabit($metricPayload);
        $logA = $habitA->logs()->firstOrFail();

        $this->patchJson("/api/v1/habits/{$habitA->id}/logs/{$logA->id}", [
            'metrics' => [['habit_metric_id' => $habitB->metrics()->first()->id, 'value' => 10]],
        ])->assertUnprocessable();
    }

    public function test_metric_target_must_be_positive_and_last_metric_cannot_be_deleted(): void
    {
        $this->freezeAt('2026-09-09 15:00:00');
        $this->postJson('/api/v1/habits', [
            'name' => 'Agua', 'tracking_type' => 'quantifiable', 'recurrence_type' => 'fixed', 'recurrence_rule' => 'FREQ=DAILY',
            'metrics' => [['name' => 'Vasos', 'metric_type' => 'count', 'target_value' => 0]],
        ])->assertUnprocessable();

        $habit = $this->createHabit(['tracking_type' => 'quantifiable', 'metrics' => [['name' => 'Vasos', 'metric_type' => 'count', 'target_value' => 8]]]);
        $metric = $habit->metrics()->first();

        $this->deleteJson("/api/v1/habits/{$habit->id}/metrics/{$metric->id}")->assertUnprocessable();
    }

    public function test_archive_leaves_a_neutral_gap_and_unarchive_resets_current_streak(): void
    {
        $this->freezeAt('2026-09-07 15:00:00');
        $habit = $this->createHabit();
        foreach (['2026-09-07', '2026-09-08'] as $i => $day) {
            $this->freezeAt("{$day} 15:00:00");
            $log = $habit->logs()->where('occurrence_date', $day)->firstOrFail();
            $this->patchJson("/api/v1/habits/{$habit->id}/logs/{$log->id}")->assertOk();
        }
        $this->assertSame(2, $habit->fresh()->current_streak);

        $this->postJson("/api/v1/habits/{$habit->id}/archive")->assertOk();
        $this->assertFalse($habit->logs()->where('status', 'pending')->exists());

        $this->freezeAt('2026-09-12 15:00:00');
        $this->artisan('habits:evaluate-closures')->assertSuccessful();
        $this->assertFalse($habit->logs()->where('status', 'missed')->exists());

        $this->postJson("/api/v1/habits/{$habit->id}/unarchive")->assertOk()
            ->assertJsonPath('data.current_streak', 0)
            ->assertJsonPath('data.best_streak', 2);
        $this->assertTrue($habit->logs()->where('occurrence_date', '2026-09-12')->where('status', 'pending')->exists());
        $this->assertTrue($habit->logs()->where('occurrence_date', '2026-09-30')->exists());

        $log = $habit->logs()->where('occurrence_date', '2026-09-12')->firstOrFail();
        $this->patchJson("/api/v1/habits/{$habit->id}/logs/{$log->id}")->assertOk();
        $this->assertSame(1, $habit->fresh()->current_streak);
    }

    public function test_quota_current_week_counts_once_met_and_creation_week_never_breaks(): void
    {
        // Creado el sábado 5-sep (semana parcial, sin registrar nada).
        $this->freezeAt('2026-09-05 15:00:00');
        $habit = $this->createHabit([
            'recurrence_type' => 'quota',
            'recurrence_rule' => null,
            'quota_target' => 2,
            'quota_period' => 'week',
        ]);

        // Semana siguiente: cumple la cuota el martes (semana todavía en curso).
        foreach (['2026-09-07', '2026-09-08'] as $day) {
            $this->freezeAt("{$day} 15:00:00");
            $this->postJson("/api/v1/habits/{$habit->id}/logs")->assertCreated();
        }

        $this->assertSame(1, $habit->fresh()->current_streak);
    }

    public function test_repeated_edits_do_not_duplicate_versions(): void
    {
        $this->freezeAt('2026-09-09 15:00:00');
        $habit = $this->createHabit([
            'recurrence_type' => 'quota',
            'recurrence_rule' => null,
            'quota_target' => 3,
            'quota_period' => 'week',
        ]);

        $this->patchJson("/api/v1/habits/{$habit->id}", ['name' => 'X', 'quota_target' => 3, 'quota_period' => 'week'])->assertOk();
        $this->assertSame(1, $habit->quotaVersions()->count());

        $this->patchJson("/api/v1/habits/{$habit->id}", ['quota_target' => 4, 'quota_period' => 'week'])->assertOk();
        $this->patchJson("/api/v1/habits/{$habit->id}", ['quota_target' => 5, 'quota_period' => 'week'])->assertOk();
        $this->assertSame(1, $habit->quotaVersions()->count());
        $this->assertSame(5, $habit->currentQuotaVersion()->quota_target);

        $this->patchJson("/api/v1/habits/{$habit->id}", ['quota_target' => 8, 'quota_period' => 'week'])->assertUnprocessable();
    }

    public function test_duration_days_counts_the_creation_day(): void
    {
        $this->freezeAt('2026-09-09 15:00:00');
        $habit = $this->createHabit(['duration_type' => 'duration_days', 'duration_days' => 3]);

        $this->assertSame('2026-09-11', $habit->effectiveEndDate());
        $this->assertSame(3, $habit->logs()->count());
    }

    public function test_habit_ending_today_can_still_be_edited(): void
    {
        $this->freezeAt('2026-09-09 15:00:00');
        $habit = $this->createHabit(['duration_type' => 'end_date', 'duration_end_date' => '2026-09-10']);

        $this->freezeAt('2026-09-10 15:00:00');
        $this->patchJson("/api/v1/habits/{$habit->id}", [
            'name' => 'Renombrado', 'duration_type' => 'end_date', 'duration_end_date' => '2026-09-10',
        ])->assertOk();
    }

    public function test_changing_the_rule_regenerates_only_future_occurrences(): void
    {
        // Miércoles 9-sep; de diario a solo lunes.
        $this->freezeAt('2026-09-09 15:00:00');
        $habit = $this->createHabit();

        $this->patchJson("/api/v1/habits/{$habit->id}", ['recurrence_rule' => 'FREQ=WEEKLY;BYDAY=MO'])->assertOk();

        $this->assertTrue($habit->logs()->where('occurrence_date', '2026-09-09')->exists(), 'hoy no se toca');
        $future = $habit->logs()->where('occurrence_date', '>', '2026-09-09')->pluck('occurrence_date')
            ->map->toDateString()->all();
        $this->assertSame(['2026-09-14', '2026-09-21', '2026-09-28'], $future);
    }

    public function test_monthly_stats_are_consolidated_after_the_month_closes(): void
    {
        $this->freezeAt('2026-09-30 15:00:00');
        $habit = $this->createHabit();
        $log = $habit->logs()->where('occurrence_date', '2026-09-30')->firstOrFail();
        $this->patchJson("/api/v1/habits/{$habit->id}/logs/{$log->id}")->assertOk();

        // Último día: materializa octubre pero todavía no consolida.
        $this->artisan('habits:materialize-month')->assertSuccessful();
        $this->assertTrue($habit->logs()->where('occurrence_date', '2026-10-31')->exists());
        $this->assertSame(0, HabitMonthlyStat::count());

        // Día 1: consolida septiembre completo, incluido el último día.
        $this->freezeAt('2026-10-01 15:00:00');
        $this->artisan('habits:materialize-month')->assertSuccessful();
        $stat = HabitMonthlyStat::where(['habit_id' => $habit->id, 'year' => 2026, 'month' => 9])->firstOrFail();
        $this->assertSame(1, $stat->completed_count);
    }

    public function test_today_reappears_even_if_the_monthly_job_never_ran(): void
    {
        // Creado en agosto; el job del 31 nunca corrió (scheduler caído).
        $this->freezeAt('2026-08-20 15:00:00');
        $habit = $this->createHabit();
        $this->assertFalse($habit->logs()->where('occurrence_date', '>=', '2026-09-01')->exists());

        $this->freezeAt('2026-09-28 15:00:00');
        $this->getJson('/api/v1/stats/today')->assertOk()->assertJsonPath('data.due_count', 1);
        $this->getJson("/api/v1/habits/{$habit->id}/logs?from=2026-09-28&to=2026-09-28")
            ->assertOk()->assertJsonPath('data.0.occurrence_date', '2026-09-28');

        // El hueco del 1 al 27 queda neutro: nunca se rellena.
        $this->assertSame(0, $habit->logs()->whereBetween('occurrence_date', ['2026-09-01', '2026-09-27'])->count());
    }

    public function test_monthly_job_catches_up_the_current_month_on_any_day(): void
    {
        $this->freezeAt('2026-08-20 15:00:00');
        $habit = $this->createHabit();

        $this->freezeAt('2026-09-28 15:00:00');
        $this->artisan('habits:materialize-month')->assertSuccessful();

        $dates = $habit->logs()->where('occurrence_date', '>=', '2026-09-01')->pluck('occurrence_date')->map->toDateString()->all();
        $this->assertSame(['2026-09-28', '2026-09-29', '2026-09-30'], $dates);
    }

    public function test_stats_gaps_from_a_scheduler_outage_are_recovered(): void
    {
        $this->freezeAt('2026-08-20 15:00:00');
        $habit = $this->createHabit();
        $log = $habit->logs()->where('occurrence_date', '2026-08-20')->firstOrFail();
        $this->patchJson("/api/v1/habits/{$habit->id}/logs/{$log->id}")->assertOk();

        // Servidor sin scheduler hasta el 28-sep: agosto nunca se consolidó.
        $this->freezeAt('2026-09-28 15:00:00');
        $this->artisan('habits:materialize-month')->assertSuccessful();
        $this->assertTrue(HabitMonthlyStat::where(['habit_id' => $habit->id, 'year' => 2026, 'month' => 8])->exists());

        $this->artisan('habits:evaluate-closures')->assertSuccessful();
        $this->artisan('habits:rebuild-stats')->assertSuccessful();

        $aug20 = UserDailyStat::whereDate('date', '2026-08-20')->firstOrFail();
        $this->assertSame([1, 1], [$aug20->due_count, $aug20->completed_count]);
        $aug21 = UserDailyStat::whereDate('date', '2026-08-21')->firstOrFail();
        $this->assertSame([1, 0], [$aug21->due_count, $aug21->completed_count]);
        // Días de septiembre sin filas (el hueco neutro) no generan estadística.
        $this->assertFalse(UserDailyStat::whereDate('date', '2026-09-10')->exists());
    }

    public function test_habit_list_is_stably_ordered_across_pages(): void
    {
        $this->freezeAt('2026-09-09 15:00:00');
        $ids = collect(range(1, 17))->map(fn ($i) => $this->createHabit(['name' => "H{$i}"])->id);

        // Actualizar filas no debe cambiar qué hábito cae en cada página.
        Habit::whereIn('id', $ids->take(3))->update(['current_streak' => 5]);

        $page1 = $this->getJson('/api/v1/habits?page=1')->json('data.*.id');
        $page2 = $this->getJson('/api/v1/habits?page=2')->json('data.*.id');
        $this->assertSame($ids->all(), array_merge($page1, $page2));
    }

    public function test_days_with_nothing_due_have_no_daily_stat_row(): void
    {
        $this->freezeAt('2026-09-09 15:00:00');
        $this->artisan('habits:evaluate-closures')->assertSuccessful();

        $this->assertSame(0, UserDailyStat::count());
    }
}
