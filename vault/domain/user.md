---
status: draft
type: domain
layer: H2
created: 2026-07-17
code_path: app/backend/app/Models/User.php
---

# User

## Definición

La persona dueña de una cuenta. Todo dato del sistema ([[habit]],
[[category]], [[habit-log]], [[device-token]], [[reminder]]) pertenece a
exactamente un `User` y nunca es visible para otro.

## Estados

No tiene ciclo de vida propio en el MVP (no hay verificación de email,
suspensión de cuenta, ni soft-delete documentado). Una cuenta existe desde
el registro hasta que se borra.

## Atributos clave

- `name` — nombre para mostrar en la UI (saludo, iniciales de avatar). Sin
  regla de negocio asociada más allá de ser obligatorio al registrarse.
- `email` — único, usado para login.
- `password` — hasheado, nunca expuesto en respuestas de la API.
  **Nullable**: una cuenta creada vía "Continuar con Google" no tiene
  password propio — solo puede autenticarse por ese medio hasta que (si
  se implementa a futuro) el usuario defina uno manualmente.
- `google_id` — identificador (`sub`) del token de Google, único,
  nullable. Presente solo si la cuenta se creó o se vinculó vía Google.
- `timezone` — string IANA (ej. `America/Guayaquil`). **Obligatorio.**
  Es el que determina el corte de "día" para todos los hábitos del usuario
  (ver invariante en [[vision]]). Se captura en el registro (auto-detectado
  del cliente) y es editable después. Diseño híbrido (precedente
  financehub): además del valor almacenado, cada request autenticado
  puede mandar el header `X-Client-Timezone` (ver [[api-contracts]]); si
  llega y difiere del valor guardado, el backend lo actualiza
  oportunistamente. Esto mantiene el campo fresco automáticamente si el
  usuario viaja, **sin** que el usuario tenga que editar su perfil a mano.
  El valor almacenado sigue siendo necesario porque los Jobs asíncronos
  (scheduler de [[reminder]], cálculo de streak en background) no tienen
  un request del cliente del cual leer el header.

- `birth_date` — fecha de nacimiento, nullable. Se captura en el
  **onboarding** (no en el registro — no bloquea crear cuenta), vía
  `PATCH /api/v1/auth/me`. Único uso: anclar la vista global de
  [[user-daily-stat]] → Memento Mori ("vida en semanas", desde
  `birth_date` hasta `birth_date` + esperanza de vida promedio). Mientras
  sea `null`, esa vista no puede calcularse (ver Onboarding en
  [[vision]]).

## Onboarding

Flujo de primer uso, disparado cuando el usuario autenticado todavía no
tiene `birth_date` (esa es la señal de "onboarding pendiente" — no hay un
flag separado `onboarding_completed_at`, para no duplicar estado).
Recorre, en orden: bienvenida breve, captura de `birth_date`, guía para
crear la primera [[category]], guía para crear el primer [[habit]], y un
paso final que presenta la navegación de 4 pestañas (Hoy/Calendario/
Memento Mori/Análisis). `birth_date` es el único paso con backend real
detrás — los pasos de categoría/hábito reusan los flujos ya existentes
(modales), el onboarding es una capa de guiado sobre ellos, no un
mecanismo de captura de datos paralelo.

## Relaciones

- 1:N con [[habit]] — un usuario tiene muchos hábitos.
- 1:N con [[category]] — un usuario define sus propias categorías.
- 1:N con [[device-token]] — un usuario puede tener varios dispositivos
  registrados (web + mobile, o varios móviles).
- 1:N con tokens Sanctum (uno por dispositivo/sesión activa) — no es una
  entidad de dominio, es infraestructura de auth (ver [[architecture]]).

## Reglas de negocio

- Todo query de [[habit]], [[category]], [[habit-log]], [[device-token]] o
  [[reminder]] se filtra server-side por el `user_id` del token
  autenticado — nunca por un valor recibido del cliente.
- Cambiar `timezone` no reescribe `occurrence_date` de [[habit-log]] ya
  generados; solo afecta el cálculo de "hoy" hacia adelante.
- **Vinculación automática con Google**: si "Continuar con Google" llega
  con un email que ya tiene cuenta (registrada con password), se vincula
  automáticamente — se asume el email de Google como confiable (ya
  verificado por Google) y se guarda su `google_id` en la cuenta
  existente, sin pedir confirmación adicional. Decisión explícita del
  producto, no un descuido de seguridad.

## Notas de implementación

`User.php` (`app/backend/app/Models/User.php`) extiende `Authenticatable`
con `fillable: name, email, password`, y usa `HasApiTokens` (Sanctum)
además de `HasFactory`/`Notifiable` — habilita la emisión de tokens
Bearer para la API (ver [[architecture]] → Gestión de autenticación).
`timezone` (atributo obligatorio según este dominio) todavía **no** está
en la migración de `users` — es el skeleton default de Laravel; se agrega
cuando se implemente el registro/perfil real.

Actualización: `timezone` ya está en la migración de `users`
(columna `string`, obligatoria) y en `User::$fillable` — la nota anterior
de este archivo que decía que faltaba quedó resuelta en el commit
`feat(backend): add timezone column to users table`.

Actualización: `google_id` (nullable, único) agregado a la migración de
`users`, y `password` pasó a nullable — soportan cuentas creadas vía
"Continuar con Google" sin password propio (ver [[stack]] para el
mecanismo de verificación del token).

## Actualización 2026-09-28 — auditoría de lógica (commit 466e1f3)
- `User::today()` devuelve la fecha de hoy en el timezone del usuario y es
  la única fuente de "hoy" en el backend. `Date::today()` (UTC del
  servidor) quedó prohibido: causaba los bugs de fechas de la auditoría.
- La vinculación automática con Google exige además `email_verified = true`
  en el ID token. La regla del cuerpo se apoya en que Google verificó el
  correo, y antes no se comprobaba.
- Nota de implementación obsoleta en el cuerpo: `timezone` y `google_id` ya
  existen desde hace tiempo (ver las actualizaciones anteriores de esta
  nota).
