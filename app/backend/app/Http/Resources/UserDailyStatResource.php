<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class UserDailyStatResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'date' => $this->date->toDateString(),
            'due_count' => $this->due_count,
            'completed_count' => $this->completed_count,
            // Índice fraccionario para el score que colorea el heatmap — ver
            // UserDailyStatConsolidator::completionRatio(). completed_count
            // sigue siendo el conteo exacto todo-o-nada, sin cambios.
            'weighted_completed_count' => (float) $this->weighted_completed_count,
        ];
    }
}
