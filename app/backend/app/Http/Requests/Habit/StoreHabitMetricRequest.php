<?php

namespace App\Http\Requests\Habit;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

class StoreHabitMetricRequest extends FormRequest
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
            'metric_type' => ['required', Rule::in(['count', 'duration', 'currency'])],
            'unit' => ['nullable', 'string', 'max:50'],
            'currency_code' => ['nullable', 'string', 'size:3'],
            'target_value' => ['required', 'numeric', 'gt:0'],
        ];
    }
}
