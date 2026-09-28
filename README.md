# Habit Tracker

Aplicación multi-usuario para crear, programar y monitorear hábitos
personales (binarios o cuantificables), con recordatorios push,
categorización y estadísticas de consistencia (streaks). API desacoplada
(Laravel), consumida por un frontend web (Next.js) y por la misma app
empaquetada para mobile vía Capacitor.

Visión completa, invariantes de negocio y alcance: [`vault/intent/vision.md`](vault/intent/vision.md).

---

## Estado del proyecto

**MVP implementado y en producción.** Funcionalidad disponible:

- Cuenta con email/contraseña o Google, y onboarding (fecha de nacimiento,
  primera categoría, primer hábito).
- Hábitos binarios o cuantificables (métricas de conteo, duración y monto),
  con recurrencia de días fijos (RRULE) o cuota semanal, vigencia opcional y
  metas versionadas en el tiempo.
- Pantallas **Hoy** (registro del día), **Calendario** (heatmap mensual),
  **Memento Mori** (vida en semanas) y **Análisis** (consistencia, rachas,
  tendencias, evolución por métrica).
- Rachas calculadas en el backend, archivar y reactivar hábitos, y
  recordatorios push vía FCM en Android (Capacitor).

La fuente de verdad del dominio y las decisiones es el vault:

- [`vault/intent/vision.md`](vault/intent/vision.md) — H1: visión, invariantes, alcance.
- [`vault/intent/roadmap.md`](vault/intent/roadmap.md) — H1: evolución futura (módulo Proyectos), diferido.
- [`vault/decisions/`](vault/decisions/) — H3: stack, arquitectura (incluidos los jobs), contratos de API, entornos, despliegue, design system, idioma 🔒.
- [`vault/domain/`](vault/domain/) — H2: `user`, `category`, `habit`, `habit-metric`, `habit-log`, `habit-metric-log`, `device-token`, `reminder`, `habit-monthly-stat`, `user-daily-stat`.

Decisiones todavía abiertas: testing del frontend
(`decisions/architecture.md`) y paleta de marca y safe-area
(`decisions/design-system.md`).

---

## Cómo levantar el proyecto en local

Requisitos: PHP 8.2+, Composer 2, Node 18.18+, PostgreSQL 17 (con una base
ya creada), npm.

### Backend (`app/backend`)

```bash
cd app/backend
composer install
cp .env.example .env    # solo si .env no existe todavía
php artisan key:generate
# Editar .env: DB_CONNECTION=pgsql, DB_DATABASE, DB_USERNAME, DB_PASSWORD
php artisan migrate
php artisan serve        # http://localhost:8000
php artisan schedule:work   # en otra terminal: sin esto no hay ocurrencias, cierres ni recordatorios
```

Tests del backend: corren contra PostgreSQL real, no SQLite. Necesitan una
base vacía `habittracker_test` (se usan las credenciales de `.env`):

```bash
php artisan test
```

Si el scheduler estuvo detenido un tiempo, `php artisan habits:rebuild-stats`
reconstruye las estadísticas diarias y mensuales de esos días (es idempotente).

### Frontend (`app/frontend`)

```bash
cd app/frontend
npm install
npm run dev               # http://localhost:3000
```

En desarrollo web, `next.config.ts` proxea `/api/*` hacia `BACKEND_URL`
(default `http://localhost:8000`) — ver `vault/decisions/environments.md`
para el mecanismo completo y el build mobile (Capacitor).

### Despliegue / instanciar en otra máquina

Ver [`DEPLOY.md`](DEPLOY.md): variables de entorno completas por app,
secretos fuera de git que hay que copiar a mano (credenciales de Firebase,
`google-services.json`), cómo queda cerrada la API (backend y base de
datos nunca se exponen, solo el frontend vía Cloudflare Tunnel), y los
comandos para correr los 4 procesos de producción (backend, cola,
scheduler, frontend).

---

## Stack (resumen — detalle en `vault/decisions/stack.md`)

- Backend: Laravel + PostgreSQL + Sanctum (API tokens).
- Frontend web: Next.js (App Router) + TypeScript + Tailwind v4 + shadcn/ui.
- Frontend mobile: el mismo código Next.js empaquetado con Capacitor
  (build estático vía `BUILD_TARGET=mobile`, ver `decisions/environments.md`).
- Push: Firebase Cloud Messaging (`@capacitor-firebase/messaging`).
- Idioma: español neutro Ecuador en toda la app (ver `decisions/i18n-copy.md`).

---

## Cómo trabajar en este repo (agentes de IA y humanos)

Este proyecto usa **Code Vault**: un vault Obsidian (`vault/`) como fuente
de verdad semántica, sincronizado con el código vía un engine determinista.

- **Agentes de IA**: leer [`AGENTS.md`](AGENTS.md) antes de tocar código —
  define qué notas del vault leer según la tarea.
- **Humanos**: manual de uso del sistema en [`USAGE.md`](USAGE.md).
- **Cómo funciona el vault por dentro**: [`vault/SYSTEM.md`](vault/SYSTEM.md).

Flujo diario resumido: codear → commit (con permiso explícito) → el hook
`post-commit` genera `.vault-sync/{change_report,facts}.json` → `/sync`
propone cambios al vault → humano aprueba → vault queda alineado al código.
