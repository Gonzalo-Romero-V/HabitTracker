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
        'current_streak',
        'best_streak',
    ];

    protected function casts(): array
    {
        return [
            'duration_end_date' => 'date',
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
        return $this->quotaVersions()->orderByDesc('effective_from')->first();
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
            ->first();
    }

    /**
     * Fecha (inclusive, string Y-m-d) en que este hábito deja de estar
     * vigente — null si `indefinite` (nunca vence). Para `duration_days`,
     * se cuenta en días de calendario desde la fecha de creación del
     * hábito **en el timezone de su usuario dueño**, nunca UTC (mismo
     * principio que el resto del modelo, ver domain/habit.md). Se opera
     * siempre sobre `->toDateString()` (nunca sobre el objeto Carbon con
     * instante) para evitar el gotcha documentado en decisions/
     * architecture.md — `CarbonImmutable::parse($valor, $tz)` ignora $tz
     * cuando $valor ya es un Carbon con timezone propio. Usada por
     * HabitOccurrenceMaterializer (no generar ocurrencias más allá de esta
     * fecha) y por el job de cierres (auto-archivar al vencer).
     */
    public function effectiveEndDate(): ?string
    {
        if ($this->duration_type === 'end_date') {
            return $this->duration_end_date?->toDateString();
        }

        if ($this->duration_type === 'duration_days' && $this->duration_days) {
            $createdDateInUserTz = CarbonImmutable::parse($this->created_at)
                ->setTimezone($this->user->timezone)
                ->toDateString();

            return CarbonImmutable::parse($createdDateInUserTz)->addDays($this->duration_days)->toDateString();
        }

        return null;
    }
}
