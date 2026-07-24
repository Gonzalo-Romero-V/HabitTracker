<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class HabitResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $quotaVersion = $this->recurrence_type === 'quota' ? $this->currentQuotaVersion() : null;

        return [
            'id' => $this->id,
            'category_id' => $this->category_id,
            'name' => $this->name,
            'tracking_type' => $this->tracking_type,
            'status' => $this->status,
            'recurrence_type' => $this->recurrence_type,
            'recurrence_rule' => $this->recurrence_type === 'fixed' ? $this->recurrence_rule : null,
            'quota_target' => $quotaVersion?->quota_target,
            'quota_period' => $quotaVersion?->quota_period,
            'duration_type' => $this->duration_type,
            'duration_end_date' => $this->duration_end_date?->toDateString(),
            'duration_days' => $this->duration_days,
            // Calculado: fecha en que el hábito deja de estar vigente, ya
            // resuelta en el timezone del usuario dueño — null si
            // `indefinite`. Evita que el frontend tenga que reimplementar
            // la aritmética de duration_days (ver Habit::effectiveEndDate()).
            'effective_end_date' => $this->effectiveEndDate(),
            'current_streak' => $this->current_streak,
            'best_streak' => $this->best_streak,
            'metrics' => HabitMetricResource::collection($this->whenLoaded('metrics')),
            'created_at' => $this->created_at,
        ];
    }
}
