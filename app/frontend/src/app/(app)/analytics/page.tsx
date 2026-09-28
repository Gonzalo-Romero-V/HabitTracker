"use client";

import { useEffect, useMemo, useState } from "react";
import { listHabits, type Habit } from "@/hooks/useHabits";
import { listHabitLogs, type HabitLogEntry } from "@/hooks/useHabitLogs";
import { useCategories } from "@/hooks/useCategories";
import { getDailyStats, getMonthlyTrend, type DailyStat, type MonthlyTrendPoint } from "@/hooks/useStats";
import { ApiError } from "@/lib/api";
import { StatCard } from "./StatCard";
import { CategoryDonut } from "./CategoryDonut";
import { HabitEvolutionChart } from "./HabitEvolutionChart";

const MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AnalyticsPage() {
  const { categories } = useCategories();

  const [habits, setHabits] = useState<Habit[]>([]);
  const [dailyStats, setDailyStats] = useState<DailyStat[]>([]);
  const [monthlyTrend, setMonthlyTrend] = useState<MonthlyTrendPoint[]>([]);
  const [logsByHabit, setLogsByHabit] = useState<Record<number, HabitLogEntry[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const activeHabits = await listHabits("active");
        if (cancelled) return;
        setHabits(activeHabits);

        // Ventana de "consistencia 30 días": desde hoy-30 hasta hoy, en
        // fecha local del navegador (coincide con el timezone que apiFetch
        // ya manda en X-Client-Timezone).
        const to = new Date();
        const from = new Date();
        from.setDate(from.getDate() - 30);

        const [daily, trend, logsList] = await Promise.all([
          getDailyStats(toDateStr(from), toDateStr(to)),
          getMonthlyTrend(6),
          // Mismo rango de 30 días que getDailyStats — sin esto el backend
          // devuelve por defecto lo más reciente por fecha descendente, que
          // con materialización a futuro queda dominado por fechas que
          // todavía no ocurrieron (ver domain/habit.md).
          Promise.all(
            activeHabits.map((h) =>
              listHabitLogs(h.id, { from: toDateStr(from), to: toDateStr(to) }).catch(() => [] as HabitLogEntry[]),
            ),
          ),
        ]);
        if (cancelled) return;

        setDailyStats(daily);
        setMonthlyTrend(trend);

        const map: Record<number, HabitLogEntry[]> = {};
        activeHabits.forEach((h, i) => {
          map[h.id] = logsList[i];
        });
        setLogsByHabit(map);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : "No se pudieron cargar las estadísticas.");
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Consistencia 30 días: suma de completed_count / suma de due_count sobre
  // los días cerrados con datos que devuelve /stats/daily (no hay fila para
  // días sin ningún hábito programado).
  const consistency30 = useMemo(() => {
    const totalDue = dailyStats.reduce((sum, d) => sum + d.due_count, 0);
    const totalCompleted = dailyStats.reduce((sum, d) => sum + d.completed_count, 0);
    return totalDue > 0 ? Math.round((totalCompleted / totalDue) * 100) : null;
  }, [dailyStats]);

  const longestActiveStreakHabit = useMemo(
    () =>
      habits.reduce<Habit | null>((best, h) => (!best || h.current_streak > best.current_streak ? h : best), null),
    [habits],
  );

  const bestHistoricStreakHabit = useMemo(
    () => habits.reduce<Habit | null>((best, h) => (!best || h.best_streak > best.best_streak ? h : best), null),
    [habits],
  );

  // Consistencia por hábito: completed / (completed + missed) sobre los
  // logs de la ventana de 30 días (mismo rango `from`/`to` de arriba). Se
  // excluyen los `pending` del denominador porque todavía no están
  // resueltos (contarlos penalizaría ocurrencias de hoy sin check-off).
  const habitConsistency = useMemo(
    () =>
      habits.map((h) => {
        const logs = logsByHabit[h.id] ?? [];
        const completed = logs.filter((l) => l.status === "completed").length;
        const missed = logs.filter((l) => l.status === "missed").length;
        const total = completed + missed;
        const pct = total > 0 ? Math.round((completed / total) * 100) : null;
        const category = categories.find((c) => c.id === h.category_id);
        return { habit: h, pct, color: category?.color ?? "var(--muted-foreground)" };
      }),
    [habits, logsByHabit, categories],
  );

  // Tendencia mensual: % = completed_count / (completed_count + missed_count)
  // por mes, ordenado cronológicamente. Se eligió el % de cumplimiento en
  // vez de escalar completed_count contra el máximo de la serie porque es
  // comparable entre meses con distinta cantidad de hábitos activos.
  const sortedTrend = useMemo(
    () =>
      [...monthlyTrend]
        .sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month))
        .map((p) => ({
          ...p,
          pct:
            p.completed_count + p.missed_count > 0
              ? (p.completed_count / (p.completed_count + p.missed_count)) * 100
              : 0,
        })),
    [monthlyTrend],
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-heading text-lg font-semibold">Análisis</h1>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Consistencia 30 días" value={consistency30 === null ? "—" : `${consistency30}%`} />
            <StatCard
              label="Racha activa más larga"
              value={String(longestActiveStreakHabit?.current_streak ?? 0)}
              hint={longestActiveStreakHabit?.name}
            />
            <StatCard label="Hábitos activos" value={String(habits.length)} />
            <StatCard
              label="Mejor racha histórica"
              value={String(bestHistoricStreakHabit?.best_streak ?? 0)}
              hint={bestHistoricStreakHabit?.name}
            />
          </div>

          <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
            <h2 className="font-heading text-base font-semibold">Consistencia por hábito</h2>
            {habitConsistency.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay hábitos activos.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {habitConsistency.map(({ habit, pct, color }) => (
                  <li key={habit.id} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                        <span className="truncate">{habit.name}</span>
                      </span>
                      <span className="shrink-0 text-muted-foreground">{pct === null ? "Sin datos" : `${pct}%`}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct ?? 0}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Se calcula sobre los últimos 30 días: completados frente a completados más fallados (los pendientes no
              cuentan).
            </p>
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
            <h2 className="font-heading text-base font-semibold">Hábitos por categoría</h2>
            <CategoryDonut habits={habits} categories={categories} />
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
            <h2 className="font-heading text-base font-semibold">Tendencia mensual</h2>
            {sortedTrend.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay meses cerrados con datos.</p>
            ) : (
              <div className="flex h-32 items-end gap-2">
                {sortedTrend.map((p) => (
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
            )}
          </section>

          <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
            <h2 className="font-heading text-base font-semibold">Evolución del hábito</h2>
            <HabitEvolutionChart habits={habits} logsByHabit={logsByHabit} />
          </section>
        </>
      )}
    </div>
  );
}
