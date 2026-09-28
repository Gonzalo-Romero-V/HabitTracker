---
status: draft
type: domain
layer: H2
created: 2026-07-17
code_path: "app/backend/app/Models/DeviceToken.php"
---

# DeviceToken

## Definición

El token de push notification (Firebase Cloud Messaging) de un dispositivo
concreto donde un [[user]] tiene la app instalada o la web abierta con
permiso de notificaciones. Es el destino al que el scheduler de
[[reminder]] despacha los pushes.

## Estados

Sin ciclo de vida propio — existe mientras el dispositivo tenga la
notificación registrada; se elimina si el token se invalida (respuesta de
error de FCM) o el usuario cierra sesión en ese dispositivo.

## Atributos clave

- `platform` ∈ `{ios, android, web}`.
- `push_token` — el token FCM del dispositivo. Único por dispositivo.
- `last_seen_at` — última vez que el cliente confirmó el token como
  válido (refresco periódico).

## Relaciones

- N:1 con [[user]] — un usuario puede tener varios `DeviceToken`
  simultáneos (multi-dispositivo: web + mobile, o varios móviles).

## Reglas de negocio

- Un `push_token` inválido (FCM responde error de "no registrado") se
  elimina del sistema — no se reintenta indefinidamente.
- El scheduler despacha a **todos** los `DeviceToken` activos del usuario
  dueño del [[habit]] con [[reminder]] debido, no solo al último usado.

## Notas de implementación

- `POST /api/v1/device-tokens` hace upsert por `push_token` (no por
  `id`) vía `updateOrCreate(['push_token' => ...], [...])` — registrar el
  mismo token dos veces actualiza `platform`/`last_seen_at` y `user_id`
  en vez de duplicar la fila. Verificado con curl: mismo `push_token`,
  distinto `platform`, misma fila (`id` estable).
- `DELETE /api/v1/device-tokens/{deviceToken}` autoriza vía
  `DeviceTokenPolicy::delete` (`user_id` propio) — verificado con dos
  usuarios reales, 403 en intento cruzado.
- El "se elimina si el token se invalida" (respuesta de error FCM) queda
  sin implementar todavía — el `PushSender` activo ya es `FcmPushSender`
  real (ver [[stack]]), pero `send()` hoy solo loguea el error de FCM en
  vez de borrar el `DeviceToken`; queda como mejora futura, no bloquea el
  MVP (un token muerto simplemente sigue fallando en silencio hasta que
  se limpie a mano).
- El token real se registra desde el cliente Android vía
  `@capacitor-firebase/messaging` (pide permiso de notificaciones al
  arrancar — enganchado en `AuthGuard`, se dispara una vez hay usuario
  autenticado —, obtiene el token FCM nativo, lo postea a
  `POST /device-tokens` con `platform: "android"`) — no hay equivalente
  web todavía (el navegador de escritorio no pide permiso de push en este
  MVP). Import dinámico a propósito (`await import(...)`) para que el SDK
  web de este plugin (trae `firebase/messaging` como dependencia
  estática, no un no-op liviano) no infle el bundle del build web, que
  nunca ejecuta este código. Permiso denegado o fallo de red: silencioso,
  nunca bloquea el resto de la app — confirmado con build de Gradle real
  (`assembleDebug`) con las credenciales de Firebase reales presentes.

## Actualización 2026-09-28 — auditoría de lógica (commit 466e1f3)
Resuelve dos pendientes del cuerpo:
- **Token no registrado → se elimina.** `DispatchDueReminders` captura
  `Kreait\Firebase\Exception\Messaging\NotFound` (FCM "no registrado") y
  borra el `DeviceToken`; los demás errores se siguen logueando sin borrar.
- **Cerrar sesión borra el token del dispositivo.** El cliente guarda el
  `id` devuelto por `POST /device-tokens` y, al cerrar sesión, hace
  `DELETE /device-tokens/{id}` antes de revocar el token de sesión. Antes el
  dispositivo seguía recibiendo los recordatorios de la cuenta que ya había
  cerrado sesión.
