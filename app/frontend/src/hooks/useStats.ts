"use client";

import { apiFetch } from "@/lib/api";

export type TodayStat = {
  date: string;
  due_count: number;
  completed_count: number;
  weighted_completed_count: number;
};

export type DailyStat = {
  date: string;
  due_count: number;
  completed_count: number;
  /** Índice fraccionario [0, due_count] — a diferencia de completed_count
   * (todo-o-nada), un hábito cuantificable a medio camino de su meta cuenta
   * parcialmente (ej. 8 de 10 vasos de agua = 0.8). Es lo que alimenta el
   * score del heatmap (Calendario/Memento Mori) — ver lib/heatmap.ts. Nunca
   * usar completed_count para colorear el heatmap, esto es lo que refleja
   * con precisión "qué tan bien se cumplieron los objetivos" del día. */
  weighted_completed_count: number;
};

export type MonthlyTrendPoint = {
  year: number;
  month: number;
  completed_count: number;
  missed_count: number;
};

export function getTodayStat() {
  return apiFetch<TodayStat>("/stats/today", { method: "GET" });
}

/** from/to en formato YYYY-MM-DD. Devuelve solo días ya cerrados con
 * datos (sin fila para "hoy" ni para días sin ningún hábito activo). */
export function getDailyStats(from: string, to: string) {
  return apiFetch<DailyStat[]>(`/stats/daily?from=${from}&to=${to}`, { method: "GET" });
}

export function getMonthlyTrend(months = 6) {
  return apiFetch<MonthlyTrendPoint[]>(`/stats/monthly-trend?months=${months}`, { method: "GET" });
}

/** Fecha del HabitLog más antiguo del usuario (null si nunca registró
 * nada) — único consumidor: Memento Mori, para saber desde qué semana/día
 * deja de pintarse gris "sin registro". */
export function getFirstLogDate() {
  return apiFetch<{ date: string | null }>("/stats/first-log-date", { method: "GET" });
}
