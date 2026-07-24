<?php

namespace App\Http\Requests\Habit;

use App\Rules\ValidRecurrenceRule;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class UpdateHabitRequest extends FormRequest
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
            'category_id' => [
                'sometimes',
                'nullable',
                'integer',
                Rule::exists('categories', 'id')->where('user_id', $this->user()->id),
            ],
            // recurrence_rule SÍ es editable (domain/habit.md): afecta
            // solo ocurrencias futuras, no versiona (a diferencia de
            // quota_target/target_value) — la próxima corrida del job
            // mensual ya usa el valor nuevo, el historial de HabitLog ya
            // generado queda intacto.
            'recurrence_rule' => ['sometimes', 'string', new ValidRecurrenceRule],
            // quota_target/quota_period: si vienen, inserta una nueva
            // versión (ver architecture.md → Versionado de metas). Ambos
            // se exigen juntos para no dejar una versión a medias.
            'quota_target' => ['sometimes', 'required_with:quota_period', 'integer', 'min:1'],
            'quota_period' => ['sometimes', 'required_with:quota_target', Rule::in(['week'])],

            // Vigencia — editable en cualquier momento (a diferencia de
            // tracking_type/recurrence_type): no versiona, el cambio aplica
            // desde ahora (mismo criterio que recurrence_rule).
            'duration_type' => ['sometimes', Rule::in(['indefinite', 'end_date', 'duration_days'])],
            'duration_end_date' => [
                'required_if:duration_type,end_date',
                'prohibited_unless:duration_type,end_date',
                'date',
                'after:today',
            ],
            'duration_days' => [
                'required_if:duration_type,duration_days',
                'prohibited_unless:duration_type,duration_days',
                'integer',
                'min:1',
            ],
        ];
    }

    /**
     * `tracking_type` y `recurrence_type` son inmutables (domain/habit.md)
     * — 422 explícito si el cliente intenta cambiarlos, en vez de
     * ignorarlos en silencio.
     */
    protected function prepareForValidation(): void
    {
        if ($this->has('tracking_type') || $this->has('recurrence_type')) {
            throw ValidationException::withMessages([
                'tracking_type' => ['tracking_type y recurrence_type no se pueden modificar después de crear el hábito.'],
            ]);
        }
    }
}
