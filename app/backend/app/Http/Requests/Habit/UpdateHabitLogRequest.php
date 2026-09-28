<?php

namespace App\Http\Requests\Habit;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class UpdateHabitLogRequest extends FormRequest
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
            // Solo hábitos cuantificables, y cada métrica debe pertenecer a
            // ESTE hábito — sin esto se podían crear metric logs apuntando a
            // métricas de otro hábito (u otro usuario).
            'metrics' => [
                'sometimes',
                'array',
                Rule::prohibitedIf(fn () => $this->route('habit')->tracking_type !== 'quantifiable'),
            ],
            'metrics.*.habit_metric_id' => [
                'required_with:metrics',
                'integer',
                'distinct',
                Rule::exists('habit_metrics', 'id')->where('habit_id', $this->route('habit')->id),
            ],
            'metrics.*.value' => ['required_with:metrics', 'numeric', 'min:0'],
        ];
    }
}
