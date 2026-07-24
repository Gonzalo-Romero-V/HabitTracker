/** Rampa continua DIVERGENTE para score 0-100 (bajo→excelente, ver
 * decisions/design-system.md). Segunda versión — la primera (barrido de
 * matiz rojo→naranja→amarillo→verde→azul) leía como "arcoíris": estudios
 * de percepción muestran que las escalas arcoíris son más lentas de leer
 * y producen más errores que una escala de 2 tonos con punto neutro medio
 * (ver ColorBrewer RdBu/RdYlBu — divergentes, color-blind-safe, el
 * estándar validado para justamente este caso: dos polos + neutro).
 *
 * Estructura (nunca más de 2 tonos, nunca un barrido de matiz):
 *   score 100 (excelente) → `--primary` (azul de marca)
 *   score  50 (punto medio)→ `--muted-foreground` (neutro, sin matiz)
 *   score   0 (bajo)       → `--destructive` (rojo de marca)
 * Cada mitad interpola SOLO chroma/lightness hacia el neutro (vía
 * `color-mix`), nunca el matiz — así nunca aparecen verdes/amarillos de
 * paso. `color-mix` resuelve las `var(--token)` en el momento del paint,
 * así que la rampa se adapta sola a claro/oscuro sin lógica de tema en JS
 * (mismo mecanismo que el resto del design system, ver decisions/
 * design-system.md — nunca hardcodear un color que dependa del tema). */
const RAMP_GOOD = "var(--primary)";
const RAMP_NEUTRAL = "var(--muted-foreground)";
const RAMP_BAD = "var(--destructive)";

/** Puntos de muestreo de la rampa (cada 10 de score) — usados para dibujar
 * la barra de degradé continuo en la leyenda (ver HeatmapLegend.tsx). No es
 * una lista de "buckets": scoreToColor sigue interpolando en continuo para
 * cualquier score exacto, esto es solo para construir el `linear-gradient`
 * de la UI. */
export const HEATMAP_GRADIENT_SAMPLE_SCORES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;

/** score: 0-100, o null si el día/semana no tiene datos (sin hábitos
 * activos ese día — distinto de 0%, ver domain/user-daily-stat.md). */
export function scoreToColor(score: number | null): string {
  if (score === null) return "var(--track)";

  const clamped = Math.min(100, Math.max(0, score));

  if (clamped === 50) return RAMP_NEUTRAL;

  const pole = clamped > 50 ? RAMP_GOOD : RAMP_BAD;
  const t = (Math.abs(clamped - 50) / 50) * 100; // 0 en el medio, 100 en el extremo
  const poleShare = Math.round(t * 10) / 10;
  const neutralShare = Math.round((100 - t) * 10) / 10;

  return `color-mix(in oklch, ${pole} ${poleShare}%, ${RAMP_NEUTRAL} ${neutralShare}%)`;
}

export function statToScore(dueCount: number, completedCount: number): number | null {
  if (!dueCount) return null;
  const score = Math.round((completedCount / dueCount) * 100);
  // Nunca dejar escapar un NaN hacia el render — un valor no numérico acá
  // (ej. un campo faltante en una respuesta vieja de la API) debe leerse
  // como "sin dato", nunca como el string literal "NaN%" en pantalla.
  return Number.isFinite(score) ? score : null;
}
