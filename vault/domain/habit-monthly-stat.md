---
status: draft
type: domain
layer: H2
created: 2026-07-20
code_path: "app/backend/app/Models/HabitMonthlyStat.php"
---

# HabitMonthlyStat

## Definición

Un agregado de estadísticas de un [[habit]] para un mes calendario
concreto (año+mes, en el timezone del [[user]] dueño). Es una tabla-cache
derivada del historial de [[habit-log]] — nunca la fuente de verdad: se
recalcula desde los logs si hace falta, nunca al revés. Existe para no
recorrer el historial completo de logs cada vez que se pide una gráfica o
un resumen de consistencia de un mes ya cerrado.

## Estados

Sin ciclo de vida propio. Se crea/reemplaza (upsert) cuando el job
mensual (ver [[habit-log]] → Notas de implementación) consolida el mes
que cierra. El mes en curso no tiene fila propia — se calcula al vuelo
desde [[habit-log]], nunca desde este agregado.

## Atributos clave

- `year` / `month` — identifican el mes calendario, en el timezone del
  usuario dueño del hábito. Junto con `habit_id`, la combinación
  `habit_id`+`year`+`month` es única.
- Agregados mínimos esperados: cantidad de ocurrencias `completed` /
  `missed` dentro del mes.
- El `quota_target`/`quota_period` (modo `quota`) o la `recurrence_rule`
  (modo `fixed`) que estaba vigente durante ese mes — necesario para que
  un gráfico histórico dibuje la meta como función escalonada sin
  recalcularla desde el historial de cambios cada vez (ver [[habit]] y
  [[habit-metric]] → versionado de meta).

## Relaciones

- N:1 con [[habit]].

## Reglas de negocio

- Siempre derivable/recalculable desde [[habit-log]] — nunca se edita a
  mano ni se usa como fuente de verdad para el streak (que sigue
  calculándose desde el historial completo de logs, ver [[vision]]).
- Se genera en el mismo job mensual que materializa las próximas
  ocurrencias `pending` de hábitos `fixed` — no es un job separado (ver
  [[habit-log]] → Notas de implementación).

## Notas de implementación

- `HabitMonthlyStatConsolidator::consolidate(habit, year, month)` hace
  `updateOrCreate(['habit_id','year','month'], [...])` — idempotente,
  recalcula completed/missed contando `HabitLog` en el rango del mes y
  snapshotea `recurrence_rule` (fixed) o la `HabitQuotaVersion` vigente al
  último día del mes (quota) vía `quotaVersionEffectiveOn()`.
  Verificado directamente con tinker (conteo correcto tras completar un
  log del mes en curso).
- `GET /api/v1/habits/{habit}/stats/monthly` — solo lectura, autoriza
  `view` sobre el hábito, ordena por `year desc, month desc`. Verificado
  IDOR: 403 con hábito ajeno.
- El mes en curso deliberadamente no tiene fila — `MaterializeMonthlyHabits`
  solo consolida cuando "hoy" es el último día del mes en el timezone del
  usuario (mismo guard que la materialización de `fixed`); confirmado con
  una corrida real del comando fuera de esa condición (0 stats
  consolidados, comportamiento esperado, no bug).

## Actualización 2026-09-28 — auditoría de lógica (commit 466e1f3)
Estado real. Reemplaza "se consolida cuando hoy es el último día del mes":

- El mes se consolida **después de cerrar**: el día 1 (en el timezone del
  usuario) en cada corrida del job, y cualquier otro día si la fila del mes
  anterior todavía falta (servidor apagado el día 1). Consolidar el último
  día, con ese día todavía en curso, dejaba sus completados y fallados
  fuera del agregado para siempre.
- Se consolidan **todos** los hábitos que existían ese mes, activos o
  archivados (antes solo activos). En consecuencia,
  `/stats/monthly-trend` también incluye hábitos archivados, que son
  historia real de ese mes.
- Recuperación de huecos: `php artisan habits:rebuild-stats` (ver
  [[user-daily-stat]]).
