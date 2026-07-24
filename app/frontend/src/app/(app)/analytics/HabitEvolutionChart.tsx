"use client";

import { useEffect, useState } from "react";
import { listHabitMonthlyStats, type Habit, type HabitMetric, type HabitMonthlyStatEntry } from "@/hooks/useHabits";
import type { HabitLogEntry } from "@/hooks/useHabitLogs";
import { ApiError } from "@/lib/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { fromStoredTargetValue } from "@/lib/habit-form-utils";

const MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

type ViewMode = "mensual" | "anual";

type MetricPoint = { date: string; value: number };

/** Valor de la meta (`target_value`) vigente en `date`, replicando en JS el
 * criterio de `HabitMetric::targetVersionEffectiveOn` del backend: la
 * versión con `effective_from` más reciente que sea <= date. Nunca usar
 * `metric.target_value` (el vigente HOY) para una serie histórica — la
 * meta puede haber cambiado de valor en el pasado (domain/habit-metric.md).
 * `target_versions` ya viene ordenado ascendente por effective_from, así
 * que basta con quedarse con la última que todavía cumple la condición. */
function targetValueEffectiveOn(metric: HabitMetric, date: string): number | null {
  let effective: string | null = null;
  // Defensivo: un backend todavía no migrado a target_versions dejaría
  // este campo undefined — nunca debe tirar abajo toda la pantalla de
  // Análisis por eso (ver DEPLOY.md, la API de la app instalada puede
  // apuntar a un backend que no recibió el último despliegue todavía).
  for (const version of metric.target_versions ?? []) {
    if (version.effective_from <= date) {
      effective = version.target_value;
    }
  }
  return effective === null ? null : fromStoredTargetValue(metric.metric_type, Number(effective));
}

/** Serie de valor real (Serie 1) + serie de meta vigente por fecha (Serie
 * 2, función escalonada) para una métrica cuantificable, sobre las mismas
 * fechas en las que hay un log con esa métrica. */
function buildMetricSeries(
  metric: HabitMetric,
  logs: HabitLogEntry[],
): { valuePoints: MetricPoint[]; targetPoints: MetricPoint[] } {
  const valuePoints = logs
    .map((log) => {
      const entry = log.metrics.find((m) => m.habit_metric_id === metric.id);
      if (!entry) return null;
      return { date: log.occurrence_date, value: fromStoredTargetValue(metric.metric_type, Number(entry.value)) };
    })
    .filter((p): p is MetricPoint => p !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  const targetPoints = valuePoints
    .map((p) => {
      const value = targetValueEffectiveOn(metric, p.date);
      return value === null ? null : { date: p.date, value };
    })
    .filter((p): p is MetricPoint => p !== null);

  return { valuePoints, targetPoints };
}

function metricUnitLabel(metric: HabitMetric): string | null {
  if (metric.metric_type === "count") return metric.unit;
  if (metric.metric_type === "currency") return metric.currency_code;
  return "min";
}

/** Mini-gráfico de línea (small multiple) para una métrica cuantificable:
 * valor real logueado (línea sólida) + meta vigente en cada fecha (línea
 * punteada, escalonada) — nunca combinadas con otra métrica en el mismo
 * eje (unidades/escalas distintas, ver skill dataviz). SVG artesanal,
 * consistente con el resto de esta pantalla (sin librería de charting). */
function MetricEvolutionMiniChart({ metric, logs }: { metric: HabitMetric; logs: HabitLogEntry[] }) {
  const { valuePoints, targetPoints } = buildMetricSeries(metric, logs);
  const unit = metricUnitLabel(metric);

  if (valuePoints.length === 0) {
    return (
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/40 p-3">
        <p className="text-sm font-semibold">
          {metric.name}
          {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">({unit})</span>}
        </p>
        <p className="text-xs text-muted-foreground">Todavía no hay registros de esta métrica.</p>
      </div>
    );
  }

  const allValues = [...valuePoints.map((p) => p.value), ...targetPoints.map((p) => p.value)];
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const range = max - min || 1;

  const n = valuePoints.length;
  const toX = (i: number) => (n === 1 ? 150 : (i / (n - 1)) * 280 + 10);
  const toY = (value: number) => 90 - ((value - min) / range) * 80;

  const dateIndex = new Map(valuePoints.map((p, i) => [p.date, i]));
  const valuePath = valuePoints.map((p, i) => `${toX(i)},${toY(p.value)}`).join(" ");
  const targetPath = targetPoints
    .map((p) => {
      const i = dateIndex.get(p.date);
      return i === undefined ? null : `${toX(i)},${toY(p.value)}`;
    })
    .filter((point): point is string => point !== null)
    .join(" ");

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-secondary/40 p-3">
      <p className="text-sm font-semibold">
        {metric.name}
        {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">({unit})</span>}
      </p>
      <svg viewBox="0 0 300 100" preserveAspectRatio="none" className="h-24 w-full">
        {targetPath && (
          <polyline
            points={targetPath}
            fill="none"
            stroke="var(--muted-foreground)"
            strokeWidth={2}
            strokeDasharray="6 4"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline
          points={valuePath}
          fill="none"
          stroke="var(--primary)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}

type HabitEvolutionChartProps = {
  habits: Habit[];
  /** Logs (hasta 30, más recientes) por hábito, ya cargados por la página
   * padre para la sección "Consistencia por hábito" — se reutilizan acá
   * para la vista Mensual en vez de volver a pedirlos. */
  logsByHabit: Record<number, HabitLogEntry[]>;
};

/** Selector de hábito + gráfica de evolución.
 *
 * Un hábito `quantifiable` (tiene métricas con meta) se grafica SIEMPRE
 * como línea — valor real vs. meta vigente por fecha (small multiple por
 * métrica, ver MetricEvolutionMiniChart) — nunca como barras de
 * completado/fallado, que ocultan el dato que realmente importa acá (qué
 * tan cerca estuvo del umbral cada día, no si "aprobó" binariamente el
 * día). Las barras Mensual/Anual quedan reservadas para hábitos `binary`,
 * donde no hay ninguna métrica que graficar como línea — ahí sí
 * completado/fallado es el único dato que existe:
 *
 * Mensual: un punto por log (hasta los últimos 30), valor 100 si
 * `completed`, 0 si `missed` o `pending` — mapeo documentado acá porque el
 * enunciado deja el mapeo exacto a criterio. Para que "missed" y "pending"
 * (ambos valor 0) sigan siendo distinguibles visualmente, se dibuja una
 * barra completa (color primario) para `completed` y una barra baja
 * coloreada por estado (rojo/gris) para el resto, en vez de una barra de
 * altura 0 indistinguible del vacío.
 *
 * Anual: un punto por mes cerrado (`listHabitMonthlyStats`), valor =
 * completed/(completed+missed) * 100, saltando meses sin datos. */
export function HabitEvolutionChart({ habits, logsByHabit }: HabitEvolutionChartProps) {
  const [selectedId, setSelectedId] = useState<number | null>(habits[0]?.id ?? null);
  const [view, setView] = useState<ViewMode>("mensual");
  const [monthlyStatsCache, setMonthlyStatsCache] = useState<Record<number, HabitMonthlyStatEntry[]>>({});
  const [isLoadingMonthly, setIsLoadingMonthly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId === null && habits.length > 0) {
      setSelectedId(habits[0].id);
    }
  }, [habits, selectedId]);

  useEffect(() => {
    if (view !== "anual" || selectedId === null || monthlyStatsCache[selectedId]) return;

    let cancelled = false;
    setIsLoadingMonthly(true);
    setError(null);

    listHabitMonthlyStats(selectedId)
      .then((entries) => {
        if (cancelled) return;
        setMonthlyStatsCache((prev) => ({ ...prev, [selectedId]: entries }));
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "No se pudo cargar la evolución anual.");
      })
      .finally(() => {
        if (!cancelled) setIsLoadingMonthly(false);
      });

    return () => {
      cancelled = true;
    };
  }, [view, selectedId, monthlyStatsCache]);

  if (habits.length === 0) {
    return <p className="text-sm text-muted-foreground">Todavía no hay hábitos activos para mostrar.</p>;
  }

  const selectedHabit = habits.find((h) => h.id === selectedId) ?? habits[0];

  const monthlyLogs = [...(logsByHabit[selectedHabit.id] ?? [])].sort((a, b) =>
    a.occurrence_date.localeCompare(b.occurrence_date),
  );

  const yearlyPoints = (monthlyStatsCache[selectedHabit.id] ?? [])
    .filter((e) => e.completed_count + e.missed_count > 0)
    .slice()
    .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))
    .map((e) => ({
      ...e,
      pct: (e.completed_count / (e.completed_count + e.missed_count)) * 100,
    }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={String(selectedHabit.id)} onValueChange={(v) => setSelectedId(Number(v))}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {habits.map((h) => (
              <SelectItem key={h.id} value={String(h.id)}>
                {h.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedHabit.tracking_type === "binary" && (
          <div className="flex gap-1 rounded-lg border border-border bg-secondary p-1">
            {(["mensual", "anual"] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-semibold",
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
                onClick={() => setView(v)}
              >
                {v === "mensual" ? "Mensual" : "Anual"}
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {selectedHabit.tracking_type === "binary" && (view === "mensual" ? (
        monthlyLogs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin registros todavía para este hábito.</p>
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex h-28 items-end gap-[3px] overflow-x-auto">
              {monthlyLogs.map((log) => (
                <div
                  key={log.id}
                  title={`${log.occurrence_date}: ${
                    log.status === "completed" ? "Completado" : log.status === "missed" ? "Fallado" : "Pendiente"
                  }`}
                  className={cn(
                    "w-2 min-w-[6px] flex-1 rounded-t-sm",
                    log.status === "completed"
                      ? "h-full bg-primary"
                      : log.status === "missed"
                        ? "h-2 bg-destructive/60"
                        : "h-2 bg-muted-foreground/40",
                  )}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-primary" /> Completado
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-destructive/60" /> Fallado
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-muted-foreground/40" /> Pendiente
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Últimos {monthlyLogs.length} registros del hábito (no es una ventana calendario estricta de 30 días).
            </p>
          </div>
        )
      ) : isLoadingMonthly ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : yearlyPoints.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no hay meses cerrados con datos para este hábito.</p>
      ) : (
        <div className="flex h-28 items-end gap-2">
          {yearlyPoints.map((p) => (
            <div key={`${p.year}-${p.month}`} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
              <div className="flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t-sm bg-primary"
                  style={{ height: `${p.pct}%` }}
                  title={`${MONTH_ABBR[p.month - 1]} ${p.year}: ${Math.round(p.pct)}%`}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">
                {MONTH_ABBR[p.month - 1]} {String(p.year).slice(2)}
              </span>
            </div>
          ))}
        </div>
      ))}

      {selectedHabit.tracking_type === "quantifiable" && selectedHabit.metrics.length > 0 && (
        <div className="flex flex-col gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Valor real vs. meta por métrica</p>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded-full bg-primary" /> Valor
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0 w-4 border-t-2 border-dashed border-muted-foreground" aria-hidden />
                Meta
              </span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {selectedHabit.metrics.map((metric) => (
              <MetricEvolutionMiniChart
                key={metric.id}
                metric={metric}
                logs={logsByHabit[selectedHabit.id] ?? []}
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            La meta refleja el valor vigente en cada fecha (puede haber cambiado a través del tiempo).
          </p>
        </div>
      )}
    </div>
  );
}
