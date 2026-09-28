<?php

namespace App\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Habit extends Model
{
    protected $fillable = [
        'user_id',
        'category_id',
        'name',
        'tracking_type',
        'status',
        'recurrence_type',
        'recurrence_rule',
        'duration_type',
        'duration_end_date',
        'duration_days',
        'reactivated_on',
        'current_streak',
        'best_streak',
    ];

    protected function casts(): array
    {
        return [
            'duration_end_date' => 'date',
            'reactivated_on' => 'date',
        ];
    }

    /**
     * Defaults a nivel Eloquent, no solo de columna — Postgres no repuebla
     * los defaults de columna en el objeto en memoria tras el INSERT
     * (`RETURNING` en el driver de Laravel solo trae el id), así que sin
     * esto la respuesta de `store()` devolvía status/streaks en null.
     */
    protected $attributes = [
        'status' => 'active',
        'duration_type' => 'indefinite',
        'current_streak' => 0,
        'best_streak' => 0,
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function metrics(): HasMany
    {
        return $this->hasMany(HabitMetric::class);
    }

    public function quotaVersions(): HasMany
    {
        return $this->hasMany(HabitQuotaVersion::class);
    }

    public function logs(): HasMany
    {
        return $this->hasMany(HabitLog::class);
    }

    public function reminders(): HasMany
    {
        return $this->hasMany(Reminder::class);
    }

    public function monthlyStats(): HasMany
    {
        return $this->hasMany(HabitMonthlyStat::class);
    }

    public function currentQuotaVersion(): ?HabitQuotaVersion
    {
        return $this->quotaVersions()->orderByDesc('effective_from')->orderByDesc('id')->first();
    }

    /**
     * La versión de quota_target/quota_period vigente en una fecha dada —
     * nunca el valor actual, ver domain/habit.md → versionado.
     */
    public function quotaVersionEffectiveOn(string $date): ?HabitQuotaVersion
    {
        return $this->quotaVersions()
            ->whereDate('effective_from', '<=', $date)
            ->orderByDesc('effective_from')
            ->orderByDesc('id')
            ->first();
    }

    /**
     * Registra una nueva versión de la cuota vigente desde `$effectiveFrom`
     * (ver decisions/architecture.md → Versionado de metas). No inserta si
     * el valor no cambió, y si ya existe una versión con esa misma fecha la
     * reemplaza — dos filas con el mismo `effective_from` harían ambiguo
     * cuál está vigente ese día.
     */
    public function recordQuotaVersion(int $target, string $period, string $effectiveFrom): void
    {
        $current = $this->currentQuotaVersion();
        if ($current && $current->quota_target === $target && $current->quota_period === $period) {
            return;
        }

        $this->quotaVersions()->updateOrCreate(
            ['effective_from' => $effectiveFrom],
            ['quota_target' => $target, 'quota_period' => $period],
        );
    }

    /**
     * Fecha de calendario (Y-m-d) en que se creó el hábito, en el timezone
     * de su usuario dueño — nunca la fecha UTC de `created_at`. Se opera
     * con `setTimezone()` explícito, nunca `parse($valor, $tz)` (gotcha
     * documentado en decisions/architecture.md).
     */
    public function createdDateInUserTz(): string
    {
        return CarbonImmutable::parse($this->created_at)
            ->setTimezone($this->user->timezone)
            ->toDateString();
    }

    /**
     * Fecha (inclusive, string Y-m-d) del último día en que este hábito
     * está vigente — null si `indefinite` (nunca vence). Para
     * `duration_days = N`, son N días de calendario contando el día de
     * creación (en el timezone del usuario): último día = creación + N - 1.
     * Usada por HabitOccurrenceMaterializer (no generar ocurrencias más allá
     * de esta fecha) y por el job de cierres (auto-archivar al vencer).
     */
    public function effectiveEndDate(): ?string
    {
        if ($this->duration_type === 'end_date') {
            return $this->duration_end_date?->toDateString();
        }

        if ($this->duration_type === 'duration_days' && $this->duration_days) {
            return CarbonImmutable::parse($this->createdDateInUserTz())
                ->addDays($this->duration_days - 1)
                ->toDateString();
        }

        return null;
    }
}
