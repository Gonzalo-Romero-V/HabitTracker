---
status: draft
type: domain
layer: H2
created: 2026-07-17
code_path: app/backend/app/Models/Habit.php
---

# Habit

## Definición

Un hábito que un [[user]] quiere sostener en el tiempo. Define **qué** se
rastrea (binario o cuantificable), **cuándo** está programado (regla de
recurrencia) y opcionalmente a qué [[category]] pertenece. Es la entidad
raíz de la que cuelgan [[habit-metric]], [[habit-log]] y [[reminder]].

## Estados

- `active` — genera ocurrencias según su recurrencia; su racha (streak)
  avanza o se rompe según el cumplimiento.
- `archived` — terminal. Deja de generar nuevas ocurrencias; su historial
  de [[habit-log]] se conserva pero ya no se evalúa para streak activo.

No existe un estado `paused` con congelamiento de racha ("modo vacaciones")
— eso está explícitamente fuera de alcance del MVP (ver [[vision]]). Pausar
hoy significa archivar; retomar el hábito implica crear uno nuevo.

`archived` es un estado de dominio, no un borrado. El endpoint `DELETE`
(ver [[api-contracts]]) existe como borrado físico real, pero es una
operación de mantenimiento/corrección de errores — el flujo normal de la
app usa siempre `archive`, nunca `DELETE`, para "dejar de seguir" un
hábito sin perder su historial.

## Atributos clave

- `tracking_type` ∈ `{binary, quantifiable}` — inmutable una vez creado el
  hábito (cambiarlo invalidaría la interpretación de los [[habit-log]]
  históricos). Si `quantifiable`, el hábito tiene una o más
  [[habit-metric]] asociadas (el usuario define sus propias métricas, ej.
  para "leer un libro": una métrica de tiempo y otra de páginas).
- `recurrence_type` ∈ `{fixed, quota}` — **la decisión que determina qué
  significa "programado" para este hábito**. Inmutable una vez creado
  (igual razón que `tracking_type`: cambiarlo invalidaría cómo se
  interpretan los [[habit-log]] históricos). Dos motores de recurrencia
  distintos, sin mezclar:
  - **`fixed`** — el usuario elige de antemano días concretos (ej.
    lunes/miércoles/viernes, o todos los días). Se expresa como
    `recurrence_rule`, una regla RFC5545/RRULE (`FREQ=DAILY`,
    `FREQ=WEEKLY;BYDAY=MO,WE,FR`, `FREQ=WEEKLY;INTERVAL=2`, etc.). Un
    Service del backend expande la regla a fechas concretas de ocurrencia
    (ver [[architecture]]). "3 veces por semana" en este modo = el usuario
    literalmente eligió 3 días fijos vía `BYDAY` — no una cuota flexible.
  - **`quota`** — el usuario define una meta de frecuencia SIN días fijos:
    `quota_target` (entero, ej. `3`) veces por `quota_period` (enum, MVP
    soporta solo `week` — semana ISO en el timezone del usuario). No hay
    "días programados": el usuario registra cumplimiento el día que quiera
    dentro del período, y el período se da por cumplido si la cantidad de
    [[habit-log]] `completed` dentro de él alcanza `quota_target`. No usa
    `recurrence_rule` — no requiere RRULE, es aritmética simple de
    ventana de fechas.
  - Solo uno de los dos grupos de campos aplica según `recurrence_type`
    (`recurrence_rule` para `fixed`; `quota_target`+`quota_period` para
    `quota`) — el otro grupo queda `null`.
  - `quota_target`/`quota_period` son **versionados**: cada cambio que el
    usuario hace queda registrado con su fecha de vigencia en la tabla
    `habit_quota_versions` (mecanismo H4 fijado en [[architecture]] →
    Versionado de metas; mismo mecanismo que `target_value` en
    [[habit-metric]]). El streak y cualquier gráfica de racha de un
    hábito `quota`
    siempre evalúan cada período contra el valor que estaba vigente en la
    fecha de ese período, no contra el valor actual. La gráfica de meta a
    través del tiempo se dibuja como función escalonada (el valor vigente
    en cada tramo), nunca como línea horizontal fija.
- `current_streak` / `best_streak` — **derivados**, no la fuente de verdad.
  Se recalculan a partir del historial de [[habit-log]] — la unidad de
  cálculo depende de `recurrence_type` (ver [[habit-log]] → Reglas de
  negocio). Pueden denormalizarse en la tabla por performance, pero ante
  cualquier duda el historial de logs manda.

## Relaciones

- N:1 con [[user]] — pertenece a un único usuario.
- N:1 (opcional) con [[category]].
- 1:N con [[habit-metric]] — solo si `tracking_type = quantifiable`.
- 1:N con [[habit-log]] — una ocurrencia programada genera un log.
- 1:N con [[reminder]] — un hábito puede tener más de un recordatorio
  (ej. mañana y noche).

## Reglas de negocio

- El día (y, para `quota`, la semana ISO) que determina si un hábito "está
  programado" o "en curso" usa siempre el `timezone` de su [[user]] dueño,
  nunca UTC ni el timezone del servidor.
- Editar `recurrence_rule` (o `quota_target`/`quota_period`) afecta solo
  ocurrencias/períodos futuros; no reescribe `occurrence_date` de
  [[habit-log]] ya generados ni re-evalúa períodos ya cerrados.
- Un hábito `binary` se considera `completed` en su [[habit-log]] del día
  con un solo check-off. Un hábito `quantifiable` requiere que **todas**
  sus [[habit-metric]] alcancen el `target_value` correspondiente vía sus
  [[habit-metric-log]] de esa ocurrencia. Esta regla es ortogonal a
  `recurrence_type` — aplica igual en `fixed` y en `quota`.
- Ruptura de streak — mismo principio (sin tolerancia), distinta unidad de
  evaluación según `recurrence_type`:
  - `fixed`: fallar una ocurrencia programada (día programado sin
    `HabitLog` `completed`) rompe `current_streak` a 0 apenas ese día
    cierra.
  - `quota`: no alcanzar `quota_target` logs `completed` dentro del
    período rompe `current_streak` a 0 apenas ese período (semana) cierra
    — nunca antes, mismo principio que en `fixed` de no penalizar un
    período/día todavía en curso.
- Archivar un hábito no borra su historial; solo detiene la generación de
  nuevas ocurrencias/períodos y su evaluación de streak.

## Notas de implementación

`HabitController` implementa CRUD + `archive` (acción dedicada, no
`DELETE`). `quota_target`/`quota_period` se versionan en la tabla
`habit_quota_versions` (ver [[architecture]] → Versionado de metas);
`HabitResource` expone siempre la versión vigente, no la última fila
insertada por fecha de creación. `category_id` usa `nullOnDelete()` hacia
`categories` — borrar una categoría nunca borra ni bloquea el hábito (ver
[[category]]). La materialización de `HabitLog` `pending` (job mensual +
bootstrap síncrono al crear un hábito `fixed`) queda pendiente para el
incremento 2 — todavía no existe la tabla `habit_logs`.

## Actualización 2026-09-28 — auditoría de lógica (commit 466e1f3)
Estado real tras la auditoría. Reemplaza lo que el cuerpo anterior diga en
contrario (incluida la nota de implementación "la materialización queda
pendiente para el incremento 2", ya resuelta hace tiempo).

**Ciclo de vida** (`HabitLifecycleService`):
- `archive`: borra las ocurrencias `pending` desde hoy en adelante y pasa a
  `archived`. El job de cierres ignora hábitos archivados, así que el hueco
  es neutro (nunca genera `missed`).
- `unarchive`: vuelve a `active`, guarda `reactivated_on` (fecha en el
  timezone del usuario), materializa desde hoy hasta fin de mes y recalcula
  la racha. `StreakService` reinicia `current_streak` en `reactivated_on`;
  `best_streak` conserva el historial. Devuelve 422 si la vigencia ya
  venció (hay que actualizarla antes de reactivar).
- El auto-archivado por vigencia vencida usa el mismo `archive()`.

**Edición:**
- Cambiar `recurrence_rule` o la vigencia regenera las `pending`
  posteriores a hoy (`rescheduleFuture`); hoy y el pasado no se tocan.
- `quota_target` máximo 7 (un hábito `quota` admite un solo log por día).
  `recurrence_rule` solo se acepta en hábitos `fixed` y
  `quota_target`/`quota_period` solo en `quota` (422 si no).
- Versionado idempotente (`Habit::recordQuotaVersion`): no inserta si el
  valor no cambió, y una segunda edición el mismo día reemplaza la versión
  de ese día en vez de duplicar `effective_from`. `effective_from` es "hoy"
  en el timezone del usuario (`User::today()`), nunca la fecha UTC del
  servidor.

**Fechas:**
- `Habit::createdDateInUserTz()` es el DTSTART de la RRULE: antes se usaba
  la fecha UTC de `created_at`, y un hábito creado de noche en
  America/Guayaquil excluía su propio día de creación.
- `duration_days = N` son N días contando el de creación (último día =
  creación + N − 1). Antes daba un día de más.
- Editar un hábito que vence hoy ya no da 422 (`after_or_equal`).

**Racha `quota`:** ver [[vision]] → Actualización 2026-09-28. La meta de
cada semana es la versión vigente al inicio de la semana; en la semana de
creación, la vigente al final de ella.
