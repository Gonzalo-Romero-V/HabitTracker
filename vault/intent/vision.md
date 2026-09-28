---
status: draft
type: intent
layer: H1
created: 2026-07-17
---

# Visión — Habit Tracker

## Visión

Habit Tracker es una aplicación multi-usuario para crear, programar y
monitorear hábitos personales (binarios o cuantificables), con recordatorios
push, categorización y estadísticas de consistencia (streaks). Existe para
cualquier persona que quiera sostener hábitos en el tiempo — el problema que
resuelve es la falta de visibilidad inmediata del progreso y la ausencia de
un recordatorio oportuno que empuje a actuar el día correcto. Es accesible
tanto desde web como desde un dispositivo móvil, con la misma cuenta.

## Propósito central

Ayudar a un usuario a construir y sostener hábitos personales mediante
seguimiento diario, cálculo de rachas y recordatorios, con una única API
consumida indistintamente por web y mobile.

## Invariantes de negocio

- Un usuario solo ve y modifica sus propios hábitos, categorías, métricas y
  registros — aislamiento estricto por `user_id`, siempre resuelto server-side
  a partir del token autenticado, nunca confiado desde el payload del cliente.
- El "día" de un hábito se determina por el timezone del usuario
  ([[user]].`timezone`), nunca por UTC ni por el timezone del servidor. Dos
  usuarios en zonas horarias distintas pueden tener "hoy" en fechas de
  calendario distintas para el mismo instante.
- Un hábito solo puede tener un registro de cumplimiento (`HabitLog`) por
  fecha de ocurrencia: la combinación `habit_id` + `occurrence_date` es única.
- La racha (streak) de un hábito se rompe a 0 apenas se falla la unidad de
  cumplimiento correspondiente a su `recurrence_type`: un día programado en
  hábitos `fixed`, o un período (semana) que cierra sin alcanzar la cuota
  en hábitos `quota`. No hay tolerancia ni modo vacaciones en el MVP, en
  ninguno de los dos modos (ver [[habit]], [[habit-log]]).
- Un hábito define su recurrencia con **uno de dos motores mutuamente
  excluyentes**, elegido al crearlo y no editable después:
  `fixed` (días concretos vía RRULE, ej. lunes/miércoles/viernes) o
  `quota` (N veces por período, sin días fijos — el usuario elige cuándo
  dentro de la semana). Ver [[habit]] para el detalle.
- Un hábito `quantifiable` completa su `HabitLog` del día solo cuando TODAS
  sus métricas obligatorias alcanzan su `target_value` para esa ocurrencia
  (ver [[habit-metric]], [[habit-metric-log]]). Esto es ortogonal a
  `recurrence_type` — no confundir con la meta de frecuencia de un hábito
  `quota` (esa es cantidad de días cumplidos, no un valor de métrica).
- Los valores de métricas de tipo `duration` se almacenan siempre en segundos
  y los de tipo `currency` en unidades mínimas (centavos) + código ISO 4217.
  Nunca se persisten ni se serializan como floats.
- La regla de recurrencia de un hábito (`recurrence_rule` en `fixed`, o
  `quota_target`/`quota_period` en `quota`) se define al crear el hábito;
  editarla no reescribe retroactivamente el historial de `HabitLog` ya
  generado ni re-evalúa períodos ya cerrados — solo afecta hacia adelante.

## Usuarios principales

- **Usuario final**: crea hábitos (binarios o cuantificables), define su
  recurrencia — días fijos (diaria o días de semana específicos, modo
  `fixed`) o una cuota semanal sin días fijos (modo `quota`) — registra su
  cumplimiento, recibe recordatorios push en su dispositivo, y consulta sus
  rachas y estadísticas de consistencia. Usa indistintamente la web o la
  app móvil (Capacitor) con la misma cuenta y el mismo backend.

## Memento Mori (visualización "vida en semanas")

Agregado al MVP a partir del diseño visual (`Diseño Habit Tracker App`,
ver [[design-system]]) — no estaba en la visión original de esta nota.
Una pantalla que muestra la consistencia del usuario cruzando **todos**
sus hábitos, en dos vistas: un heatmap de días del año en curso, y un
heatmap de semanas de **vida completa** — literal, no un sustituto.

**Redefinido** (revierte una decisión anterior de esta misma sesión, que
había limitado la vista global a "semanas desde la creación de la cuenta"
por no existir todavía `birth_date` en el dominio — ya resuelto, ver
[[user]]): la vista global va de la semana de nacimiento del usuario
(`birth_date`, ver [[user]] → Onboarding) hasta esa misma fecha +
esperanza de vida promedio humana (90 años, valor fijo por ahora — no
hay pedido de personalizarlo). Cada celda es una semana de esa vida
completa, no acotada a lo que la app llegó a registrar.

Dentro de ese rango, el color de cada celda depende de cuándo cae:

- **Antes del primer [[habit-log]] real del usuario** (`GET
  /stats/first-log-date`): gris "sin registro" — la app no puede saber
  qué pasó antes de que existiera el primer registro, aunque la semana
  ya haya ocurrido en la vida del usuario.
- **Entre el primer log y hoy**: color real según el score de
  [[user-daily-stat]] (igual mecanismo que antes).
  Después de hoy: tratamiento "futuro" (ya existente en Calendario/Mori).

No es gamificación (sin puntos/badges/logros, sigue fuera de alcance) —
es una visualización de consistencia histórica, misma familia conceptual
que el heatmap de Calendario y el resto de "Análisis". Mecanismo de datos
en [[user-daily-stat]].

## Fuera de alcance

### Definitivo (no planeado, ni siquiera a futuro)

- Modo vacaciones / días excusados que no rompan la racha (ver invariante
  de streak arriba).
- Gamificación (puntos, badges, logros).
- Funcionalidad social (compartir hábitos, amigos, leaderboards).
- Metas agregadas por período sobre el **valor de una métrica** (ej. "sumar
  10km esta semana" repartidos en varios días) — el MVP evalúa metas de
  [[habit-metric]] por ocurrencia individual, no por acumulado de un rango
  de fechas. **No confundir** con el modo `quota` de [[habit]] (contar N
  días completados por semana) — eso sí está en el MVP; lo fuera de
  alcance es sumar *valores* de métrica entre días.
- Modo offline-first con sincronización diferida — la app asume
  conectividad para leer/escribir contra la API.
- Roles o RBAC — todo usuario autenticado tiene el mismo nivel de permiso,
  limitado a sus propios datos.

### Diferido (planeado, pero no en este MVP)

- **Proyectos** — un segundo módulo de la plataforma (Project → Phase →
  Activity, estilo WBS/PMBOK, con plazos opcionales y ajustables). No se
  modela en H2 todavía; la intención conceptual y su impacto en el modelo
  actual de Habit están documentados en [[roadmap]]. Ver ahí antes de
  tomar decisiones de diseño que pudieran cerrarle la puerta.

## Actualización 2026-09-28 — auditoría de lógica (commit 466e1f3)
Decisiones de producto tomadas por el humano durante la auditoría. Precisan
invariantes de esta nota; lo que diga el cuerpo anterior en contrario
queda reemplazado por esto:

- **Solo se registra el día de hoy** (timezone del [[user]]). Crear,
  modificar o deshacer un [[habit-log]] de una fecha pasada o futura es un
  422. Consecuencia directa de "`missed` es terminal" y de "los períodos
  cerrados no se re-evalúan": el pasado es inmutable y el futuro todavía no
  ocurrió.
- **Archivar y reactivar no es modo vacaciones.** El tiempo archivado es un
  hueco neutro (no genera ocurrencias ni `missed`), pero al reactivar
  `current_streak` arranca en 0; `best_streak` se conserva. El modo
  vacaciones sigue fuera de alcance definitivo.
- **Racha `quota`, semana en curso:** suma apenas alcanza la cuota (igual
  que en `fixed`, donde completar hoy suma de inmediato); solo puede romper
  la racha cuando la semana cierra. La semana de creación (o de
  reactivación) es parcial: suma si se cumplió, pero nunca rompe.
- **Días sin ocurrencia por una falla del sistema quedan neutros.** Si el
  scheduler estuvo caído y un día nunca tuvo fila de [[habit-log]], no se
  rellena retroactivamente como `missed` (la app ni siquiera se lo mostró
  al usuario). Aplicado al hueco real del 1 al 27 de septiembre de 2026.
