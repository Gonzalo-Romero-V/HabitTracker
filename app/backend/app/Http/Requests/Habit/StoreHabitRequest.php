<?php

namespace App\Http\Requests\Habit;

use App\Rules\ValidRecurrenceRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreHabitRequest extends FormRequest
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
            'name' => ['required', 'string', 'max:255'],
            'category_id' => [
                'nullable',
                'integer',
                Rule::exists('categories', 'id')->where('user_id', $this->user()->id),
            ],
            'tracking_type' => ['required', Rule::in(['binary', 'quantifiable'])],
            'recurrence_type' => ['required', Rule::in(['fixed', 'quota'])],

            // Solo aplica si recurrence_type = fixed.
            'recurrence_rule' => [
                'required_if:recurrence_type,fixed',
                'prohibited_unless:recurrence_type,fixed',
                'string',
                new ValidRecurrenceRule,
            ],

            // Solo aplica si recurrence_type = quota.
            // Máximo 7: un hábito `quota` admite un solo HabitLog por día
            // (domain/habit-log.md), así que más de 7 por semana es inalcanzable.
            'quota_target' => [
                'required_if:recurrence_type,quota',
                'prohibited_unless:recurrence_type,quota',
                'integer',
                'min:1',
                'max:7',
            ],
            'quota_period' => [
                'required_if:recurrence_type,quota',
                'prohibited_unless:recurrence_type,quota',
                Rule::in(['week']),
            ],

            // Vigencia — opcional, default `indefinite` si se omite.
            'duration_type' => ['sometimes', Rule::in(['indefinite', 'end_date', 'duration_days'])],
            'duration_end_date' => [
                'required_if:duration_type,end_date',
                'prohibited_unless:duration_type,end_date',
                'date_format:Y-m-d',
                // "Hoy" del usuario, no del servidor (UTC).
                'after:'.$this->user()->today(),
            ],
            'duration_days' => [
                'required_if:duration_type,duration_days',
                'prohibited_unless:duration_type,duration_days',
                'integer',
                'min:1',
            ],

            // Solo aplica si tracking_type = quantifiable — al menos una métrica.
            'metrics' => [
                'required_if:tracking_type,quantifiable',
                'prohibited_unless:tracking_type,quantifiable',
                'array',
                'min:1',
            ],
            'metrics.*.name' => ['required_with:metrics', 'string', 'max:255'],
            'metrics.*.metric_type' => ['required_with:metrics', Rule::in(['count', 'duration', 'currency'])],
            'metrics.*.unit' => ['nullable', 'string', 'max:50'],
            'metrics.*.currency_code' => ['nullable', 'string', 'size:3'],
            // Meta estrictamente positiva: con 0 la métrica quedaba "cumplida"
            // sin registrar nada, y el índice fraccionario del heatmap la
            // contaba como 0% (división por cero evitada con 0).
            'metrics.*.target_value' => ['required_with:metrics', 'numeric', 'gt:0'],
        ];
    }
}
