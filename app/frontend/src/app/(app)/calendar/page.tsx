"use client";

import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getTodayStat, getDailyStats, type TodayStat, type DailyStat } from "@/hooks/useStats";
import { listHabits, type Habit } from "@/hooks/useHabits";
import { listHabitLogs, type HabitLogEntry } from "@/hooks/useHabitLogs";
import { statToScore } from "@/lib/heatmap";
import { ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { HeatmapLegend } from "@/components/custom/HeatmapLegend";
import { DayCell } from "./DayCell";

const WEEKDAY_LABELS = ["D", "L", "M", "M", "J", "V", "S"];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Fecha local (no UTC) en formato YYYY-MM-DD — coincide con el timezone
 * que apiFetch ya manda en X-Client-Timezone (ver lib/api.ts). */
function toISODate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1);
}

function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

/** Parsea "YYYY-MM-DD" como fecha local (evita el corrimiento de un día
 * que produce `new Date("YYYY-MM-DD")`, que Date interpreta como UTC). */
function parseISODate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

const monthLabelFormatter = new Intl.DateTimeFormat("es", { month: "long", year: "numeric" });
const dayDetailFormatter = new Intl.DateTimeFormat("es", { weekday: "long", day: "numeric", month: "long" });

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const HABIT_LOG_STATUS_LABEL: Record<HabitLogEntry["status"], string> = {
  completed: "Completado",
  missed: "Fallado",
  pending: "Pendiente",
};

const HABIT_LOG_STATUS_CLASS: Record<HabitLogEntry["status"], string> = {
  completed: "text-primary",
  missed: "text-destructive",
  pending: "text-muted-foreground",
};

export default function CalendarPage() {
  const today = new Date();
  const todayISO = toISODate(today);

  const [visibleMonth, setVisibleMonth] = useState(startOfMonth(today));
  const [selectedDate, setSelectedDate] = useState(todayISO);

  const [dailyStats, setDailyStats] = useState<Record<string, DailyStat>>({});
  const [todayStat, setTodayStat] = useState<TodayStat | null>(null);
  const [isLoadingMonth, setIsLoadingMonth] = useState(true);
  const [monthError, setMonthError] = useState<string | null>(null);

  const [activeHabits, setActiveHabits] = useState<Habit[]>([]);
  const [logsByHabit, setLogsByHabit] = useState<Record<number, HabitLogEntry[]>>({});
  const [isLoadingHabits, setIsLoadingHabits] = useState(true);
  const [habitsError, setHabitsError] = useState<string | null>(null);

  // Stats del mes visible + "hoy" en vivo. Se recarga solo al navegar de mes.
  useEffect(() => {
    setIsLoadingMonth(true);
    setMonthError(null);

    const from = toISODate(visibleMonth);
    const to = toISODate(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), daysInMonth(visibleMonth)));

    Promise.all([getDailyStats(from, to), getTodayStat()])
      .then(([stats, todayRow]) => {
        const map: Record<string, DailyStat> = {};
        for (const row of stats) map[row.date] = row;
        setDailyStats(map);
        setTodayStat(todayRow);
      })
      .catch((err) => setMonthError(err instanceof ApiError ? err.message : "No se pudieron cargar las estadísticas del mes."))
      .finally(() => setIsLoadingMonth(false));
  }, [visibleMonth]);

  // Hábitos activos, una sola vez — la lista en sí no depende del mes visible.
  useEffect(() => {
    listHabits("active")
      .then((habits) => setActiveHabits(habits))
      .catch((err) => setHabitsError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle por hábito."));
  }, []);

  // Logs por hábito, acotados al mes visible — se recarga al navegar de
  // mes. Sin `from`/`to` el backend devuelve por defecto lo más reciente
  // por fecha descendente, que con materialización a futuro puede no
  // incluir el mes que se está mirando en absoluto (ver domain/habit.md).
  useEffect(() => {
    if (activeHabits.length === 0) {
      setLogsByHabit({});
      return;
    }

    setIsLoadingHabits(true);
    setHabitsError(null);

    const from = toISODate(visibleMonth);
    const to = toISODate(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), daysInMonth(visibleMonth)));

    Promise.all(activeHabits.map((h) => listHabitLogs(h.id, { from, to })))
      .then((logsPerHabit) => {
        const map: Record<number, HabitLogEntry[]> = {};
        activeHabits.forEach((h, i) => {
          map[h.id] = logsPerHabit[i];
        });
        setLogsByHabit(map);
      })
      .catch((err) => setHabitsError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle por hábito."))
      .finally(() => setIsLoadingHabits(false));
  }, [activeHabits, visibleMonth]);

  function goToMonth(delta: number) {
    setVisibleMonth((prev) => addMonths(prev, delta));
  }

  function goToToday() {
    setVisibleMonth(startOfMonth(today));
    setSelectedDate(todayISO);
  }

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const leadingBlanks = new Date(year, month, 1).getDay();
  const totalDays = daysInMonth(visibleMonth);

  function scoreForDate(iso: string): number | null {
    if (iso === todayISO) {
      return todayStat ? statToScore(todayStat.due_count, todayStat.weighted_completed_count) : null;
    }
    const row = dailyStats[iso];
    return row ? statToScore(row.due_count, row.weighted_completed_count) : null;
  }

  const selectedIsFuture = selectedDate > todayISO;
  const selectedStat: DailyStat | TodayStat | null =
    selectedDate === todayISO ? todayStat : selectedIsFuture ? null : (dailyStats[selectedDate] ?? null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="font-heading text-lg font-semibold">Calendario</h1>
        <Button size="sm" variant="secondary" onClick={goToToday}>
          Hoy
        </Button>
      </div>

      <Card className="rounded-3xl">
        <CardContent className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Button variant="ghost" size="icon" aria-label="Mes anterior" onClick={() => goToMonth(-1)}>
              <ChevronLeft className="size-4" />
            </Button>
            <p className="font-heading text-base font-semibold">{capitalize(monthLabelFormatter.format(visibleMonth))}</p>
            <Button variant="ghost" size="icon" aria-label="Mes siguiente" onClick={() => goToMonth(1)}>
              <ChevronRight className="size-4" />
            </Button>
          </div>

          {monthError && <p className="text-sm text-destructive">{monthError}</p>}

          <div className="grid grid-cols-7 gap-1.5">
            {WEEKDAY_LABELS.map((label, i) => (
              <div key={i} className="flex items-center justify-center text-[11px] font-semibold text-muted-foreground">
                {label}
              </div>
            ))}

            {Array.from({ length: leadingBlanks }).map((_, i) => (
              <div key={`blank-${i}`} />
            ))}

            {Array.from({ length: totalDays }).map((_, i) => {
              const day = i + 1;
              const dateObj = new Date(year, month, day);
              const iso = toISODate(dateObj);
              const isFuture = iso > todayISO;

              return (
                <DayCell
                  key={iso}
                  day={day}
                  isFuture={isFuture}
                  isToday={iso === todayISO}
                  isSelected={iso === selectedDate}
                  score={isFuture ? null : scoreForDate(iso)}
                  onClick={() => setSelectedDate(iso)}
                />
              );
            })}
          </div>

          {isLoadingMonth && <p className="text-xs text-muted-foreground">Cargando estadísticas...</p>}

          <Separator />

          <HeatmapLegend showFuture className="flex flex-wrap gap-x-4 gap-y-2" />
        </CardContent>
      </Card>

      <Card className="rounded-3xl">
        <CardContent className="flex flex-col gap-3">
          <p className="font-heading text-base font-semibold">
            {capitalize(dayDetailFormatter.format(parseISODate(selectedDate)))}
            {selectedDate === todayISO && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(hoy)</span>}
          </p>

          {selectedIsFuture ? (
            <p className="text-sm text-muted-foreground">Todavía no hay datos — es un día futuro.</p>
          ) : selectedStat ? (
            <p className="text-sm text-muted-foreground">
              {selectedStat.completed_count} de {selectedStat.due_count} hábitos completados
              {(() => {
                const score = statToScore(selectedStat.due_count, selectedStat.weighted_completed_count);
                return score !== null ? ` (${score}%)` : "";
              })()}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Sin hábitos programados este día.</p>
          )}

          {!selectedIsFuture && (
            <>
              <Separator />
              {isLoadingHabits ? (
                <p className="text-xs text-muted-foreground">Cargando hábitos...</p>
              ) : habitsError ? (
                <p className="text-sm text-destructive">{habitsError}</p>
              ) : activeHabits.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tienes hábitos activos.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {activeHabits.map((habit) => {
                    const log = logsByHabit[habit.id]?.find((l) => l.occurrence_date === selectedDate) ?? null;
                    return (
                      <li key={habit.id} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">{habit.name}</span>
                        <span className={log ? HABIT_LOG_STATUS_CLASS[log.status] : "text-muted-foreground/60"}>
                          {log ? HABIT_LOG_STATUS_LABEL[log.status] : "Sin registro"}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
