"use client";

import { apiFetch } from "@/lib/api";

export type HabitMetricLogEntry = {
  habit_metric_id: number;
  value: string;
};

export type HabitLogEntry = {
  id: number;
  habit_id: number;
  occurrence_date: string;
  status: "pending" | "completed" | "missed";
  completed_at: string | null;
  metrics: HabitMetricLogEntry[];
};

export type MetricValueInput = {
  habit_metric_id: number;
  value: number;
};

export type HabitLogRange = {
  /** occurrence_date >= from (YYYY-MM-DD). */
  from?: string;
  /** occurrence_date <= to (YYYY-MM-DD). */
  to?: string;
  perPage?: number;
};

/** Sin `from`/`to` el backend devuelve los ~15 logs más recientes por
 * `occurrence_date` descendente — como los hábitos `fixed` materializan
 * `pending` hasta fin de mes (ver domain/habit.md), eso puede estar
 * dominado por fechas futuras y esconder "hoy". Pasar siempre el rango
 * que la pantalla realmente necesita. */
export function listHabitLogs(habitId: number, range?: HabitLogRange) {
  const params = new URLSearchParams();
  params.set("per_page", String(range?.perPage ?? 100));
  if (range?.from) params.set("from", range.from);
  if (range?.to) params.set("to", range.to);
  return apiFetch<HabitLogEntry[]>(`/habits/${habitId}/logs?${params.toString()}`, { method: "GET" });
}

export function createHabitLog(
  habitId: number,
  input: { occurrence_date?: string; metrics?: MetricValueInput[] } = {},
) {
  return apiFetch<HabitLogEntry>(`/habits/${habitId}/logs`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateHabitLog(habitId: number, logId: number, metrics?: MetricValueInput[]) {
  return apiFetch<HabitLogEntry>(`/habits/${habitId}/logs/${logId}`, {
    method: "PATCH",
    body: JSON.stringify({ metrics }),
  });
}

/** Deshace el registro de hoy. En hábitos `fixed` la ocurrencia programada
 * no desaparece: vuelve a `pending` y se devuelve el log resultante. En
 * `quota` se borra y devuelve `null` (ver domain/habit-log.md). */
export function deleteHabitLog(habitId: number, logId: number) {
  return apiFetch<HabitLogEntry | null>(`/habits/${habitId}/logs/${logId}`, { method: "DELETE" });
}
