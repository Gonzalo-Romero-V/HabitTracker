<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\Habit\StoreHabitLogRequest;
use App\Http\Requests\Habit\UpdateHabitLogRequest;
use App\Http\Resources\HabitLogResource;
use App\Models\Habit;
use App\Models\HabitLog;
use App\Services\HabitLogService;
use App\Services\HabitOccurrenceMaterializer;
use Illuminate\Http\Request;

class HabitLogController extends Controller
{
    public function index(Request $request, Habit $habit, HabitOccurrenceMaterializer $materializer)
    {
        $this->authorize('view', $habit);

        // Si el rango pedido incluye hoy, garantizar que la ocurrencia de
        // hoy exista aunque el job mensual no haya corrido (ver
        // HabitOccurrenceMaterializer::ensureToday()).
        $today = $habit->user->today();
        if ($request->query('from', $today) <= $today && $request->query('to', $today) >= $today) {
            $materializer->ensureToday($habit);
        }

        // `from`/`to` filtran por `occurrence_date` (rango cerrado) — sin
        // esto, un hábito con logs materializados hasta fin de mes (ver
        // HabitOccurrenceMaterializer) satura la página 1 con fechas
        // futuras y esconde el registro de "hoy" en páginas siguientes que
        // el frontend nunca pide. `per_page` respeta lo pedido por el
        // cliente (clamp 1-100) en vez del default fijo de Laravel.
        $perPage = max(1, min((int) $request->query('per_page', 15), 100));

        $logs = $habit->logs()
            ->with('metricLogs')
            ->when($request->query('from'), fn ($query, $from) => $query->where('occurrence_date', '>=', $from))
            ->when($request->query('to'), fn ($query, $to) => $query->where('occurrence_date', '<=', $to))
            ->orderByDesc('occurrence_date')
            ->paginate($perPage);

        return response()->json([
            'data' => HabitLogResource::collection($logs->items()),
            'meta' => [
                'current_page' => $logs->currentPage(),
                'last_page' => $logs->lastPage(),
                'per_page' => $logs->perPage(),
                'total' => $logs->total(),
            ],
        ]);
    }

    public function store(StoreHabitLogRequest $request, Habit $habit, HabitLogService $logs)
    {
        $this->authorize('update', $habit);

        $log = $logs->create($habit, $request->validated('occurrence_date'), $request->validated('metrics', []));

        return (new HabitLogResource($log->fresh('metricLogs')))
            ->additional(['mensaje' => 'Registro creado correctamente.'])
            ->response()
            ->setStatusCode(201);
    }

    public function update(UpdateHabitLogRequest $request, Habit $habit, HabitLog $log, HabitLogService $logs)
    {
        $this->authorize('update', $habit);

        $logs->update($habit, $log, $request->validated('metrics', []));

        return (new HabitLogResource($log->fresh('metricLogs')))
            ->additional(['mensaje' => 'Registro actualizado correctamente.']);
    }

    /**
     * Deshacer el registro de hoy. En `fixed` la ocurrencia vuelve a
     * `pending` y se devuelve en `data`; en `quota` se borra y `data` es
     * null (ver HabitLogService::undo()).
     */
    public function destroy(Habit $habit, HabitLog $log, HabitLogService $logs)
    {
        $this->authorize('update', $habit);

        $result = $logs->undo($habit, $log);

        return response()->json([
            'data' => $result ? new HabitLogResource($result->fresh('metricLogs')) : null,
            'mensaje' => 'Registro deshecho correctamente.',
        ]);
    }
}
