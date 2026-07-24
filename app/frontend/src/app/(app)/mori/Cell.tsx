import { scoreToColor } from "@/lib/heatmap";
import { cn } from "@/lib/utils";

type CellProps = {
  title: string;
  /** null junto con isFuture=false = "sin registro" real (antes del primer
   * HabitLog, o un día pasado sin ningún hábito activo). Ignorado si
   * isFuture=true. */
  score: number | null;
  /** Fecha estrictamente posterior a hoy — todavía no puede tener datos,
   * se distingue visualmente de "sin registro" (ver Calendario, mismo
   * tratamiento). */
  isFuture?: boolean;
  /** Override de tamaño — default `size-2.5` (vista por año, un día por
   * celda). La vista global (una celda por semana, 53 columnas × ~90 filas)
   * necesita celdas más chicas para caber sin scroll horizontal, ver
   * mori/page.tsx. */
  className?: string;
};

/** Celda cuadrada mínima del heatmap (una semana o un día). */
export function Cell({ score, title, isFuture = false, className }: CellProps) {
  return (
    <span
      title={title}
      className={cn(
        className ?? "size-2.5 shrink-0 rounded-[2px]",
        isFuture && "border border-dashed border-border bg-transparent",
      )}
      style={isFuture ? undefined : { backgroundColor: scoreToColor(score) }}
    />
  );
}
