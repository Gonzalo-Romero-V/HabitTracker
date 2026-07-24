<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Habit\StoreHabitRequest;
use App\Http\Requests\Habit\UpdateHabitRequest;
use App\Http\Resources\HabitResource;
use App\Models\Habit;
use App\Services\HabitOccurrenceMaterializer;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;

class HabitController extends Controller
{
    public function index(Request $request)
    {
        $habits = Habit::query()
            ->where('user_id', $request->user()->id)
            ->when($request->query('status'), fn ($query, $status) => $query->where('status', $status))
            ->with(['metrics.targetVersions', 'user'])
            ->paginate();

        return response()->json([
            'data' => HabitResource::collection($habits->items()),
            'meta' => [
                'current_page' => $habits->currentPage(),
                'last_page' => $habits->lastPage(),
                'per_page' => $habits->perPage(),
                'total' => $habits->total(),
            ],
        ]);
    }

    public function store(StoreHabitRequest $request)
    {
        $timezone = $request->user()->timezone;

        $habit = DB::transaction(function () use ($request, $timezone) {
            $habit = Habit::create([
                'user_id' => $request->user()->id,
                'category_id' => $request->validated('category_id'),
                'name' => $request->validated('name'),
                'tracking_type' => $request->validated('tracking_type'),
                'recurrence_type' => $request->validated('recurrence_type'),
                'recurrence_rule' => $request->validated('recurrence_rule'),
                'duration_type' => $request->validated('duration_type', 'indefinite'),
                'duration_end_date' => $request->validated('duration_end_date'),
                'duration_days' => $request->validated('duration_days'),
            ]);

            if ($habit->recurrence_type === 'quota') {
                $habit->quotaVersions()->create([
                    'quota_target' => $request->validated('quota_target'),
                    'quota_period' => $request->validated('quota_period'),
                    'effective_from' => Date::today()->toDateString(),
                ]);
            }

            if ($habit->tracking_type === 'quantifiable') {
                foreach ($request->validated('metrics') as $metricInput) {
                    $metric = $habit->metrics()->create([
                        'name' => $metricInput['name'],
                        'metric_type' => $metricInput['metric_type'],
                        'unit' => $metricInput['unit'] ?? null,
                        'currency_code' => $metricInput['currency_code'] ?? null,
                    ]);

                    $metric->targetVersions()->create([
                        'target_value' => $metricInput['target_value'],
                        'effective_from' => Date::today()->toDateString(),
                    ]);
                }
            }

            if ($habit->recurrence_type === 'fixed') {
                $today = CarbonImmutable::now($timezone);
                app(HabitOccurrenceMaterializer::class)
                    ->materializeRange($habit, $today, $today->endOfMonth());
            }

            return $habit;
        });

        return (new HabitResource($habit->load('metrics.targetVersions')))
            ->additional(['mensaje' => 'Hábito creado correctamente.'])
            ->response()
            ->setStatusCode(201);
    }

    public function show(Request $request, Habit $habit)
    {
        $this->authorize('view', $habit);

        return new HabitResource($habit->load('metrics.targetVersions'));
    }

    public function update(UpdateHabitRequest $request, Habit $habit)
    {
        $this->authorize('update', $habit);

        $habit->fill($request->safe()->only(['name', 'category_id', 'recurrence_rule']));

        // duration_end_date/duration_days son mutuamente excluyentes según
        // duration_type (ver StoreHabitRequest) — al cambiar de tipo hay que
        // limpiar el campo que dejó de aplicar, o quedaría un valor viejo
        // huérfano en la fila (ej. pasar de end_date a indefinite sin
        // borrar duration_end_date).
        if ($request->has('duration_type')) {
            $habit->duration_type = $request->validated('duration_type');
            $habit->duration_end_date = $request->validated('duration_end_date');
            $habit->duration_days = $request->validated('duration_days');
        }

        $habit->save();

        if ($request->has('quota_target') && $request->has('quota_period')) {
            $habit->quotaVersions()->create([
                'quota_target' => $request->validated('quota_target'),
                'quota_period' => $request->validated('quota_period'),
                'effective_from' => Date::today()->toDateString(),
            ]);
        }

        return (new HabitResource($habit->fresh('metrics.targetVersions')))
            ->additional(['mensaje' => 'Hábito actualizado correctamente.']);
    }

    public function archive(Request $request, Habit $habit)
    {
        $this->authorize('update', $habit);

        $habit->update(['status' => 'archived']);

        return (new HabitResource($habit->fresh('metrics.targetVersions')))
            ->additional(['mensaje' => 'Hábito archivado correctamente.']);
    }

    public function unarchive(Request $request, Habit $habit)
    {
        $this->authorize('update', $habit);

        $habit->update(['status' => 'active']);

        return (new HabitResource($habit->fresh('metrics.targetVersions')))
            ->additional(['mensaje' => 'Hábito reactivado correctamente.']);
    }

    public function destroy(Request $request, Habit $habit)
    {
        $this->authorize('delete', $habit);

        $habit->delete();

        return response()->json([
            'data' => null,
            'mensaje' => 'Hábito eliminado correctamente.',
        ]);
    }
}
