---
status: draft
type: domain
layer: H2
created: 2026-07-20
code_path: "app/backend/app/Models/UserDailyStat.php"
---

# UserDailyStat

## Definición

Un agregado cross-hábito: cuántas ocurrencias estaban "debidas" y cuántas
se cumplieron, para **un [[user]] y una fecha de calendario concreta**
(en su timezone), sumando **todos** sus [[habit]] activos. Es una
tabla-cache derivada de [[habit-log]] — igual que [[habit-monthly-stat]],
pero cruzando hábitos en vez de agregar uno solo, y a granularidad diaria
en vez de mensual. Existe para alimentar visualizaciones que necesitan
mucho histórico de golpe (heatmap de calendario, "Memento Mori") sin
traer miles de filas de `HabitLog` en cada render.

## Estados

Sin ciclo de vida propio. Se crea/reemplaza (upsert) cuando el día que
representa ya cerró en el timezone del usuario — nunca existe una fila
para "hoy" (día en curso): el día en curso se calcula en vivo (ver
`GET /stats/today` en [[api-contracts]]), igual que el mes en curso no
tiene fila en [[habit-monthly-stat]].

## Atributos clave

- `date` — fecha de calendario en el timezone del usuario. Junto con
  `user_id`, la combinación es única.
- `due_count` — cuántas ocurrencias de [[habit-log]] existían esa fecha
  para hábitos activos del usuario (ver mecanismo abajo — no distingue
  `fixed`/`quota`).
- `completed_count` — cuántas de esas llegaron a `completed`.
- El "score" del día (%) no se persiste — se deriva en el momento de
  leer (`completed_count / due_count`); evita duplicar el mismo dato de
  dos formas.

## Relaciones

- N:1 con [[user]]. **No** tiene relación directa con [[habit]] — es una
  suma, no un detalle por hábito (para eso está [[habit-log]] crudo o
  [[habit-monthly-stat]] por hábito).

## Reglas de negocio

- Siempre derivable/recalculable desde [[habit-log]] — nunca se edita a
  mano ni es fuente de verdad de nada (ni de streaks, ni de estado de un
  hábito individual).
- Un día sin ningún hábito activo con actividad ese día (`due_count = 0`)
  no tiene fila — no hay "0% ese día", hay "sin dato" (distinción
  importante para el heatmap: gris "sin registro" vs. rojo "0% cumplido").

## Notas de implementación

### Mecanismo: por qué "debido" no distingue `fixed` de `quota`

Para un hábito `fixed`, una fila de `HabitLog` solo existe en fechas que
la `recurrence_rule` marcó como ocurrencia programada (pre-materializadas
por el job mensual, ver [[habit-log]]). Para uno `quota`, una fila de
`HabitLog` solo existe en la fecha exacta en que el usuario efectivamente
registró algo ese día (no hay pre-generación). En ambos casos, **la sola
existencia de la fila ya significa "este hábito contaba para ese día"** —
así que `due_count`/`completed_count` de un día son simplemente:

```
due_count       = COUNT(HabitLog) del usuario, hábito activo, esa fecha
completed_count = COUNT(HabitLog) ... AND status = 'completed'
```

Sin ninguna rama por `recurrence_type`. Es la misma simplificación que ya
usa [[habit-monthly-stat]] a nivel mensual, llevada a nivel diario y
cross-hábito.

### `UserDailyStatConsolidator`

`consolidate(User $user, string $date): void` — cuenta `HabitLog` del
usuario para esa fecha (join a `habits` filtrando `status = active`),
`updateOrCreate` sobre `['user_id', 'date']`. Idempotente, igual criterio
que [[habit-monthly-stat]].

### Cuándo se consolida

Se engancha en el job existente de cierre de ocurrencias
(`habits:evaluate-closures`, ver [[architecture]] → Jobs) — no es un job
nuevo. Cada corrida (cada 30 min), por cada usuario activo, consolida
"ayer" en su timezone. Correrlo de más no duplica nada (upsert). Un
usuario inactivo por varios días seguidos podría dejar un hueco si el
servidor estuvo caído — aceptado como límite del MVP, no hay comando de
backfill retroactivo todavía.

### Endpoints (ver [[api-contracts]])

- `GET /api/v1/stats/today` — cuenta en vivo (sin cache, es un solo día)
  para el anillo de progreso de "Hoy".
- `GET /api/v1/stats/daily?from&to` — lee de esta tabla-cache; alimenta
  el heatmap del calendario y las vistas de Memento Mori (día y semana —
  la agregación semanal se hace en el cliente agrupando los días
  devueltos, no hay endpoint semanal separado).

## Actualización 2026-09-28 — auditoría de lógica (commit 466e1f3)
Estado real. Reemplaza lo que el cuerpo anterior diga en contrario:

- **`weighted_completed_count`** (migración `2026_07_24`, no documentada
  hasta ahora): índice fraccionario en [0, `due_count`]. Un hábito
  cuantificable a medio camino suma parcial (8 de 10 vasos = 0,8). Colorea
  el heatmap de Calendario y Memento Mori; `completed_count` sigue siendo
  todo-o-nada. Con varias métricas se promedia el ratio de cada una.
- **Días cerrados cuentan también hábitos archivados después:** sus logs
  de ese día son historia real. Antes archivar un hábito hoy reescribía el
  agregado de ayer. El conteo en vivo de hoy (`/stats/today`) sigue
  filtrando solo activos.
- **`due_count = 0` no genera fila** (y se borra si existía). Antes se
  creaban filas en 0, contradiciendo la regla "sin dato ≠ 0 %". Se
  limpiaron 5 filas viejas en producción.
- **Consolidación:** el job de cierres reconsolida los últimos 7 días
  cerrados, no solo "ayer", así que un día con el servidor apagado se
  recupera solo. Para huecos más viejos existe
  `php artisan habits:rebuild-stats` (idempotente): reconstruye todos los
  días y meses cerrados desde el historial. Reemplaza "no hay comando de
  backfill retroactivo todavía". Se usó para recuperar el hueco del 10 de
  agosto al 27 de septiembre de 2026.
- Memento Mori pide el historial en ventanas de 730 días, respetando el
  límite de 2 años por request. Antes una cuenta con más de 2 años veía un
  error.
