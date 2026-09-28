---
status: draft
type: decision
layer: H3
created: 2026-07-17
code_path: app/backend/routes/api.php
---

# API Contracts — Habit Tracker

## Convenciones generales

- Base path: `/api/v1/`.
- Auth: header `Authorization: Bearer <token>` (Sanctum personal access
  token) en todos los endpoints salvo `/api/v1/auth/login` y
  `/api/v1/auth/register`.
- Respuesta exitosa: `{ "data": ..., "mensaje": "..." }` — `data` es el
  recurso único o array; `mensaje` es opcional (solo cuando hay algo que
  comunicar al usuario, ej. "Hábito creado"), en español, y **es la que
  puede llegar directo a un toast de la UI** — sigue la convención de
  [[i18n-copy]]. Se usa la clave `mensaje`, no `message` (precedente
  financehub: mismo stack, convención ya probada). Cuando hay paginación
  se agrega `"meta": { current_page, last_page, per_page, total }`
  (page-based, paginador nativo de Laravel — ver [[architecture]] →
  Paginación).
- Respuesta de error: `{ "error": { "code": "string", "mensaje": "string" } }`.
  `code` es una clave estable en inglés/snake_case para que el cliente
  pueda hacer lógica sobre ella (ej. `HABIT_LOG_ALREADY_EXISTS`);
  `mensaje` es el texto en español neutro EC, listo para mostrarse.
  Status HTTP acorde: 422 validación, 401 no autenticado, 403 no
  autorizado, 404 no encontrado, 500 inesperado.
  En errores 422 de validación, el envelope agrega `"fields"`: un mapa
  `{ campo: [mensajes...] }` (formato nativo de Laravel) para que el
  frontend pueda mostrar el error pegado al campo del formulario, no solo
  el resumen de `mensaje` (que toma el primer mensaje de validación, sin
  el sufijo "(and N more errors)" que el core de Laravel agrega en
  inglés — se arma a mano en el Exception Handler, no se usa
  `$e->getMessage()` directo).
- Fechas: ISO 8601 en UTC en toda la API. La conversión a "qué día es hoy"
  para un usuario ocurre siempre usando `[[user]].timezone` en el Service
  correspondiente del backend — nunca se asume el timezone del servidor ni
  se delega ese cálculo al frontend.
- Header `X-Client-Timezone` (IANA, ej. `America/Guayaquil`): opcional en
  cada request autenticado. Cuando llega, el backend lo usa para refrescar
  oportunistamente `[[user]].timezone` (detalle en [[user]] → Reglas de
  negocio). Precedente: financehub usa el mismo patrón para resolver
  fechas correctamente sin depender de un campo de perfil desactualizado.

## Recursos principales

> El contrato definitivo lo fija el código en `app/backend/routes/api.php` —
> esta sección es la intención de diseño, no la fuente de verdad final.
> Al implementar, actualizar `code_path` de esta nota vía `/sync`.

- `/api/v1/auth/{register,login,logout}` — autenticación, emite/revoca
  tokens Sanctum.
- `/api/v1/auth/google` — recibe `{ id_token, timezone }`, verifica el ID
  token de Google (ver [[stack]]) y crea/vincula/loguea la cuenta; mismo
  shape de respuesta que login/register (`{ data: { user, token },
  mensaje }`). Un email que ya tiene cuenta con password se vincula
  automáticamente (ver [[user]] → Reglas de negocio).
- `/api/v1/auth/me` (autenticado) — `GET` devuelve el usuario del token
  actual; no estaba en el diseño original de esta nota, se agregó al
  implementar porque el frontend necesita hidratar la sesión al cargar
  sin volver a pedir credenciales. `PATCH` actualiza el perfil — hoy solo
  `birth_date` (ver [[user]] → Onboarding), se amplía si hace falta más
  adelante. Aplica el middleware `sync.timezone` (ver [[user]] → Reglas
  de negocio, header `X-Client-Timezone`).
- `/api/v1/habits` — CRUD de [[habit]] (incluye su regla de recurrencia y
  `tracking_type`). `POST /habits/{habit}/archive` y `POST
  /habits/{habit}/unarchive` — el camino normal para "dejar de seguir"/
  "retomar" un hábito sin perder su historial (ver [[habit]]); simétricos
  a propósito, el segundo se agregó porque el frontend no tenía forma de
  revertir un archivado hasta ahora.
- `/api/v1/habits/{habit}/metrics` — CRUD de [[habit-metric]] asociadas a
  un hábito `quantifiable`.
- `/api/v1/habits/{habit}/logs` — `GET` lista (paginado), `POST` crea
  [[habit-log]] (422 si ya existe uno para esa `occurrence_date`).
  `PATCH /habits/{habit}/logs/{log}` actualiza uno existente — es el
  camino normal para hábitos `fixed` (la fila `pending` ya la generó el
  job mensual, ver [[habit-log]] → Notas de implementación). `DELETE`
  existe (deshacer un check-off). Ambos `POST`/`PATCH` aceptan
  `metrics: [{ habit_metric_id, value }]` para hábitos `quantifiable`.
  `GET` acepta `from`/`to` (`YYYY-MM-DD`, filtran `occurrence_date` en
  rango cerrado) y `per_page` (clamp 1-100). **Resuelto (2026-08-06)**:
  antes de `from`/`to`, un hábito con historial + materialización futura
  (ver [[habit]]) que superaba los 15 registros por página escondía "hoy"
  en páginas siguientes que ningún consumidor pedía — la pantalla "Hoy"
  mostraba "no tienes hábitos programados" con hábitos y logs reales.
  Todo consumidor de este endpoint debe pasar el rango que necesita
  (nunca confiar en el orden descendente default para encontrar una
  fecha específica).
- `/api/v1/categories` — CRUD de [[category]].
- `/api/v1/device-tokens` — registrar/eliminar [[device-token]] del
  dispositivo actual (usado por el scheduler de [[reminder]] para push).
- `/api/v1/habits/{habit}/reminders` — CRUD de [[reminder]] del hábito.
- `/api/v1/habits/{habit}/stats/monthly` — lectura de agregados
  [[habit-monthly-stat]] (histórico, meses ya cerrados); el mes en curso
  se calcula al vuelo desde [[habit-log]], no desde este endpoint.
- `/api/v1/stats/today` — cuenta en vivo (sin cache) de ocurrencias
  debidas/cumplidas de **hoy**, cruzando todos los hábitos activos del
  usuario. Alimenta el anillo de progreso de la pantalla "Hoy".
- `/api/v1/stats/daily?from=YYYY-MM-DD&to=YYYY-MM-DD` — lectura de
  [[user-daily-stat]] (histórico, días ya cerrados) para un rango de
  fechas. Alimenta el heatmap de Calendario y las vistas de Memento Mori
  (día y semana — la agregación semanal se arma en el cliente agrupando
  esta respuesta). Rango máximo por request: 2 años, para no permitir un
  request patológico sobre el historial completo de una cuenta vieja.
- `/api/v1/stats/monthly-trend?months=N` (default 6) — suma
  [[habit-monthly-stat]] de todos los hábitos activos del usuario,
  agrupado por año/mes. Alimenta el gráfico de tendencia mensual de
  Análisis. No requiere tabla nueva — es una agregación de lectura sobre
  una tabla-cache que ya existe.
- `/api/v1/stats/first-log-date` — `{ date: string | null }`, la fecha
  del [[habit-log]] más antiguo del usuario (`null` si nunca registró
  nada). Único consumidor: Memento Mori, para saber desde qué semana deja
  de pintarse gris "sin registro" (ver [[vision]] → Memento Mori).

## Reglas

- Ningún endpoint acepta `user_id` en el body — siempre se infiere del
  token autenticado (ver [[architecture]] → Gestión de autenticación).
- Crear un `HabitLog` para una `occurrence_date` que ya tiene uno existente
  es un 422 (conflicto), no un upsert silencioso — el cliente debe usar el
  endpoint de actualización explícitamente.
- `DELETE /api/v1/habits/{habit}` y `DELETE
  /api/v1/habits/{habit}/logs/{log}` existen como borrado físico real (no
  soft-delete) — pensados como mantenimiento/corrección de errores. El
  flujo normal de la app usa `PATCH /api/v1/habits/{habit}` con
  `status=archived` para "dejar de seguir" un hábito sin perder su
  historial (ver [[habit]]).

## Actualización 2026-09-28 — auditoría de lógica (commit 466e1f3)
Contrato real. Reemplaza lo que el cuerpo anterior diga en contrario:

- **`DELETE /habits/{habit}/logs/{log}`** = deshacer el registro de hoy. En
  `fixed` devuelve el log revertido a `pending` en `data`; en `quota` borra
  y devuelve `data: null`. Mensaje: "Registro deshecho correctamente."
  Reemplaza "existen como borrado físico real" para logs (`DELETE
  /habits/{habit}` sí sigue siendo borrado físico).
- `POST`/`PATCH`/`DELETE` de logs: 422 si la fecha no es hoy (timezone del
  usuario), si el hábito está archivado, si en `fixed` el día no está
  programado o si la vigencia terminó. `occurrence_date` usa formato
  `Y-m-d`. `metrics[*].habit_metric_id` debe pertenecer al hábito.
- `GET /habits/{habit}/logs`: si el rango incluye hoy, garantiza que exista
  la ocurrencia de hoy (ver [[habit-log]]).
- `POST /habits/{habit}/unarchive`: 422 si la vigencia ya venció.
- `GET /habits` y `GET /categories` aceptan `per_page` (1–100) y tienen
  orden estable (`id` y `name, id`). Sin `ORDER BY`, Postgres devolvía las
  filas en orden físico, que cambia tras cada UPDATE, y un hábito podía
  saltar de página. El frontend (`apiFetchAllPages`) lee todas las páginas;
  antes solo leía la primera y los elementos a partir del 16 no aparecían.
- Validaciones nuevas: `quota_target` máximo 7; `target_value > 0`;
  `recurrence_rule`/`quota_*` solo según el `recurrence_type` del hábito.
- **401 garantizado:** un request sin autenticar recibe siempre el 401
  `UNAUTHENTICATED`, con o sin `Accept: application/json`. Antes, sin ese
  header, Laravel intentaba redirigir a una ruta `login` inexistente y
  respondía 500 (`redirectGuestsTo(fn () => null)` en `bootstrap/app.php`).
