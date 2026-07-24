import { HEATMAP_GRADIENT_SAMPLE_SCORES, scoreToColor } from "@/lib/heatmap";

type HeatmapLegendProps = {
  /** Mostrar el ítem discreto "Futuro" (swatch punteado) — solo aplica a
   * Memento Mori, que distingue semanas futuras. Calendario no lo necesita
   * porque los días futuros ni siquiera se pintan. */
  showFuture?: boolean;
  className?: string;
};

/** Leyenda de la rampa continua de color (score 0-100, ver lib/heatmap.ts)
 * compartida entre Calendario y Memento Mori. La rampa ya no es de 5 pasos
 * discretos — se muestra como una barra de degradé continuo muestreando
 * `scoreToColor` cada 10 puntos, con "Bajo"/"Excelente" en los extremos.
 * "Sin registro" y "Futuro" (opcional) siguen siendo estados discretos
 * legítimos, no parte de la rampa, y se mantienen como swatches aparte. */
export function HeatmapLegend({ showFuture = false, className }: HeatmapLegendProps) {
  const gradient = HEATMAP_GRADIENT_SAMPLE_SCORES.map((s) => scoreToColor(s)).join(", ");

  return (
    <div className={className ?? "flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3"}>
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Bajo</span>
        <span
          className="h-2.5 w-20 rounded-full"
          style={{ background: `linear-gradient(to right, ${gradient})` }}
        />
        <span className="text-xs text-muted-foreground">Excelente</span>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[2px]" style={{ backgroundColor: scoreToColor(null) }} />
        <span className="text-xs text-muted-foreground">Sin registro</span>
      </div>
      {showFuture && (
        <div className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px] border border-dashed border-border" />
          <span className="text-xs text-muted-foreground">Futuro</span>
        </div>
      )}
    </div>
  );
}
