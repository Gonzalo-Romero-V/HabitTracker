"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { getDailyStats, getFirstLogDate, type DailyStat } from "@/hooks/useStats";
import { statToScore } from "@/lib/heatmap";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { HeatmapLegend } from "@/components/custom/HeatmapLegend";
import { Cell } from "./Cell";
import { addDays, formatDateOnly, getISOWeek, parseDateOnly, todayDateOnly } from "./iso-week";

type ViewMode = "global" | "year";

type WeekCell = { score: number | null; isFuture: boolean };
type WeekRow = { year: number; weeks: WeekCell[] };

const WEEKS_PER_ROW = 53;

/** Esperanza de vida promedio humana — valor fijo, ver intent/vision.md →
 * Memento Mori. No hay pedido de personalizarlo por usuario. */
const LIFE_EXPECTANCY_YEARS = 90;

function addYears(date: Date, years: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear() + years, date.getUTCMonth(), date.getUTCDate()));
}

function buildWeekMap(stats: DailyStat[]): Map<string, { due: number; completed: number }> {
  const map = new Map<string, { due: number; completed: number }>();
  for (const row of stats) {
    const { isoYear, isoWeek } = getISOWeek(parseDateOnly(row.date));
    const key = `${isoYear}-${isoWeek}`;
    const entry = map.get(key) ?? { due: 0, completed: 0 };
    entry.due += row.due_count;
    // Índice fraccionario, no el conteo todo-o-nada — ver lib/heatmap.ts.
    entry.completed += row.weighted_completed_count;
    map.set(key, entry);
  }
  return map;
}

export default function MoriPage() {
  const { user } = useAuth();
  const [view, setView] = useState<ViewMode>("global");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<DailyStat[]>([]);
  const [firstLogDate, setFirstLogDate] = useState<Date | null>(null);
  const [firstLogChecked, setFirstLogChecked] = useState(false);

  const birthDate = useMemo(() => {
    if (!user?.birth_date) return null;
    return parseDateOnly(user.birth_date);
  }, [user]);

  const lifeEndDate = useMemo(() => (birthDate ? addYears(birthDate, LIFE_EXPECTANCY_YEARS) : null), [birthDate]);

  // El primer HabitLog real define desde qué semana/día deja de pintarse
  // gris "sin registro" — se pide una sola vez, no depende de la vista.
  useEffect(() => {
    getFirstLogDate()
      .then(({ date }) => setFirstLogDate(date ? parseDateOnly(date) : null))
      .catch(() => setFirstLogDate(null))
      .finally(() => setFirstLogChecked(true));
  }, []);

  useEffect(() => {
    if (!firstLogChecked) return;

    if (!firstLogDate) {
      // Nunca se registró nada — no hay rango real que pedir.
      setStats([]);
      setIsLoading(false);
      return;
    }

    const today = todayDateOnly();
    const from = view === "global" ? formatDateOnly(firstLogDate) : `${today.getUTCFullYear()}-01-01`;
    const to = formatDateOnly(today);

    setIsLoading(true);
    setError(null);
    getDailyStats(from, to)
      .then(setStats)
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : "No se pudieron cargar las estadísticas. Si tu cuenta tiene más de 2 años, este rango todavía no soporta consultarse de una sola vez.",
        ),
      )
      .finally(() => setIsLoading(false));
  }, [view, firstLogChecked, firstLogDate]);

  const weekMap = useMemo(() => buildWeekMap(view === "global" ? stats : []), [view, stats]);

  const weekRows: WeekRow[] = useMemo(() => {
    if (view !== "global" || !birthDate || !lifeEndDate) return [];
    const today = todayDateOnly();
    const startYear = birthDate.getUTCFullYear();
    const endYear = lifeEndDate.getUTCFullYear();
    const rows: WeekRow[] = [];

    for (let y = startYear; y <= endYear; y++) {
      const weeks: WeekCell[] = [];
      for (let w = 1; w <= WEEKS_PER_ROW; w++) {
        // Aproximación de la fecha representativa de esta celda (lunes de
        // esa semana ISO) solo para decidir futuro/pasado — el conteo real
        // de la semana viene de weekMap, agregado desde /stats/daily.
        const approxDate = new Date(Date.UTC(y, 0, 1 + (w - 1) * 7));
        const isFuture = approxDate > today;
        const isBeforeBirth = approxDate < birthDate;

        if (isBeforeBirth) continue;

        const entry = weekMap.get(`${y}-${w}`);
        const score = entry ? statToScore(entry.due, entry.completed) : null;
        weeks.push({ score, isFuture: isFuture && !entry });
      }
      rows.push({ year: y, weeks });
    }
    return rows;
  }, [view, birthDate, lifeEndDate, weekMap]);

  const dayCells = useMemo(() => {
    if (view !== "year") return [];
    const today = todayDateOnly();
    const jan1 = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
    const byDate = new Map(stats.map((row) => [row.date, row]));
    const cells: { date: string; score: number | null }[] = [];
    for (let d = jan1; d.getTime() <= today.getTime(); d = addDays(d, 1)) {
      const dateStr = formatDateOnly(d);
      const row = byDate.get(dateStr);
      cells.push({ date: dateStr, score: row ? statToScore(row.due_count, row.weighted_completed_count) : null });
    }
    return cells;
  }, [view, stats]);

  const globalStat = useMemo(() => {
    const scores = Array.from(weekMap.values()).map((e) => statToScore(e.due, e.completed));
    const withData = scores.filter((s): s is number => s !== null);
    const avg = withData.length ? Math.round(withData.reduce((a, b) => a + b, 0) / withData.length) : null;
    return { count: withData.length, avg };
  }, [weekMap]);

  const yearStat = useMemo(() => {
    const scores = stats.map((row) => statToScore(row.due_count, row.weighted_completed_count));
    const withData = scores.filter((s): s is number => s !== null);
    const avg = withData.length ? Math.round(withData.reduce((a, b) => a + b, 0) / withData.length) : null;
    return { count: stats.length, avg };
  }, [stats]);

  if (user && !user.birth_date) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="font-heading text-lg font-semibold">Memento Mori</h1>
        <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
          Esta vista necesita tu fecha de nacimiento para dibujarse — configúrala en tu perfil.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-lg font-semibold">Memento Mori</h1>
        <p className="font-heading text-lg italic text-foreground">
          Cada semana que registras es una huella de la persona que estás construyendo.
        </p>
      </div>

      <div className="flex gap-1 rounded-lg border border-border bg-secondary p-1">
        {(["global", "year"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className={cn(
              "flex-1 rounded-md px-3 py-2 text-sm font-semibold",
              view === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground",
            )}
            onClick={() => setView(mode)}
          >
            {mode === "global" ? "Vista global" : "Vista por año"}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando...</p>
      ) : !error ? (
        <>
          {view === "global" ? (
            <>
              <p className="text-sm text-muted-foreground">
                {LIFE_EXPECTANCY_YEARS} años de vida, semana a semana ·{" "}
                <span className="font-semibold text-foreground">{globalStat.count}</span> registradas
                {globalStat.avg !== null && (
                  <>
                    {" "}
                    · promedio <span className="font-semibold text-foreground">{globalStat.avg}%</span>
                  </>
                )}
              </p>

              {/* Grid fluido (columnas 1fr, nunca px fijo) — cada celda ocupa
                  exactamente el ancho disponible del contenedor, así que
                  53 semanas × ~90 años entran siempre sin scroll horizontal,
                  en mobile o PC, sin importar el viewport. `max-w` evita que
                  las celdas se vuelvan bloques enormes en pantallas anchas. */}
              <div className="rounded-3xl border border-border bg-card p-3">
                <div className="mx-auto flex max-w-[420px] flex-col gap-[1.5px]">
                  {weekRows.map((row) => (
                    <div key={row.year} className="flex items-center gap-1">
                      <span className="w-5 shrink-0 text-right text-[9px] leading-none text-muted-foreground">
                        {String(row.year).slice(2)}
                      </span>
                      <div
                        className="grid flex-1 gap-[1px]"
                        style={{ gridTemplateColumns: `repeat(${WEEKS_PER_ROW}, minmax(0, 1fr))` }}
                      >
                        {row.weeks.map((cell, i) => (
                          <Cell
                            key={i}
                            score={cell.score}
                            isFuture={cell.isFuture}
                            title={`${row.year} · semana ${i + 1}`}
                            className="aspect-square rounded-[1px]"
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                  {weekRows.length === 0 && (
                    <p className="text-sm text-muted-foreground">Configura tu fecha de nacimiento para ver esta vista.</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground">{yearStat.count}</span> días registrados este año
                {yearStat.avg !== null && (
                  <>
                    {" "}
                    · promedio <span className="font-semibold text-foreground">{yearStat.avg}%</span>
                  </>
                )}
              </p>

              <div className="rounded-3xl border border-border bg-card p-4">
                <div className="flex flex-wrap gap-1">
                  {dayCells.map((cell) => (
                    <Cell key={cell.date} score={cell.score} title={cell.date} />
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      ) : null}

      <HeatmapLegend showFuture={view === "global"} />
    </div>
  );
}
