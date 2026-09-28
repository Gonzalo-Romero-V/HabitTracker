import type { NewMetricInput } from "@/hooks/useHabits";

export const DAYS: { value: string; label: string }[] = [
  { value: "MO", label: "L" },
  { value: "TU", label: "M" },
  { value: "WE", label: "M" },
  { value: "TH", label: "J" },
  { value: "FR", label: "V" },
  { value: "SA", label: "S" },
  { value: "SU", label: "D" },
];

export function buildRecurrenceRule(selectedDays: string[]): string {
  if (selectedDays.length === 7) return "FREQ=DAILY";

  const ordered = DAYS.filter((d) => selectedDays.includes(d.value)).map((d) => d.value);

  return `FREQ=WEEKLY;BYDAY=${ordered.join(",")}`;
}

export function parseRecurrenceRule(rule: string): string[] {
  if (rule === "FREQ=DAILY") return DAYS.map((d) => d.value);

  const match = rule.match(/BYDAY=([A-Z,]+)/);
  if (!match) return DAYS.map((d) => d.value);

  return match[1].split(",");
}

export const METRIC_TYPE_INFO: Record<
  NewMetricInput["metric_type"],
  { label: string; help: string; targetLabel: string; targetPlaceholder: string }
> = {
  count: {
    label: "Cantidad",
    help: "Un número simple con una unidad libre (páginas, vasos, km, repeticiones...).",
    targetLabel: "Meta (cantidad)",
    targetPlaceholder: "20",
  },
  duration: {
    label: "Duración",
    help: "Tiempo. Ingresa la meta en minutos — se guarda internamente en segundos.",
    targetLabel: "Meta (minutos)",
    targetPlaceholder: "30",
  },
  currency: {
    label: "Monto",
    help: "Dinero. Ingresa la meta en la unidad de tu moneda (ej. dólares) — se guarda en centavos.",
    targetLabel: "Meta (monto)",
    targetPlaceholder: "20.00",
  },
};

/** Convierte el valor ingresado por el usuario (unidad natural) a lo que
 * espera el backend: duration en segundos, currency en centavos (ver
 * domain/habit-metric.md — nunca floats ambiguos). */
export function toStoredTargetValue(metricType: NewMetricInput["metric_type"], value: number): number {
  if (metricType === "duration") return Math.round(value * 60);
  if (metricType === "currency") return Math.round(value * 100);
  return value;
}

/** Inverso de toStoredTargetValue — para precargar el formulario de edición
 * con el valor en la unidad natural que el usuario espera ver. */
export function fromStoredTargetValue(metricType: NewMetricInput["metric_type"], value: number): number {
  if (metricType === "duration") return value / 60;
  if (metricType === "currency") return value / 100;
  return value;
}
