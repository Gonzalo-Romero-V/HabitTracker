"use client";

import { useState } from "react";
import { Flame, Check, Minus, Plus } from "lucide-react";
import { createHabitLog, updateHabitLog, deleteHabitLog, type HabitLogEntry } from "@/hooks/useHabitLogs";
import type { Habit, HabitMetric } from "@/hooks/useHabits";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toStoredTargetValue, fromStoredTargetValue } from "@/lib/habit-form-utils";

type Props = {
  habit: Habit;
  log: HabitLogEntry | null;
  categoryName: string | null;
  categoryColor: string | null;
  weekCompletedCount: number;
  /** Hora del recordatorio más temprano del hábito ("HH:MM[:SS]"), o
   * `null` si no tiene ninguno. */
  reminderTime: string | null;
  today: string;
  /** Log resultante tras crear/actualizar/deshacer (`null` si se deshizo el
   * registro de un hábito `quota`, que se borra) — el padre lo aplica
   * localmente en vez de recargar todo. */
  onChanged: (log: HabitLogEntry | null) => void;
  onOpenEdit: (habit: Habit) => void;
  onError: (message: string) => void;
};

export function HabitTodayCard({
  habit,
  log,
  categoryName,
  categoryColor,
  weekCompletedCount,
  reminderTime,
  today,
  onChanged,
  onOpenEdit,
  onError,
}: Props) {
  const [isSaving, setIsSaving] = useState(false);
  const [metricValues, setMetricValues] = useState<Record<number, number>>({});

  const isCompleted = log?.status === "completed";

  async function handleBinaryClick(e: React.MouseEvent) {
    e.stopPropagation();
    setIsSaving(true);
    try {
      if (isCompleted && log) {
        onChanged(await deleteHabitLog(habit.id, log.id));
      } else if (log) {
        onChanged(await updateHabitLog(habit.id, log.id));
      } else {
        onChanged(await createHabitLog(habit.id, { occurrence_date: today }));
      }
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "No se pudo registrar el hábito.");
    } finally {
      setIsSaving(false);
    }
  }

  async function submitMetrics(overrides: Record<number, number>) {
    setIsSaving(true);
    try {
      // `metricValues`/`overrides` ya están en unidad NATURAL (igual que el
      // formulario de creación) — se convierte a unidad cruda (segundos/
      // centavos) recién acá, al armar el payload para el backend.
      const metrics = habit.metrics.map((m) => {
        const naturalValue = overrides[m.id] ?? metricValues[m.id] ?? currentValue(m);
        return {
          habit_metric_id: m.id,
          value: toStoredTargetValue(m.metric_type, naturalValue),
        };
      });

      if (log) {
        onChanged(await updateHabitLog(habit.id, log.id, metrics));
      } else {
        onChanged(await createHabitLog(habit.id, { occurrence_date: today, metrics }));
      }
    } catch (err) {
      onError(err instanceof ApiError ? err.message : "No se pudo guardar el valor.");
    } finally {
      setIsSaving(false);
    }
  }

  /** Siempre en unidad NATURAL (minutos, cantidad, monto) — `metricValues`
   * ya viene así (es lo que el usuario tipea); si no hay valor local
   * todavía, se convierte desde el valor crudo del log (segundos/centavos). */
  function currentValue(metric: HabitMetric): number {
    if (metricValues[metric.id] !== undefined) return metricValues[metric.id];
    return savedValue(metric);
  }

  function handleStep(metric: HabitMetric, delta: number, e: React.MouseEvent) {
    e.stopPropagation();
    const next = Math.max(0, currentValue(metric) + delta);
    setMetricValues((prev) => ({ ...prev, [metric.id]: next }));
    submitMetrics({ [metric.id]: next });
  }

  function handleInputChange(metric: HabitMetric, value: string) {
    const parsed = Number(value);
    setMetricValues((prev) => ({ ...prev, [metric.id]: Number.isNaN(parsed) ? 0 : parsed }));
  }

  /** Valor guardado en el log (unidad natural), sin la edición local. */
  function savedValue(metric: HabitMetric): number {
    const rawFromLog = Number(log?.metrics.find((lm) => lm.habit_metric_id === metric.id)?.value ?? 0);
    return fromStoredTargetValue(metric.metric_type, rawFromLog);
  }

  function handleInputCommit(metric: HabitMetric) {
    // Solo si cambió: enfocar y salir del campo sin tocarlo creaba un log
    // vacío (y en `quota` lo contaba como "debido" ese día).
    if (currentValue(metric) === savedValue(metric)) return;
    submitMetrics({ [metric.id]: currentValue(metric) });
  }

  const metaParts: string[] = [];
  if (categoryName) metaParts.push(categoryName);
  if (habit.recurrence_type === "quota" && habit.quota_target) {
    metaParts.push(`${weekCompletedCount}/${habit.quota_target} esta semana`);
  }
  const meta = metaParts.join(" · ");

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenEdit(habit)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpenEdit(habit);
        }
      }}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 text-left"
    >
      <div className="flex items-center gap-3">
        <span
          className="size-3 shrink-0 rounded-full"
          style={{ backgroundColor: categoryColor ?? "var(--muted-foreground)" }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{habit.name}</p>
            {reminderTime && (
              <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                {reminderTime.slice(0, 5)}
              </span>
            )}
          </div>
          {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
        </div>

        {habit.current_streak > 0 && (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-xs font-semibold text-brand-foreground">
            <Flame className="size-3" />
            {habit.current_streak}
          </span>
        )}

        {habit.tracking_type === "binary" && (
          <button
            type="button"
            onClick={handleBinaryClick}
            disabled={isSaving}
            aria-label={isCompleted ? "Deshacer" : "Marcar como hecho"}
            className={cn(
              "flex size-10 shrink-0 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-50",
              isCompleted
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border text-muted-foreground hover:border-primary/50",
            )}
          >
            <Check className="size-5" />
          </button>
        )}
      </div>

      {habit.tracking_type === "quantifiable" &&
        habit.metrics.map((metric) => {
          const value = currentValue(metric);
          const target = fromStoredTargetValue(metric.metric_type, Number(metric.target_value ?? 0));
          const percentage = target > 0 ? Math.min(100, (value / target) * 100) : 0;
          const step = 1;
          const unitSuffix =
            metric.metric_type === "duration" ? "min" : metric.metric_type === "currency" ? metric.currency_code : metric.unit;

          return (
            <div key={metric.id} className="flex flex-col gap-2" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={(e) => handleStep(metric, -step, e)}
                  disabled={isSaving}
                >
                  <Minus className="size-3.5" />
                </Button>
                <Input
                  type="number"
                  min={0}
                  value={value}
                  onChange={(e) => handleInputChange(metric, e.target.value)}
                  onBlur={() => handleInputCommit(metric)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleInputCommit(metric);
                    }
                  }}
                  className="w-20 text-center"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  onClick={(e) => handleStep(metric, step, e)}
                  disabled={isSaving}
                >
                  <Plus className="size-3.5" />
                </Button>
                <span className="flex-1 truncate text-right text-xs text-muted-foreground">
                  Meta: {target}
                  {unitSuffix ? ` ${unitSuffix}` : ""}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
    </div>
  );
}
