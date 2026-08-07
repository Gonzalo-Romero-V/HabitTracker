"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { getHabit, type Habit } from "@/hooks/useHabits";
import {
  listHabitLogs,
  updateHabitLog,
  createHabitLog,
  deleteHabitLog,
  type HabitLogEntry,
} from "@/hooks/useHabitLogs";
import { useHabitForm } from "@/components/custom/HabitFormProvider";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Fecha local del navegador — coincide con el timezone que apiFetch ya
 * manda en X-Client-Timezone (ver lib/api.ts), así "hoy" siempre calza
 * con el día que el backend usó para evaluar el header. */
function todayLocalDateString(): string {
  const now = new Date();

  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function daysAgoLocalDateString(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<HabitLogEntry["status"], string> = {
  completed: "Completado",
  missed: "Fallado",
  pending: "Pendiente",
};

const STATUS_CLASS: Record<HabitLogEntry["status"], string> = {
  completed: "text-primary",
  missed: "text-destructive",
  pending: "text-muted-foreground",
};

export function HabitDetailClient() {
  const params = useParams<{ id: string }>();
  const habitId = Number(params.id);
  const { openEdit, version } = useHabitForm();

  const [habit, setHabit] = useState<Habit | null>(null);
  const [logs, setLogs] = useState<HabitLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [metricValues, setMetricValues] = useState<Record<number, number>>({});

  function reload() {
    setIsLoading(true);
    // Rango acotado a "hoy" hacia atrás: incluye el log de hoy (para el
    // check-off) y el historial reciente pasado — sin `to`, el backend
    // devuelve por defecto lo más reciente por fecha descendente, que con
    // materialización a futuro queda dominado por fechas que todavía no
    // ocurrieron (ver domain/habit.md).
    const today = todayLocalDateString();
    Promise.all([getHabit(habitId), listHabitLogs(habitId, { from: daysAgoLocalDateString(30), to: today })])
      .then(([h, l]) => {
        setHabit(h);
        setLogs(l);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar el hábito."))
      .finally(() => setIsLoading(false));
  }

  useEffect(reload, [habitId, version]);

  const today = todayLocalDateString();
  const todayLog = logs.find((l) => l.occurrence_date === today) ?? null;

  /** Aplica el log de hoy sin recargar hábito+historial completos — antes
   * cada check-off/step disparaba `reload()`, que ponía `isLoading` y
   * reemplazaba toda la pantalla por "Cargando...", cortando cualquier
   * click seguido. El hábito sí se refresca (el streak puede cambiar),
   * pero en segundo plano y sin el spinner de pantalla completa. */
  function applyLogChange(newLog: HabitLogEntry | null) {
    setLogs((prev) => {
      const withoutToday = prev.filter((l) => l.occurrence_date !== today);
      return newLog ? [newLog, ...withoutToday] : withoutToday;
    });
    getHabit(habitId)
      .then(setHabit)
      .catch(() => {});
  }

  async function handleBinaryCheckOff() {
    setError(null);
    setIsSaving(true);
    try {
      if (todayLog) {
        applyLogChange(await updateHabitLog(habitId, todayLog.id));
      } else {
        applyLogChange(await createHabitLog(habitId, { occurrence_date: today }));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUndo() {
    if (!todayLog) return;
    setError(null);
    setIsSaving(true);
    try {
      await deleteHabitLog(habitId, todayLog.id);
      applyLogChange(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo deshacer.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleMetricsSubmit() {
    if (!habit) return;
    setError(null);
    setIsSaving(true);
    const metrics = habit.metrics.map((m) => ({
      habit_metric_id: m.id,
      value:
        metricValues[m.id] ??
        Number(todayLog?.metrics.find((tm) => tm.habit_metric_id === m.id)?.value ?? 0),
    }));
    try {
      if (todayLog) {
        applyLogChange(await updateHabitLog(habitId, todayLog.id, metrics));
      } else {
        applyLogChange(await createHabitLog(habitId, { occurrence_date: today, metrics }));
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar.");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading || !habit) {
    return <p className="text-sm text-muted-foreground">Cargando...</p>;
  }

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <Link href="/habits" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" />
        Todos los hábitos
      </Link>

      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h1 className="font-heading text-lg font-semibold">{habit.name}</h1>
            <p className="text-sm text-muted-foreground">
              Racha actual: {habit.current_streak} · Mejor racha: {habit.best_streak}
            </p>
          </div>
          <Button variant="outline" size="icon" onClick={() => openEdit(habit)} aria-label="Editar hábito">
            <Pencil className="size-4" />
          </Button>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <div className="mt-4 rounded-xl border border-border p-4">
          <p className="mb-3 text-sm font-medium">Hoy ({today})</p>

          {habit.tracking_type === "binary" ? (
            todayLog?.status === "completed" ? (
              <div className="flex items-center justify-between">
                <span className="text-sm text-primary">✓ Completado</span>
                <Button variant="outline" size="sm" onClick={handleUndo} disabled={isSaving}>
                  Deshacer
                </Button>
              </div>
            ) : (
              <Button onClick={handleBinaryCheckOff} disabled={isSaving}>
                Marcar como hecho
              </Button>
            )
          ) : (
            <div className="flex flex-col gap-3">
              {habit.metrics.map((metric) => (
                <div key={metric.id} className="flex flex-col gap-1">
                  <Label className="text-xs text-muted-foreground">
                    {metric.name} (meta: {metric.target_value}
                    {metric.unit ? ` ${metric.unit}` : ""})
                  </Label>
                  <Input
                    type="number"
                    min={0}
                    value={
                      metricValues[metric.id] ??
                      Number(todayLog?.metrics.find((m) => m.habit_metric_id === metric.id)?.value ?? 0)
                    }
                    onChange={(e) => setMetricValues((prev) => ({ ...prev, [metric.id]: Number(e.target.value) }))}
                  />
                </div>
              ))}
              <div className="flex items-center gap-2">
                <Button onClick={handleMetricsSubmit} disabled={isSaving}>
                  Guardar
                </Button>
                {todayLog?.status === "completed" && <span className="text-sm text-primary">✓ Completado</span>}
                {todayLog && (
                  <Button variant="outline" size="sm" onClick={handleUndo} disabled={isSaving}>
                    Deshacer
                  </Button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="mb-3 font-heading text-base font-semibold">Historial reciente</h2>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin registros todavía.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {logs.map((log) => (
              <li key={log.id} className="flex items-center justify-between text-sm">
                <span>{log.occurrence_date}</span>
                <span className={STATUS_CLASS[log.status]}>{STATUS_LABEL[log.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
