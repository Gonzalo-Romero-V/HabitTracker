"use client";

import { apiFetch } from "@/lib/api";

export type HabitMetricTargetVersion = {
  target_value: string;
  effective_from: string;
};

export type HabitMetric = {
  id: number;
  habit_id: number;
  name: string;
  metric_type: "count" | "duration" | "currency";
  unit: string | null;
  currency_code: string | null;
  target_value: string | null;
  /** Historial completo, ordenado ascendente por effective_from — para
   * dibujar la meta como función escalonada a través del tiempo (ver
   * domain/habit-metric.md). Nunca usar solo target_value para una serie
   * histórica: el valor vigente no es necesariamente el que regía en cada
   * fecha pasada. */
  target_versions: HabitMetricTargetVersion[];
  created_at: string;
};

export type DurationType = "indefinite" | "end_date" | "duration_days";

export type Habit = {
  id: number;
  category_id: number | null;
  name: string;
  tracking_type: "binary" | "quantifiable";
  status: "active" | "archived";
  recurrence_type: "fixed" | "quota";
  recurrence_rule: string | null;
  quota_target: number | null;
  quota_period: "week" | null;
  duration_type: DurationType;
  duration_end_date: string | null;
  duration_days: number | null;
  /** Calculado por el backend (Habit::effectiveEndDate()) — fecha Y-m-d en
   * que el hábito deja de estar vigente, o null si `indefinite`. Nunca
   * recalcular esto en el frontend a partir de duration_days: el backend
   * ya lo resuelve en el timezone del usuario dueño. */
  effective_end_date: string | null;
  current_streak: number;
  best_streak: number;
  metrics: HabitMetric[];
  created_at: string;
};

type PaginatedMeta = {
  current_page: number;
  last_page: number;
  per_page: number;
  total: number;
};

export type NewMetricInput = {
  name: string;
  metric_type: "count" | "duration" | "currency";
  unit?: string;
  currency_code?: string;
  target_value: number;
};

export type NewHabitInput = {
  name: string;
  category_id?: number | null;
  tracking_type: "binary" | "quantifiable";
  recurrence_type: "fixed" | "quota";
  recurrence_rule?: string;
  quota_target?: number;
  quota_period?: "week";
  /** Default backend: "indefinite" si se omite. */
  duration_type?: DurationType;
  duration_end_date?: string;
  duration_days?: number;
  metrics?: NewMetricInput[];
};

export function listHabits(status?: string) {
  const query = status ? `?status=${status}` : "";

  return apiFetch<Habit[]>(`/habits${query}`, { method: "GET" });
}

export function getHabit(id: number) {
  return apiFetch<Habit>(`/habits/${id}`, { method: "GET" });
}

export function createHabit(input: NewHabitInput) {
  return apiFetch<Habit>("/habits", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type UpdateHabitInput = {
  name?: string;
  category_id?: number | null;
  recurrence_rule?: string;
  quota_target?: number;
  quota_period?: "week";
  duration_type?: DurationType;
  duration_end_date?: string;
  duration_days?: number;
};

export function updateHabit(id: number, input: UpdateHabitInput) {
  return apiFetch<Habit>(`/habits/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function archiveHabit(id: number) {
  return apiFetch<Habit>(`/habits/${id}/archive`, { method: "POST" });
}

export function unarchiveHabit(id: number) {
  return apiFetch<Habit>(`/habits/${id}/unarchive`, { method: "POST" });
}

export function deleteHabit(id: number) {
  return apiFetch<null>(`/habits/${id}`, { method: "DELETE" });
}

export type HabitMonthlyStatEntry = {
  year: number;
  month: number;
  completed_count: number;
  missed_count: number;
  recurrence_rule_snapshot: string | null;
  quota_target_snapshot: number | null;
  quota_period_snapshot: string | null;
};

export function listHabitMonthlyStats(habitId: number) {
  return apiFetch<HabitMonthlyStatEntry[]>(`/habits/${habitId}/stats/monthly`, { method: "GET" });
}

export function createHabitMetric(habitId: number, input: NewMetricInput) {
  return apiFetch<HabitMetric>(`/habits/${habitId}/metrics`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function updateHabitMetric(
  habitId: number,
  metricId: number,
  input: { name?: string; target_value?: number },
) {
  return apiFetch<HabitMetric>(`/habits/${habitId}/metrics/${metricId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function deleteHabitMetric(habitId: number, metricId: number) {
  return apiFetch<null>(`/habits/${habitId}/metrics/${metricId}`, { method: "DELETE" });
}

export type { PaginatedMeta };
