<?php

namespace App\Http\Requests\Habit;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\ValidationException;

class UpdateHabitMetricRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'name' => ['sometimes', 'string', 'max:255'],
            // target_value: si viene, inserta una nueva versión (ver
            // architecture.md → Versionado de metas), nunca sobrescribe.
            'target_value' => ['sometimes', 'numeric', 'gt:0'],
        ];
    }

    /**
     * `metric_type` es inmutable (domain/habit-metric.md).
     */
    protected function prepareForValidation(): void
    {
        if ($this->has('metric_type')) {
            throw ValidationException::withMessages([
                'metric_type' => ['metric_type no se puede modificar después de crear la métrica.'],
            ]);
        }
    }
}
