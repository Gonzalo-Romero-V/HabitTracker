<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Habit\StoreHabitRequest;
use App\Http\Requests\Habit\UpdateHabitRequest;
use App\Http\Resources\HabitResource;
use App\Models\Habit;
use App\Services\HabitLifecycleService;
use App\Services\HabitOccurrenceMaterializer;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class HabitController extends Controller
{
    public function index(Request $request)
    {
        $habits = Habit::query()
            ->where('user_id', $request->user()->id)
            ->when($request->query('status'), fn ($query, $status) => $query->where('status', $status))
            ->with(['metrics.targetVersions', 'user'])
            // Orden estable obligatorio: sin ORDER BY, Postgres devuelve las
            // filas en orden físico, que cambia tras cada UPDATE (ej. el
            // recálculo de racha) — un hábito podía saltar entre páginas.
            ->orderBy('id')
            ->paginate(max(1, min((int) $request->query('per_page', 15), 100)));

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
        // "Hoy" del usuario, nunca Date::today() (UTC del servidor): una
        // versión de meta creada de noche en America/Guayaquil nacía con
        // fecha de mañana y el log de hoy no encontraba meta vigente.
        $today = $request->user()->today();

        $habit = DB::transaction(function () use ($request, $today) {
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
                $habit->recordQuotaVersion(
                    (int) $request->validated('quota_target'),
                    $request->validated('quota_period'),
                    $today,
                );
            }

            if ($habit->tracking_type === 'quantifiable') {
                foreach ($request->validated('metrics') as $metricInput) {
                    $metric = $habit->metrics()->create([
                        'name' => $metricInput['name'],
                        'metric_type' => $metricInput['metric_type'],
                        'unit' => $metricInput['unit'] ?? null,
                        'currency_code' => $metricInput['currency_code'] ?? null,
                    ]);

                    $metric->recordTargetVersion((float) $metricInput['target_value'], $today);
                }
            }

            if ($habit->recurrence_type === 'fixed') {
                $start = CarbonImmutable::parse($today);
                app(HabitOccurrenceMaterializer::class)
                    ->materializeRange($habit, $start, $start->endOfMonth());
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

    public function update(UpdateHabitRequest $request, Habit $habit, HabitLifecycleService $lifecycle)
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

        $scheduleChanged = $habit->isDirty(['recurrence_rule', 'duration_type', 'duration_end_date', 'duration_days']);

        DB::transaction(function () use ($request, $habit, $lifecycle, $scheduleChanged) {
            $habit->save();

            // Regla o vigencia nuevas afectan solo el futuro (domain/
            // habit.md): se regeneran las `pending` posteriores a hoy.
            if ($scheduleChanged) {
                $lifecycle->rescheduleFuture($habit);
            }

            if ($request->has('quota_target') && $request->has('quota_period')) {
                $habit->recordQuotaVersion(
                    (int) $request->validated('quota_target'),
                    $request->validated('quota_period'),
                    $request->user()->today(),
                );
            }
        });

        return (new HabitResource($habit->fresh('metrics.targetVersions')))
            ->additional(['mensaje' => 'Hábito actualizado correctamente.']);
    }

    public function archive(Request $request, Habit $habit, HabitLifecycleService $lifecycle)
    {
        $this->authorize('update', $habit);

        $lifecycle->archive($habit);

        return (new HabitResource($habit->fresh('metrics.targetVersions')))
            ->additional(['mensaje' => 'Hábito archivado correctamente.']);
    }

    public function unarchive(Request $request, Habit $habit, HabitLifecycleService $lifecycle)
    {
        $this->authorize('update', $habit);

        // Reactivar un hábito con la vigencia ya vencida duraría solo hasta
        // la próxima corrida del job de cierres, que lo volvería a archivar.
        $effectiveEndDate = $habit->effectiveEndDate();
        if ($effectiveEndDate !== null && $effectiveEndDate < $request->user()->today()) {
            throw ValidationException::withMessages([
                'duration_type' => ['La vigencia de este hábito ya terminó — actualízala antes de reactivarlo.'],
            ]);
        }

        $lifecycle->unarchive($habit);

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
