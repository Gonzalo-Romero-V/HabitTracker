---
status: draft
type: domain
layer: H2
created: 2026-07-17
code_path: "app/backend/app/Models/Reminder.php"
---

# Reminder

## Definición

Un horario en el que un [[habit]] debe disparar una notificación push al
[[user]] dueño, recordándole cumplir la ocurrencia programada de ese día.
Un hábito puede tener más de un `Reminder` (ej. mañana y noche).

## Estados

Sin ciclo de vida propio — activo mientras exista; se borra directamente
si el usuario lo elimina.

## Atributos clave

- `time_of_day` — hora local (ej. `08:00`), interpretada siempre en el
  `timezone` del [[user]] dueño del hábito, nunca en UTC directo.

## Relaciones

- N:1 con [[habit]] — un hábito puede tener varios recordatorios; un
  recordatorio pertenece a un único hábito.

## Reglas de negocio

- El disparo depende del `recurrence_type` del [[habit]] (ver [[habit]]):
  - **`fixed`**: el `Reminder` solo dispara en fechas que la
    `recurrence_rule` marca como programadas — no dispara en días donde
    el hábito no tiene ocurrencia.
  - **`quota`**: no hay días programados a priori, así que el `Reminder`
    dispara **todos los días** a `time_of_day` mientras el período
    (semana) en curso no haya alcanzado `quota_target` todavía — deja de
    disparar el resto de la semana apenas se cumple la cuota. Evita
    molestar con un recordatorio de un hábito que ya está "al día" esa
    semana.
- El scheduler backend evalúa `time_of_day` contra el timezone del usuario
  (no el del servidor) para decidir el instante UTC exacto de disparo, y
  despacha a todos los [[device-token]] del usuario.
- Si la ocurrencia del día ya está `completed` en su [[habit-log]] antes de
  la hora del recordatorio (`fixed`), o si el período ya alcanzó
  `quota_target` (`quota`), el recordatorio no se envía — confirmado e
  implementado (`DispatchDueReminders::habitStillNeedsIt()`).

## Notas de implementación

`habit_id` como FK obligatoria es una decisión deliberada, no un
descuido: es el seam de extensión más barato para cuando el futuro módulo
de Proyectos (ver [[roadmap]]) necesite recordatorios sobre una `Activity`.
No generalizar a algo tipo `remindable_type/remindable_id` ahora — se
decide con el shape real de `Activity` sobre la mesa, no antes.

- `App\Console\Commands\DispatchDueReminders` corre cada minuto
  (`routes/console.php`) y compara `time_of_day` contra la hora actual
  exacta (`H:i`) en el timezone del usuario dueño del hábito — coincidencia
  de minuto exacto, no ventana. Verificado con tinker: ajustar
  `time_of_day` al minuto actual en timezone de usuario dispara el envío
  (logueado por `LogPushSender`); fuera de ese minuto, o con la ocurrencia
  ya `completed`/cuota ya alcanzada, no dispara — probado explícitamente
  para ambos `recurrence_type` (`fixed` y `quota`).
- **Resuelto (2026-07-21)**: el envío ya no es un stub — `FcmPushSender`
  manda de verdad vía Firebase (ver [[stack]]). El loop de
  `DispatchDueReminders` envuelve cada `send()` individual en su propio
  try/catch: si un `DeviceToken` falla (token inválido, error de red),
  se loguea y se sigue con el resto — un token roto no debe frenar el
  despacho a los demás dispositivos/usuarios de esa corrida. Verificado
  de punta a punta con un token FCM deliberadamente inválido: la
  excepción real de Firebase (`InvalidMessage: The registration token is
  not a valid FCM registration token`) llega hasta el catch, se loguea
  con `device_token_id`/`reminder_id`, y el comando termina limpio sin
  abortar — confirma que la autenticación con la cuenta de servicio real
  funciona (un fallo de credencial se hubiera visto distinto, como error
  de autorización antes de llegar a validar el token).
- CRUD (`habits.reminders`, anidado y `->scoped()`) autoriza sobre el
  [[habit]] padre (`update`/`view`), no sobre el propio `Reminder` — no
  existe `ReminderPolicy` dedicada, mismo patrón que `HabitMetric`.
  Verificado IDOR: 403 si el hábito no es propio, 404 si se intenta anidar
  un `reminder` ajeno bajo un hábito propio (binding `->scoped()`).

## Actualización 2026-09-28 — auditoría de lógica (commit 466e1f3)
- **Los push no se estaban enviando en producción:** `FIREBASE_CREDENTIALS=`
  vacío en `.env` hacía que `env()` devolviera `""` en vez de la ruta por
  defecto (`storage/app/firebase/service-account.json`), y resolver el
  `PushSender` fallaba con "Unable to determine the Firebase Project ID".
  `config/firebase.php` ahora usa `env(...) ?: ruta_por_defecto`.
- Tampoco se disparaban porque el scheduler no corría (ver
  [[architecture]] → Jobs).
- `DispatchDueReminders` precarga solo los logs de los últimos 8 días (antes
  cargaba el historial completo de cada hábito cada minuto) y corre con
  `withoutOverlapping`.
