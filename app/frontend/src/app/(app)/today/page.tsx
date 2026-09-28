"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getHabit, listHabits, type Habit } from "@/hooks/useHabits";
import { listHabitLogs, type HabitLogEntry } from "@/hooks/useHabitLogs";
import { listReminders } from "@/hooks/useReminders";
import { useCategories } from "@/hooks/useCategories";
import { getTodayStat, type TodayStat } from "@/hooks/useStats";
import { useHabitForm } from "@/components/custom/HabitFormProvider";
import { ApiError } from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { HabitTodayCard } from "./HabitTodayCard";

type TodayEntry = {
  habit: Habit;
  log: HabitLogEntry | null;
  weekCompletedCount: number;
  /** Hora del recordatorio más temprano del hábito ("HH:MM[:SS]"), o
   * `null` si no tiene ninguno — usado para ordenar la agenda de "Hoy"
   * cronológicamente (ver domain/reminder.md). */
  earliestReminderTime: string | null;
};

/** Fecha local del navegador — mismo criterio que el resto de la app (ver
 * habits/[id]/page.tsx) para que "hoy" siempre calce con el timezone que
 * apiFetch manda en X-Client-Timezone. */
function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function todayLocalDateString(): string {
  return formatLocalDate(new Date());
}

function startOfWeekMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function TodayPage() {
  const [entries, setEntries] = useState<TodayEntry[]>([]);
  const [stat, setStat] = useState<TodayStat | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { categories } = useCategories();
  const { openEdit, version } = useHabitForm();

  const reload = useCallback(() => {
    setIsLoading(true);
    setError(null);

    const today = todayLocalDateString();
    const weekStart = formatLocalDate(startOfWeekMonday(new Date()));
    const weekEnd = formatLocalDate(addDays(startOfWeekMonday(new Date()), 6));

    Promise.all([listHabits("active"), getTodayStat()])
      .then(async ([habits, todayStat]) => {
        setStat(todayStat);

        // Rango de la semana ISO actual — incluye "hoy" (para el check-off
        // del día) y toda la semana (para weekCompletedCount). Sin esto el
        // backend devuelve por defecto los logs más recientes por fecha
        // descendente, que con materialización a futuro puede no incluir
        // "hoy" en absoluto (ver domain/habit.md).
        const [logsByHabit, remindersByHabit] = await Promise.all([
          Promise.all(habits.map((h) => listHabitLogs(h.id, { from: weekStart, to: weekEnd }))),
          Promise.all(habits.map((h) => listReminders(h.id))),
        ]);

        const due: TodayEntry[] = [];
        habits.forEach((habit, i) => {
          const logs = logsByHabit[i];
          const todayLog = logs.find((l) => l.occurrence_date === today) ?? null;
          const weekCompletedCount = logs.filter(
            (l) => l.status === "completed" && l.occurrence_date >= weekStart && l.occurrence_date <= weekEnd,
          ).length;
          const reminders = remindersByHabit[i];
          const earliestReminderTime =
            reminders.length > 0
              ? reminders.reduce((earliest, r) => (r.time_of_day < earliest ? r.time_of_day : earliest), reminders[0].time_of_day)
              : null;

          // Los hábitos "fixed" solo están "debidos" hoy si el backend ya
          // pre-materializó un log para la fecha (ver domain/habit.md); los
          // "quota" no tienen calendario fijo así que siempre se muestran.
          if (habit.recurrence_type === "quota" || todayLog) {
            due.push({ habit, log: todayLog, weekCompletedCount, earliestReminderTime });
          }
        });

        // Agenda cronológica: primero los sin recordatorio (orden original
        // preservado entre ellos), después el resto ascendente por hora.
        const withoutReminder = due.filter((e) => e.earliestReminderTime === null);
        const withReminder = due
          .filter((e) => e.earliestReminderTime !== null)
          .sort((a, b) => (a.earliestReminderTime as string).localeCompare(b.earliestReminderTime as string));

        setEntries([...withoutReminder, ...withReminder]);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar los hábitos de hoy."))
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload, version]);

  /** Aplica el resultado de un check-off/step sin recargar la lista
   * entera — antes cada +1 disparaba `reload()` completo (todos los
   * hábitos + sus logs + recordatorios) y de paso mostraba el spinner de
   * pantalla completa, cortando cualquier click seguido. El anillo de
   * progreso sí se refresca, pero en segundo plano y sin bloquear. */
  const handleEntryChanged = useCallback((habitId: number, newLog: HabitLogEntry | null) => {
    setEntries((prev) =>
      prev.map((entry) => {
        if (entry.habit.id !== habitId) return entry;
        const wasCompleted = entry.log?.status === "completed";
        const isNowCompleted = newLog?.status === "completed";
        const delta = isNowCompleted && !wasCompleted ? 1 : !isNowCompleted && wasCompleted ? -1 : 0;
        return { ...entry, log: newLog, weekCompletedCount: entry.weekCompletedCount + delta };
      }),
    );
    getTodayStat()
      .then(setStat)
      .catch(() => {});
    // La racha la recalcula el backend en cada registro — se refresca el
    // hábito en segundo plano para que la insignia no quede desactualizada.
    getHabit(habitId)
      .then((habit) => setEntries((prev) => prev.map((entry) => (entry.habit.id === habitId ? { ...entry, habit } : entry))))
      .catch(() => {});
  }, []);

  const categoryMap = useMemo(() => {
    const map = new Map<number, { name: string; color: string | null }>();
    categories.forEach((c) => map.set(c.id, { name: c.name, color: c.color }));
    return map;
  }, [categories]);

  const dateLabel = useMemo(() => {
    const raw = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
    return raw.charAt(0).toUpperCase() + raw.slice(1);
  }, []);

  const dueCount = stat?.due_count ?? 0;
  const completedCount = stat?.completed_count ?? 0;
  const allDone = dueCount > 0 && completedCount >= dueCount;
  const percentage = dueCount > 0 ? Math.min(1, completedCount / dueCount) : 0;
  const dashOffset = CIRCUMFERENCE * (1 - percentage);

  const summary = dueCount === 0 ? "Sin hábitos hoy" : `${completedCount} de ${dueCount} hábitos cumplidos`;
  const subtitle =
    dueCount === 0
      ? "Disfruta tu día — no tienes hábitos programados."
      : allDone
        ? "¡Completaste todos tus hábitos de hoy!"
        : "Vas por buen camino, sigue así.";

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex items-center gap-5">
          <div className="relative flex size-24 shrink-0 items-center justify-center">
            <svg viewBox="0 0 100 100" className="size-24 -rotate-90">
              <circle cx="50" cy="50" r={RADIUS} strokeWidth="8" className="fill-none stroke-secondary" />
              <circle
                cx="50"
                cy="50"
                r={RADIUS}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                strokeDashoffset={dashOffset}
                className="fill-none stroke-primary transition-[stroke-dashoffset] duration-500 ease-out"
              />
            </svg>
            <span className="absolute font-heading text-lg font-semibold">
              {completedCount}/{dueCount}
            </span>
          </div>

          <div className="flex min-w-0 flex-col gap-1">
            <p className="text-xs font-medium text-muted-foreground">{dateLabel}</p>
            <p className="font-heading text-lg font-semibold">{summary}</p>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="flex flex-col gap-2.5">
        <h2 className="font-heading text-base font-semibold">Hábitos de hoy</h2>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Cargando...</p>
        ) : entries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
            No tienes hábitos programados para hoy.
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {entries.map((entry) => {
              const category = entry.habit.category_id ? categoryMap.get(entry.habit.category_id) : undefined;

              return (
                <HabitTodayCard
                  key={entry.habit.id}
                  habit={entry.habit}
                  log={entry.log}
                  categoryName={category?.name ?? null}
                  categoryColor={category?.color ?? null}
                  weekCompletedCount={entry.weekCompletedCount}
                  reminderTime={entry.earliestReminderTime}
                  today={todayLocalDateString()}
                  onChanged={(log) => handleEntryChanged(entry.habit.id, log)}
                  onOpenEdit={openEdit}
                  onError={setError}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
