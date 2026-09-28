"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Plus, X } from "lucide-react";
import {
  createHabit,
  updateHabit,
  deleteHabit,
  archiveHabit,
  unarchiveHabit,
  createHabitMetric,
  updateHabitMetric,
  deleteHabitMetric,
  type Habit,
  type NewMetricInput,
  type DurationType,
} from "@/hooks/useHabits";
import { useCategories } from "@/hooks/useCategories";
import { useCategoryForm } from "@/components/custom/CategoryFormProvider";
import { listReminders, createReminder, updateReminder, deleteReminder } from "@/hooks/useReminders";
import { ApiError } from "@/lib/api";
import {
  DAYS,
  buildRecurrenceRule,
  parseRecurrenceRule,
  METRIC_TYPE_INFO,
  toStoredTargetValue,
  fromStoredTargetValue,
} from "@/lib/habit-form-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type TrackingType = "binary" | "quantifiable";
type RecurrenceType = "fixed" | "quota";

/** Una fila de métrica en el formulario. `id` presente = ya existe en el
 * backend; ausente = fila nueva agregada en esta sesión de edición (ver
 * domain/habit-metric.md — un hábito quantifiable puede tener N métricas). */
type MetricRow = {
  id?: number;
  name: string;
  metric_type: NewMetricInput["metric_type"];
  unit: string;
  goal: number;
};

const emptyMetricRow: MetricRow = { name: "", metric_type: "count", unit: "", goal: 1 };

type FormState = {
  name: string;
  categoryId: string;
  trackingType: TrackingType;
  metrics: MetricRow[];
  recurrenceType: RecurrenceType;
  days: string[];
  timesPerWeek: number;
  durationType: DurationType;
  durationEndDate: string;
  durationDays: number;
  reminderOn: boolean;
  reminderTime: string;
};

const emptyForm: FormState = {
  name: "",
  categoryId: "",
  trackingType: "binary",
  metrics: [{ ...emptyMetricRow }],
  recurrenceType: "fixed",
  days: DAYS.map((d) => d.value),
  timesPerWeek: 3,
  durationType: "indefinite",
  durationEndDate: "",
  durationDays: 30,
  reminderOn: false,
  reminderTime: "08:00",
};

type HabitFormContextValue = {
  openNew: () => void;
  openEdit: (habit: Habit) => void;
  /** Incrementa cada vez que se guarda/elimina un hábito — las pantallas
   * lo agregan a su dependencia de recarga para refrescarse sin necesidad
   * de navegar. */
  version: number;
};

const HabitFormContext = createContext<HabitFormContextValue | null>(null);

export function useHabitForm(): HabitFormContextValue {
  const ctx = useContext(HabitFormContext);
  if (!ctx) throw new Error("useHabitForm debe usarse dentro de HabitFormProvider");
  return ctx;
}

export function HabitFormProvider({ children }: { children: ReactNode }) {
  const { categories, reload: reloadCategories } = useCategories();
  const { version: categoryVersion } = useCategoryForm();

  useEffect(() => {
    if (categoryVersion > 0) reloadCategories();
  }, [categoryVersion, reloadCategories]);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [existingReminderId, setExistingReminderId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [version, setVersion] = useState(0);

  function set<K extends keyof FormState>(field: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function toggleDay(day: string) {
    setForm((prev) => ({
      ...prev,
      days: prev.days.includes(day) ? prev.days.filter((d) => d !== day) : [...prev.days, day],
    }));
  }

  function updateMetricRow(index: number, patch: Partial<MetricRow>) {
    setForm((prev) => ({
      ...prev,
      metrics: prev.metrics.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    }));
  }

  function addMetricRow() {
    setForm((prev) => ({ ...prev, metrics: [...prev.metrics, { ...emptyMetricRow }] }));
  }

  function removeMetricRow(index: number) {
    setForm((prev) => ({ ...prev, metrics: prev.metrics.filter((_, i) => i !== index) }));
  }

  function openNew() {
    setEditing(null);
    setExistingReminderId(null);
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  }

  function openEdit(habit: Habit) {
    setEditing(habit);
    setForm({
      name: habit.name,
      categoryId: habit.category_id ? String(habit.category_id) : "",
      trackingType: habit.tracking_type,
      metrics:
        habit.metrics.length > 0
          ? habit.metrics.map((m) => ({
              id: m.id,
              name: m.name,
              metric_type: m.metric_type,
              unit: m.metric_type === "currency" ? (m.currency_code ?? "") : (m.unit ?? ""),
              goal: fromStoredTargetValue(m.metric_type, Number(m.target_value ?? 0)),
            }))
          : [{ ...emptyMetricRow }],
      recurrenceType: habit.recurrence_type,
      days: habit.recurrence_rule ? parseRecurrenceRule(habit.recurrence_rule) : DAYS.map((d) => d.value),
      timesPerWeek: habit.quota_target ?? 3,
      durationType: habit.duration_type,
      durationEndDate: habit.duration_end_date ?? "",
      durationDays: habit.duration_days ?? 30,
      reminderOn: false,
      reminderTime: "08:00",
    });
    setExistingReminderId(null);
    setError(null);
    setOpen(true);

    listReminders(habit.id)
      .then((reminders) => {
        if (reminders.length > 0) {
          setExistingReminderId(reminders[0].id);
          setForm((prev) => ({ ...prev, reminderOn: true, reminderTime: reminders[0].time_of_day }));
        }
      })
      .catch(() => {
        // Silencioso — el recordatorio es un detalle secundario del form, no bloquea la edición.
      });
  }

  async function syncReminder(habitId: number) {
    if (form.reminderOn) {
      if (existingReminderId) {
        await updateReminder(habitId, existingReminderId, form.reminderTime);
      } else {
        await createReminder(habitId, form.reminderTime);
      }
    } else if (existingReminderId) {
      await deleteReminder(habitId, existingReminderId);
    }
  }

  /** Solo el campo de vigencia que corresponde al `durationType` elegido —
   * el backend rechaza con 422 (`prohibited_unless`) si se manda el campo
   * que no corresponde al tipo. */
  function durationFields(): {
    duration_type: DurationType;
    duration_end_date?: string;
    duration_days?: number;
  } {
    if (form.durationType === "end_date") {
      return { duration_type: "end_date", duration_end_date: form.durationEndDate };
    }
    if (form.durationType === "duration_days") {
      return { duration_type: "duration_days", duration_days: form.durationDays };
    }
    return { duration_type: "indefinite" };
  }

  function metricPayload(m: MetricRow) {
    return {
      name: m.name,
      metric_type: m.metric_type,
      unit: m.metric_type === "count" ? m.unit : undefined,
      currency_code: m.metric_type === "currency" ? m.unit.toUpperCase() : undefined,
      target_value: toStoredTargetValue(m.metric_type, m.goal),
    };
  }

  /** Diff entre `editing.metrics` (estado original al abrir el modal) y
   * `form.metrics` (estado actual) — crea/actualiza/elimina solo lo que
   * cambió (ver domain/habit-metric.md — N métricas por hábito). */
  async function syncMetrics(habitId: number) {
    if (!editing) return;

    const originalMetrics = editing.metrics;
    const currentIds = new Set(
      form.metrics.filter((m): m is MetricRow & { id: number } => m.id != null).map((m) => m.id),
    );

    const toDelete = originalMetrics.filter((m) => !currentIds.has(m.id));
    const toCreate = form.metrics.filter((m) => m.id == null);
    const toUpdate = form.metrics.filter((m) => {
      if (m.id == null) return false;
      const original = originalMetrics.find((om) => om.id === m.id);
      if (!original) return false;
      const originalGoal = fromStoredTargetValue(original.metric_type, Number(original.target_value ?? 0));
      return original.name !== m.name || originalGoal !== m.goal;
    });

    // Borrar al final: el backend no permite dejar un hábito cuantificable
    // sin métricas, así que reemplazar la única métrica (borrar + crear) en
    // paralelo podía fallar según qué request llegara primero.
    await Promise.all(toCreate.map((m) => createHabitMetric(habitId, metricPayload(m))));
    await Promise.all(
      toUpdate.map((m) =>
        updateHabitMetric(habitId, m.id as number, {
          name: m.name,
          target_value: toStoredTargetValue(m.metric_type, m.goal),
        }),
      ),
    );
    await Promise.all(toDelete.map((m) => deleteHabitMetric(habitId, m.id)));
  }

  function validationError(): string | null {
    if (form.recurrenceType === "fixed" && form.days.length === 0) return "Elige al menos un día de la semana.";
    if (form.recurrenceType === "quota" && (form.timesPerWeek < 1 || form.timesPerWeek > 7)) {
      return "La cuota semanal debe estar entre 1 y 7 veces.";
    }
    if (form.trackingType === "quantifiable" && form.metrics.some((m) => !(m.goal > 0))) {
      return "La meta de cada métrica debe ser mayor que cero.";
    }
    return null;
  }

  async function handleSave() {
    setError(null);
    const invalid = validationError();
    if (invalid) {
      setError(invalid);
      return;
    }
    setIsSubmitting(true);

    try {
      if (editing) {
        // Solo se mandan los campos de agenda que cambiaron: el backend
        // versiona la cuota y regenera ocurrencias futuras al recibirlos
        // (ver decisions/architecture.md → Versionado de metas).
        const newRule = form.recurrenceType === "fixed" ? buildRecurrenceRule(form.days) : null;
        const quotaChanged = form.recurrenceType === "quota" && form.timesPerWeek !== editing.quota_target;
        const duration = durationFields();
        const durationChanged =
          duration.duration_type !== editing.duration_type ||
          (duration.duration_end_date ?? null) !== editing.duration_end_date ||
          (duration.duration_days ?? null) !== editing.duration_days;

        await updateHabit(editing.id, {
          name: form.name,
          category_id: form.categoryId ? Number(form.categoryId) : null,
          ...(newRule && newRule !== editing.recurrence_rule ? { recurrence_rule: newRule } : {}),
          ...(quotaChanged ? { quota_target: form.timesPerWeek, quota_period: "week" as const } : {}),
          ...(durationChanged ? duration : {}),
        });

        if (form.trackingType === "quantifiable") {
          await syncMetrics(editing.id);
        }

        await syncReminder(editing.id);
      } else {
        const habit = await createHabit({
          name: form.name,
          category_id: form.categoryId ? Number(form.categoryId) : undefined,
          tracking_type: form.trackingType,
          recurrence_type: form.recurrenceType,
          recurrence_rule: form.recurrenceType === "fixed" ? buildRecurrenceRule(form.days) : undefined,
          quota_target: form.recurrenceType === "quota" ? form.timesPerWeek : undefined,
          quota_period: form.recurrenceType === "quota" ? "week" : undefined,
          ...durationFields(),
          metrics: form.trackingType === "quantifiable" ? form.metrics.map(metricPayload) : undefined,
        });

        if (form.reminderOn) {
          await createReminder(habit.id, form.reminderTime);
        }
      }

      setOpen(false);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el hábito.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!editing) return;
    if (!window.confirm(`¿Eliminar el hábito "${editing.name}"? Esta acción no se puede deshacer.`)) return;

    setError(null);
    setIsSubmitting(true);
    try {
      await deleteHabit(editing.id);
      setOpen(false);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo eliminar el hábito.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleToggleArchive() {
    if (!editing) return;

    setError(null);
    setIsSubmitting(true);
    try {
      const updated =
        editing.status === "active" ? await archiveHabit(editing.id) : await unarchiveHabit(editing.id);
      setEditing(updated);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `No se pudo ${editing.status === "active" ? "archivar" : "reactivar"} el hábito.`,
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <HabitFormContext.Provider value={{ openNew, openEdit, version }}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-heading">
              {editing ? "Editar hábito" : "Nuevo hábito"}
              {editing?.status === "archived" && (
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-normal text-muted-foreground">
                  Archivado
                </span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="habit-name">Nombre del hábito</Label>
              <Input
                id="habit-name"
                required
                placeholder="Ej. Meditar 10 minutos"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Categoría</Label>
              <Select value={form.categoryId || "none"} onValueChange={(v) => set("categoryId", v === "none" ? "" : v)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin categoría</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-2">
              <Label>Tipo</Label>
              <div className="flex gap-1 rounded-lg border border-border bg-secondary p-1">
                {(["binary", "quantifiable"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    disabled={!!editing}
                    className={cn(
                      "flex-1 rounded-md px-3 py-2 text-sm font-semibold",
                      form.trackingType === t ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                      editing && "cursor-not-allowed opacity-60",
                    )}
                    onClick={() => set("trackingType", t)}
                  >
                    {t === "binary" ? "Binario (sí/no)" : "Cuantificable"}
                  </button>
                ))}
              </div>
              {editing && <p className="text-xs text-muted-foreground">El tipo no se puede cambiar después de crear el hábito.</p>}
            </div>

            {form.trackingType === "quantifiable" && (
              <div className="flex flex-col gap-2">
                {form.metrics.map((metric, idx) => (
                  <div key={idx} className="flex flex-col gap-2 rounded-md border border-border p-3">
                    <div className="flex items-center gap-2">
                      <Input
                        placeholder="Nombre de la métrica (ej. Páginas leídas)"
                        required
                        className="flex-1"
                        value={metric.name}
                        onChange={(e) => updateMetricRow(idx, { name: e.target.value })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Eliminar métrica"
                        disabled={form.metrics.length <= 1}
                        onClick={() => removeMetricRow(idx)}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                    {/* Tipo y unidad/moneda son inmutables en una métrica ya
                        creada (domain/habit-metric.md): el historial ya está
                        guardado en esa unidad, y el backend solo acepta
                        cambiar nombre y meta. */}
                    <Select
                      value={metric.metric_type}
                      disabled={metric.id != null}
                      onValueChange={(v) => updateMetricRow(idx, { metric_type: v as NewMetricInput["metric_type"] })}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="count">Cantidad (conteo)</SelectItem>
                        <SelectItem value="duration">Duración (minutos)</SelectItem>
                        <SelectItem value="currency">Monto (dinero)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">{METRIC_TYPE_INFO[metric.metric_type].help}</p>
                    <div className="flex gap-2">
                      {metric.metric_type !== "duration" && (
                        <Input
                          placeholder={
                            metric.metric_type === "currency" ? "Moneda (ISO, ej. USD)" : "Unidad (ej. vasos, páginas)"
                          }
                          className="flex-1"
                          disabled={metric.id != null}
                          maxLength={metric.metric_type === "currency" ? 3 : undefined}
                          value={metric.unit}
                          onChange={(e) =>
                            updateMetricRow(idx, {
                              unit: metric.metric_type === "currency" ? e.target.value.toUpperCase() : e.target.value,
                            })
                          }
                        />
                      )}
                      <div className="flex flex-1 flex-col gap-1">
                        <Label className="text-xs font-normal text-muted-foreground">
                          {METRIC_TYPE_INFO[metric.metric_type].targetLabel}
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          step={metric.metric_type === "currency" ? "0.01" : "1"}
                          placeholder={METRIC_TYPE_INFO[metric.metric_type].targetPlaceholder}
                          required
                          value={metric.goal}
                          onChange={(e) => updateMetricRow(idx, { goal: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="self-start" onClick={addMetricRow}>
                  <Plus className="size-4" />
                  Agregar métrica
                </Button>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label>Recurrencia</Label>
              <div className="flex gap-1 rounded-lg border border-border bg-secondary p-1">
                {(["fixed", "quota"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={!!editing}
                    className={cn(
                      "flex-1 rounded-md px-3 py-2 text-sm font-semibold",
                      form.recurrenceType === r ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                      editing && "cursor-not-allowed opacity-60",
                    )}
                    onClick={() => set("recurrenceType", r)}
                  >
                    {r === "fixed" ? "Días fijos" : "Cuota semanal"}
                  </button>
                ))}
              </div>
              {editing && (
                <p className="text-xs text-muted-foreground">
                  El modo de recurrencia no se puede cambiar, pero sí sus valores (días u objetivo).
                </p>
              )}
            </div>

            {form.recurrenceType === "fixed" ? (
              <div className="flex gap-1.5">
                {DAYS.map((day) => {
                  const selected = form.days.includes(day.value);
                  return (
                    <button
                      key={day.value}
                      type="button"
                      className={cn(
                        "flex-1 rounded-lg py-2 text-xs font-bold",
                        selected ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground",
                      )}
                      onClick={() => toggleDay(day.value)}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-sm">Veces por semana</span>
                <Input
                  type="number"
                  min={1}
                  max={7}
                  className="w-20"
                  value={form.timesPerWeek}
                  onChange={(e) => set("timesPerWeek", Number(e.target.value))}
                />
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label>Vigencia</Label>
              <div className="flex gap-1 rounded-lg border border-border bg-secondary p-1">
                {(["indefinite", "end_date", "duration_days"] as const).map((d) => (
                  <button
                    key={d}
                    type="button"
                    className={cn(
                      "flex-1 rounded-md px-3 py-2 text-sm font-semibold",
                      form.durationType === d ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                    )}
                    onClick={() => set("durationType", d)}
                  >
                    {d === "indefinite" ? "Indefinido" : d === "end_date" ? "Fecha de fin" : "Duración (días)"}
                  </button>
                ))}
              </div>
              {form.durationType === "end_date" && (
                <Input
                  type="date"
                  value={form.durationEndDate}
                  onChange={(e) => set("durationEndDate", e.target.value)}
                />
              )}
              {form.durationType === "duration_days" && (
                <Input
                  type="number"
                  min={1}
                  value={form.durationDays}
                  onChange={(e) => set("durationDays", Number(e.target.value))}
                />
              )}
              {editing?.effective_end_date && (
                <p className="text-xs text-muted-foreground">Vence el {editing.effective_end_date}</p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <Label className="mb-0">Recordatorio</Label>
              <Switch checked={form.reminderOn} onCheckedChange={(v) => set("reminderOn", v)} />
            </div>
            {form.reminderOn && (
              <Input
                type="time"
                value={form.reminderTime}
                onChange={(e) => set("reminderTime", e.target.value)}
              />
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="mt-2 flex flex-wrap gap-2">
              {editing && (
                <>
                  <Button type="button" variant="outline" onClick={handleToggleArchive} disabled={isSubmitting}>
                    {editing.status === "active" ? "Archivar" : "Reactivar"}
                  </Button>
                  <Button type="button" variant="destructive" onClick={handleDelete} disabled={isSubmitting}>
                    Eliminar
                  </Button>
                </>
              )}
              <div className="flex-1" />
              <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={isSubmitting}>
                Cancelar
              </Button>
              <Button type="button" onClick={handleSave} disabled={isSubmitting || !form.name.trim()}>
                Guardar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </HabitFormContext.Provider>
  );
}
