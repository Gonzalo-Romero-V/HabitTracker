<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class HabitMetric extends Model
{
    protected $fillable = [
        'habit_id',
        'name',
        'metric_type',
        'unit',
        'currency_code',
    ];

    public function habit(): BelongsTo
    {
        return $this->belongsTo(Habit::class);
    }

    public function targetVersions(): HasMany
    {
        return $this->hasMany(HabitMetricTargetVersion::class);
    }

    public function metricLogs(): HasMany
    {
        return $this->hasMany(HabitMetricLog::class);
    }

    public function currentTargetVersion(): ?HabitMetricTargetVersion
    {
        return $this->targetVersions()->orderByDesc('effective_from')->orderByDesc('id')->first();
    }

    /**
     * La versión del target_value vigente en una fecha dada — nunca el
     * valor actual, ver domain/habit-metric.md → versionado.
     */
    public function targetVersionEffectiveOn(string $date): ?HabitMetricTargetVersion
    {
        return $this->targetVersions()
            ->whereDate('effective_from', '<=', $date)
            ->orderByDesc('effective_from')
            ->orderByDesc('id')
            ->first();
    }

    /**
     * Registra una nueva versión de `target_value` vigente desde
     * `$effectiveFrom` — mismo criterio que Habit::recordQuotaVersion(): no
     * inserta si el valor no cambió, y reemplaza la versión del mismo día
     * en vez de duplicar `effective_from`.
     */
    public function recordTargetVersion(float $targetValue, string $effectiveFrom): void
    {
        $current = $this->currentTargetVersion();
        if ($current && (float) $current->target_value === $targetValue) {
            return;
        }

        $this->targetVersions()->updateOrCreate(
            ['effective_from' => $effectiveFrom],
            ['target_value' => $targetValue],
        );
    }
}
