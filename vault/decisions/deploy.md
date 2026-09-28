---
status: draft
type: decision
layer: H3
created: 2026-07-21
code_path: DEPLOY.md
---

# Deploy — Habit Tracker

## Qué

Resuelve el pendiente "dónde se despliega" abierto en [[architecture]]:
el backend (Laravel) y PostgreSQL corren en la misma máquina, bindeados a
`127.0.0.1` (nunca `0.0.0.0`) — no se exponen a Internet bajo ninguna
circunstancia. Solo el frontend (Next.js, build web) se expone al público,
vía un túnel nombrado de Cloudflare (`cloudflared`) con hostname fijo.

## Por qué

El frontend web ya proxea `/api/*` server-side hacia `BACKEND_URL` (ver
[[environments]]) — el browser del usuario final nunca conoce la URL del
backend. Tunelear solo el frontend aprovecha ese mecanismo existente en vez
de agregar uno nuevo: un solo punto de entrada público, superficie de
ataque mínima, cero configuración de red adicional para backend/DB.

## Mecanismo

- Cloudflare Tunnel con hostname fijo (no túnel rápido/`trycloudflare.com`
  — Google Identity Services exige un origen estable para el login con
  Google, y una URL aleatoria por corrida lo rompe).
- CORS del backend restringido vía `CORS_ALLOWED_ORIGINS`
  (`app/backend/config/cors.php`, publicado explícitamente — el skeleton
  de Laravel no lo trae y cae en `allowed_origins: ['*']`). Defensa en
  profundidad: el aislamiento real es de red, no de CORS, porque la API se
  autentica con Bearer token (Sanctum), nunca con cookies.
- Los 4 procesos de producción (`serve`, `queue:work`, `schedule:work`,
  `next start`) corren en la misma máquina — procedimiento operativo
  completo (variables por app, secretos fuera de git, gotcha de CA bundle
  en Windows) en `DEPLOY.md`, no duplicado acá.

## Restricciones derivadas

- El backend nunca acepta `--host=0.0.0.0`.
- Ninguna regla de `ingress` del túnel apunta al puerto del backend o de
  PostgreSQL — solo al puerto del frontend.
- Cambiar de máquina es solo variables de `.env` + copiar los secretos
  fuera de git (ver checklist en `DEPLOY.md`) — nunca tocar código.

## Actualización 2026-09-28 — auditoría de lógica (commit 466e1f3)
Proceso operativo real en la máquina de producción (scripts locales en la
raíz del repo, ignorados por git: `iniciar_servicios.ps1` y
`detener_servicios.ps1`; detalle en `DEPLOY.md`):

- `iniciar_servicios.ps1`: PostgreSQL → `migrate --force` (aborta si falla)
  → API (:8010) → queue worker → **scheduler** → frontend (:3010, se
  recompila si `src/`, `public/`, la config o `.env*` son más nuevos que
  `.next/BUILD_ID`) → Cloudflare Tunnel.
- Antes el script no lanzaba el scheduler y solo compilaba el frontend si
  no existía ningún build. Por eso producción servía un build del 6 de
  agosto sin la corrección de paginación (`94ec506`) que evitaba que "Hoy"
  escondiera hábitos.
- `artisan` se invoca con ruta absoluta para que `detener_servicios.ps1`
  identifique los procesos php de Habit Tracker sin tocar FinanceHub
  (antes el queue worker nunca se detenía).
- `php artisan serve` lee el PHP del disco en cada request: los cambios de
  backend quedan activos al instante, así que las migraciones deben
  aplicarse enseguida y no dejarse pendientes.
