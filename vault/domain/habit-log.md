---
status: draft
type: domain
layer: H2
created: 2026-07-17
code_path: app/backend/app/Models/HabitLog.php
---

# HabitLog

## Definición

El registro de cumplimiento de un [[habit]] para **una fecha concreta** —
la unidad atómica sobre la que se calcula el streak. Su origen difiere
según el `recurrence_type` del hábito (ver [[habit]]):

- **`fixed`**: la fecha viene pre-determinada — un Service expande la
  `recurrence_rule` a fechas de ocurrencia programadas, y cada una tiene,
  como mucho, un `HabitLog`.
- **`quota`**: no hay fechas pre-determinadas — el `HabitLog` se crea
  directamente el día que el usuario registra cumplimiento (fecha
  auto-seleccionada, cualquier día dentro del `quota_period` en curso).

## Estados

- `pending` — **solo aplica a `fixed`**: la ocurrencia está programada
  para hoy (o una fecha futura aún no cerrada) y todavía no se completó.
  En `quota` no existe este estado — no hay ocurrencia pre-programada
  esperando; el log nace cuando el usuario efectivamente registra algo.
- `completed` — para un hábito `binary`: se hizo check-off. Para uno
  `quantifiable`: todas sus [[habit-metric]] alcanzaron el `target_value`
  vía sus [[habit-metric-log]] de esta ocurrencia. En `quota`, un
  `HabitLog` nace directamente en este estado (no pasa por `pending`).
- `missed` — **solo aplica a `fixed`**: el día de la ocurrencia cerró
  (terminó, según el `timezone` del [[user]]) sin que el log llegara a
  `completed`. Estado terminal. En `quota` no existe `missed` a nivel de
  `HabitLog` individual — "no llegar a la cuota" es un hecho del *período*
  (ver [[habit]] → Reglas de negocio), no de un día puntual; no genera una
  fila de `HabitLog`, se calcula al cerrar el período.

## Atributos clave

- `occurrence_date` — fecha de calendario (en el timezone del usuario) que
  este log representa. Junto con `habit_id`, es **único** — invariante
  documentada en [[vision]].
- `completed_at` — timestamp de cuándo se marcó `completed` (nulo si no).

## Relaciones

- N:1 con [[habit]].
- 1:N con [[habit-metric-log]] — solo si el hábito es `quantifiable`; un
  valor logueado por cada [[habit-metric]] del hábito, para esta
  ocurrencia.

## Reglas de negocio

- `habit_id` + `occurrence_date` es una combinación única — crear un log
  duplicado para la misma fecha es un error (422), no un upsert silencioso
  (ver [[api-contracts]]). Aplica igual en `fixed` y en `quota`: **un
  hábito `quota` admite como máximo un `HabitLog` por día** — dos
  cumplimientos el mismo día no cuentan doble hacia `quota_target`. Es una
  simplificación deliberada del MVP (evita ramificar el schema); si hace
  falta contar múltiples cumplimientos por día, es una revisión futura.
- **Streak en `fixed`**: cuenta de ocurrencias consecutivas `completed`
  terminando en la más reciente evaluada. El primer `missed` en la
  secuencia la resetea a 0 — sin tolerancia (ver invariante en [[vision]]).
  Un log solo pasa a `missed` cuando el día de su `occurrence_date` ya
  cerró en el timezone del usuario — nunca antes.
- **Streak en `quota`**: no se mide por `HabitLog` individual sino por
  período. Un período (semana ISO, en el timezone del usuario) cuenta como
  cumplido cuando el número de `HabitLog` `completed` con `occurrence_date`
  dentro de esa semana alcanza `quota_target` del [[habit]]. El streak es
  la cuenta de períodos consecutivos cumplidos; el primer período que
  cierra sin alcanzar la cuota lo resetea a 0. Un período solo se evalúa
  como "no cumplido" cuando la semana ya cerró — nunca antes.

## Notas de implementación

Las ocurrencias `pending` de un hábito `fixed` se **pre-generan por mes
calendario real** (no ventana rodante de 30 días): un job mensual, al
cierre de cada mes (evaluado en el timezone de cada [[user]]), expande la
`recurrence_rule` del hábito y materializa de una vez las filas `pending`
del mes siguiente completo. Ese mismo job es el punto donde se consolidan
las estadísticas del mes que acaba de cerrar (ver
[[habit-monthly-stat]]) — generación de ocurrencias y consolidación de
stats son la misma operación mensual, no dos jobs separados.

Los `HabitLog` individuales **nunca se purgan ni se resumen** — la
consolidación mensual es una tabla-cache de agregados derivada, siempre
recalculable desde el detalle. El streak sigue derivándose del historial
completo de `HabitLog`, nunca de los agregados mensuales (ver invariante
en [[vision]]).

Como consecuencia de pre-generar el mes completo, el total de logs de un
hábito crece rápido (historial pasado + resto del mes futuro). Cualquier
consumidor de `GET /habits/{habit}/logs` que necesite una fecha puntual
(ej. "hoy") **debe** pasar `from`/`to` — el default es paginado
descendente por `occurrence_date`, así que sin rango explícito una fecha
puede quedar fuera de la primera página (ver [[api-contracts]]).

Un `HabitLog` admite borrado físico (deshacer un check-off), no solo
`create`/`update`. Borrar un log libera la combinación única
`habit_id`+`occurrence_date` (puede volver a registrarse) y obliga a
re-evaluar el streak/período afectado, igual que si nunca se hubiera
completado.

### Mecanismo H4: create vs. update en la API

`POST /habits/{habit}/logs` crea una fila nueva (422 si ya existe una para
esa `occurrence_date`, ver Reglas de negocio) — es el camino normal para
`quota` (no hay fila previa) y para `fixed` cuando, por alguna razón, la
ocurrencia todavía no fue pre-generada por el job mensual (ventana no
materializada). `PATCH /habits/{habit}/logs/{log}` actualiza una fila
existente — es el camino normal para `fixed` (la fila `pending` ya existe
por el job mensual, el check-off la actualiza a `completed`). Ambos
endpoints aceptan el mismo payload opcional `metrics: [{habit_metric_id,
value}]`, y ambos re-evalúan `status` según el `tracking_type` del hábito
después de guardar los valores (ver más abajo).

### Evaluación de `completed` (Service, no Controller)

- `binary`: cualquier `POST`/`PATCH` sin body de métricas marca
  `completed` directo (un solo check-off, ver [[habit]]).
- `quantifiable`: el payload trae valores parciales o totales de
  [[habit-metric-log]]; el Service compara cada valor contra el
  `target_value` **vigente en `occurrence_date`** (ver [[habit-metric]] →
  versionado) y marca `completed` solo si todas las métricas lo alcanzan.
  Si falta alguna, el log queda en un estado no-completado — **incluye
  hábitos `quota` cuantificables**: la regla "`quota` no pasa por
  `pending`" (ver Estados arriba) describe que no hay una fila
  *pre-generada* esperando, no que una fila ya creada no pueda quedar
  incompleta mientras el usuario todavía está cargando sus métricas del
  día. Es la misma etiqueta de estado (`pending`) reutilizada con un
  matiz distinto según el modo — no es una contradicción del invariante,
  es una precisión que faltaba especificar.

### StreakService

Un solo servicio (`app/Services/StreakService.php`), con un método público
`recalculate(Habit $habit): void` que internamente rama por
`recurrence_type` (lógica de [[habit]] → Reglas de negocio: consecutivos
`completed` para `fixed`; períodos ISO-semana con cuota alcanzada para
`quota`) y persiste `current_streak`/`best_streak` en la fila del hábito.
Se invoca después de cualquier mutación de `HabitLog` (create, update,
delete) y desde el job de cierre de ocurrencias vencidas.
