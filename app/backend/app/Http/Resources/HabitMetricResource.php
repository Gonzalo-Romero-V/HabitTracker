<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class HabitMetricResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'habit_id' => $this->habit_id,
            'name' => $this->name,
            'metric_type' => $this->metric_type,
            'unit' => $this->unit,
            'currency_code' => $this->currency_code,
            'target_value' => $this->currentTargetVersion()?->target_value,
            // Historial completo de versiones — necesario para dibujar la
            // meta como función escalonada a través del tiempo (ver
            // domain/habit-metric.md → versionado; nunca una línea
            // horizontal fija con el valor vigente actual). Volumen bajo
            // por diseño (una fila por cambio de meta, no por día).
            'target_versions' => $this->targetVersions->sortBy('effective_from')->values()->map(fn ($v) => [
                'target_value' => $v->target_value,
                'effective_from' => $v->effective_from->toDateString(),
            ]),
            'created_at' => $this->created_at,
        ];
    }
}
