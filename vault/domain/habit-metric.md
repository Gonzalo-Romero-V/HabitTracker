---
status: draft
type: domain
layer: H2
created: 2026-07-17
code_path: app/backend/app/Models/HabitMetric.php
---

# HabitMetric

## Definición

Una dimensión medible que el propio [[user]] define para un [[habit]]
`quantifiable`. Un hábito puede tener varias métricas simultáneas — ej.
para "leer un libro": una métrica "Tiempo de lectura" (duración) y otra
"Páginas leídas" (conteo). No es un campo genérico único: cada métrica
tiene un **tipo** que determina cómo se almacena, se agrega y se muestra.

## Estados

Sin ciclo de vida propio — existe mientras el hábito `quantifiable` exista.

## Atributos clave

- `name` — nombre definido por el usuario (ej. "Vasos de agua", "Tiempo de
  meditación", "Gasto en salidas").
- `metric_type` ∈ `{count, duration, currency}` — **no todo es un número
  genérico**:
  - `count` — cantidad simple con una `unit` de texto libre definida por el
    usuario (ej. "páginas", "vasos", "km"). Se almacena como
    entero/decimal.
  - `duration` — se almacena **siempre en segundos** (entero). La UI la
    formatea como HH:MM o "20 min" — nunca se persiste ni se serializa en
    la API como minutos/horas ambiguos.
  - `currency` — se almacena en **unidades mínimas** (centavos, entero) +
    un código ISO 4217 (`currency_code`). Nunca como float — evita errores
    de redondeo.
- `target_value` — la meta que debe alcanzar cada [[habit-metric-log]] de
  una ocurrencia para que esa métrica cuente como cumplida ese día.
  **Versionado**: cada cambio queda registrado con su fecha de vigencia
  en la tabla `habit_metric_target_versions` (mecanismo H4 fijado en
  [[architecture]] → Versionado de metas — nunca se sobrescribe el valor
  sin dejar rastro de cuál regía antes). Un [[habit-metric-log]] siempre se evalúa
  contra el `target_value` vigente en la `occurrence_date` de su
  [[habit-log]] padre, nunca contra el valor actual de la métrica. La
  representación gráfica de la meta en el tiempo se dibuja como función
  escalonada (step function), no como línea horizontal fija — mismo
  mecanismo que `quota_target`/`quota_period` en [[habit]].

## Relaciones

- N:1 con [[habit]] — pertenece a un único hábito `quantifiable`.
- 1:N con [[habit-metric-log]] — un valor logueado por ocurrencia de
  [[habit-log]].

## Reglas de negocio

- `metric_type` es inmutable una vez creada la métrica (cambiar de
  `duration` a `count`, por ejemplo, invalidaría el historial de
  [[habit-metric-log]] ya almacenado en segundos).
- Cambiar `target_value` (o agregar/quitar una métrica del hábito) nunca
  reevalúa retroactivamente logs ya cerrados — cada
  [[habit-metric-log]] se evalúa contra la meta vigente en su fecha (ver
  Atributos clave → versionado).
- El MVP evalúa `target_value` **por ocurrencia individual**, no como
  acumulado agregado de un rango de fechas (ver "Fuera de alcance" en
  [[vision]]).

## Notas de implementación

`target_value` se versiona en `habit_metric_target_versions` (ver
[[architecture]] → Versionado de metas). `HabitMetricController` permite
agregar/actualizar/eliminar métricas de un hábito ya creado; actualizar
`target_value` inserta una versión nueva, nunca sobrescribe.

## Actualización 2026-09-28 — auditoría de lógica (commit 466e1f3)
Estado real:
- `target_value` debe ser **mayor que 0** (`gt:0`) al crear el hábito, al
  agregar una métrica y al editar la meta. Con 0, la métrica se daba por
  cumplida sin registrar nada y el índice del heatmap la contaba como 0 %.
- No se puede borrar la última métrica de un hábito `quantifiable` (422).
- Versionado idempotente (`HabitMetric::recordTargetVersion`): mismo
  criterio que la cuota en [[habit]] (no duplica valores iguales; la misma
  fecha se reemplaza). `effective_from` es "hoy" en el timezone del
  usuario: antes una meta creada de noche nacía con fecha de mañana y el
  log de hoy no encontraba meta vigente, así que **no podía completarse**.
- En el formulario, el tipo y la unidad/moneda de una métrica existente
  quedan bloqueados (la API solo acepta cambiar nombre y meta). Antes el
  cambio se ignoraba y la meta se guardaba convertida con el tipo nuevo.
