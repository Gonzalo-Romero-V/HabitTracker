---
status: draft
type: domain
layer: H2
created: 2026-07-17
code_path: app/backend/app/Models/HabitMetricLog.php
---

# HabitMetricLog

## Definición

El valor concreto que un [[user]] registró para una [[habit-metric]] en
una ocurrencia específica de [[habit-log]]. Es el dato de detalle que, en
conjunto para todas las métricas de un hábito, determina si ese
`HabitLog` pasa a `completed`.

## Estados

Sin ciclo de vida propio — se crea/actualiza mientras el `HabitLog` padre
no esté cerrado.

## Atributos clave

- `value` — el valor logueado, interpretado según el `metric_type` de la
  [[habit-metric]] asociada: entero de segundos si es `duration`, entero de
  unidades mínimas si es `currency`, entero/decimal simple si es `count`.
  Nunca un float ambiguo para `duration`/`currency` (ver invariante en
  [[vision]]).

## Relaciones

- N:1 con [[habit-log]] — pertenece a una ocurrencia concreta.
- N:1 con [[habit-metric]] — indica cuál métrica se está registrando.

## Reglas de negocio

- Un `HabitMetricLog` se considera "cumplido" cuando `value >=
  target_value` de su [[habit-metric]] (a menos que se defina una
  dirección de meta distinta, ej. "gastar menos de X" — pendiente de
  definir si se soporta meta descendente; asumir ascendente por defecto).
- El `HabitLog` padre pasa a `completed` solo cuando **todas** sus
  `HabitMetricLog` de esa ocurrencia cumplen su meta — no basta con una
  sola métrica cumplida si el hábito tiene varias.

## Notas de implementación

## Actualización 2026-09-28 — auditoría de lógica (commit 466e1f3)
Implementación (`HabitLogService::saveAndEvaluate`, validado en
`Store/UpdateHabitLogRequest`):
- Cada `habit_metric_id` debe pertenecer al hábito del log
  (`exists ... where habit_id`) y no repetirse. Antes se aceptaba cualquier
  id, incluso de métricas de otro usuario.
- `metrics` está prohibido en hábitos `binary`.
- Un hábito sin métricas nunca evalúa como `completed` (guard en
  `HabitCompletionService`).
- La meta es siempre ascendente (`value >= target_value`); la meta
  descendente sigue sin soportarse.
- El frontend muestra y captura valores en unidad natural (minutos, monto) y
  convierte a segundos o centavos al enviar, también en el detalle del
  hábito (antes esa pantalla trabajaba con valores crudos).
