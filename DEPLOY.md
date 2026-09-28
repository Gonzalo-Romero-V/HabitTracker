# Deploy — Habit Tracker

> Cómo correr el proyecto en una máquina (la misma de desarrollo u otra
> nueva) exponiendo **solo el frontend** al público, con el backend y la
> base de datos accesibles únicamente en `localhost` de esa máquina.
>
> Decisión de arquitectura correspondiente: `vault/decisions/environments.md`
> (parametrización vía `.env`) y el ítem "Dónde se despliega" en
> `vault/decisions/architecture.md`, resuelto en `vault/decisions/deploy.md`.

---

## Topología

```
                              Internet
                                 │
                    (único punto expuesto)
                                 ▼
                    Cloudflare Tunnel (cloudflared)
                         hostname público
                                 │
                                 ▼
                 Next.js — `next start`  (127.0.0.1:PORT)
                 (frontend, build web — BUILD_TARGET=web)
                                 │
              server-side fetch, nunca desde el browser
              (next.config.ts → rewrites `/api/*`)
                                 ▼
                 Laravel — `php artisan serve`
                      (127.0.0.1:8000, NUNCA tuneleado)
                                 │
                                 ▼
                      PostgreSQL (127.0.0.1:5432)
```

El browser del usuario final solo conoce el hostname público del túnel.
Nunca recibe una URL de backend ni de base de datos — el proxy `/api/*` lo
resuelve el propio servidor Next.js (`BACKEND_URL`, sin prefijo
`NEXT_PUBLIC_`, jamás llega al bundle del cliente).

---

## ¿La API queda completamente cerrada?

Sí, por dos mecanismos independientes (no solo uno):

1. **Red**: el backend Laravel y PostgreSQL escuchan en `127.0.0.1`
   (loopback). `php artisan serve` ya bindea a `127.0.0.1` por default — el
   único error que rompería esto es correrlo con `--host=0.0.0.0`, **nunca
   hacerlo**. Cloudflared solo tiene una regla de ingress, hacia el puerto
   del frontend; el backend y la base de datos no tienen ninguna ruta
   pública, con o sin CORS.
2. **CORS** (defensa en profundidad, no el mecanismo principal): el
   skeleton de Laravel no publica `config/cors.php` y cae en
   `allowed_origins => ['*']`. Ya se publicó ese archivo
   (`app/backend/config/cors.php`) restringido a `CORS_ALLOWED_ORIGINS`
   (ver `.env`). Esto importa poco para el aislamiento real (que lo da la
   red), pero evita que, si alguna vez el puerto quedara expuesto por
   error, cualquier página web pudiera leer la respuesta desde el browser
   de un usuario.

La API tampoco usa cookies de sesión para autenticar (`SESSION_*` existe
solo por dependencias internas de Laravel) — el auth real es Bearer token
(Sanctum `personal_access_tokens`), emitido en `login`/`register`/`google`
y enviado por header `Authorization` desde el cliente. No hay CSRF que
gestionar en `/api/*` en este modelo.

### CORS y la app Android empaquetada (Capacitor)

Excepción importante al punto anterior: la app Android empaquetada **sí**
queda sujeta a CORS normal de browser, aunque nunca llame al backend
directo. El WebView de Capacitor sirve el contenido desde `https://localhost`
por default (`server.androidScheme`, sin override en `capacitor.config.ts`).
Sus llamadas a `https://<hostname-del-túnel>/api/*` pasan por el rewrite
server-side del frontend, pero el rewrite reenvía el header `Origin`
original tal cual — Laravel ve `Origin: https://localhost` y decide con su
propio `CORS_ALLOWED_ORIGINS`, no con nada del frontend. Sin
`https://localhost` en esa lista, **todas** las llamadas a la API desde el
APK instalado fallan por CORS (nunca se nota en el browser web, porque ahí
el navegador SÍ es same-origin con el frontend). Ver el comentario en
`app/backend/.env.example` — el default ya incluye este origen.

---

## Variables de entorno

Todo lo que cambia entre máquinas o entornos vive en `.env` — nunca en
código (regla dura, ver `vault/decisions/environments.md`). Tabla completa:

### Backend (`app/backend/.env`)

| Variable | Cambia por máquina | Secreto | Notas |
|---|---|---|---|
| `APP_KEY` | Sí (regenerar) | Sí | `php artisan key:generate`, nunca reusar entre entornos |
| `APP_ENV` | Sí | No | `local` en dev, `production` al desplegar |
| `APP_DEBUG` | Sí | No | `false` en producción (nunca `true`, filtra stack traces) |
| `APP_URL` | Sí | No | URL del propio backend (`http://localhost:8000` en dev/prod, no cambia porque nunca es pública) |
| `DB_HOST`/`DB_PORT`/`DB_DATABASE`/`DB_USERNAME`/`DB_PASSWORD` | Sí | Sí | Credenciales de PostgreSQL local de esa máquina |
| `CORS_ALLOWED_ORIGINS` | Sí | No | Origen(es) del frontend — `http://localhost:3000` en dev, URL pública del túnel en producción |
| `GOOGLE_CLIENT_ID` | Depende del proyecto GCP | Sí | Client ID (web) de Google Cloud Console — mismo valor que `NEXT_PUBLIC_GOOGLE_CLIENT_ID` |
| `GOOGLE_CLIENT_ID_ANDROID` | Depende del proyecto GCP | Sí | Client ID (Firebase) para Sign-In nativo Android |
| `FIREBASE_CREDENTIALS` | Opcional | Sí | Ruta al JSON de la cuenta de servicio. Vacío u omitido → `storage/app/firebase/service-account.json` (ver "Secretos fuera de git") |
| `QUEUE_CONNECTION`, `CACHE_STORE`, `SESSION_DRIVER` | No | No | Ya en `database`, no requieren infraestructura extra (no hace falta Redis) |

### Frontend (`app/frontend/.env` — build web)

| Variable | Cambia por máquina | Secreto | Notas |
|---|---|---|---|
| `BACKEND_URL` | No | No | Server-only, `http://localhost:8000` — el backend siempre es local al frontend, nunca cambia aunque cambie la máquina |
| `BUILD_TARGET` / `NEXT_PUBLIC_BUILD_TARGET` | No | No | `web` para este despliegue |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Depende del proyecto GCP | No (público a propósito) | Mismo valor que `GOOGLE_CLIENT_ID` del backend |

`app/frontend/.env.mobile` es exclusivo del build Capacitor (Android) y no
participa en este despliegue web — ver `vault/decisions/environments.md`.

---

## Secretos fuera de git (no viajan con `git clone`)

Estos archivos están en `.gitignore` a propósito y hay que **copiarlos
manualmente** (o regenerarlos) en cualquier máquina nueva:

| Archivo | De dónde sale | Dónde va |
|---|---|---|
| `service-account.json` (Firebase Admin) | Consola Firebase → proyecto `habittracker-7be67` → Configuración → Cuentas de servicio → Generar nueva clave privada | `app/backend/storage/app/firebase/service-account.json` |
| `google-services.json` | Consola Firebase → proyecto → Configuración de la app Android | `app/frontend/android/app/google-services.json` (solo si se compila el APK, no aplica al despliegue web) |
| `app/backend/.env` | Copiar de `.env.example` y completar valores de esta tabla | `app/backend/.env` |
| `app/frontend/.env` | Copiar de `.env.example` y completar valores | `app/frontend/.env` |

**Windows únicamente**: PHP no trae configurado un CA bundle por default
(`curl.cainfo`/`openssl.cafile` vacíos en `php.ini`), y `verifyIdToken()`
(login con Google) falla con `cURL error 60: unable to get local issuer
certificate` sin esto. Descargar `cacert.pem` (https://curl.se/docs/caextract.html)
y apuntar ambas directivas de `php.ini` a esa ruta. Es configuración de la
máquina, no del repo — repetir en cada máquina Windows nueva.

---

## Bootstrap en una máquina nueva

Requisitos: PHP 8.2+, Composer 2, Node 18.18+, PostgreSQL 17 (con una base
ya creada), npm, `cloudflared` instalado.

```bash
# Backend
cd app/backend
composer install
cp .env.example .env
php artisan key:generate
# completar .env con la tabla de arriba (DB_*, GOOGLE_*, CORS_ALLOWED_ORIGINS)
# copiar storage/app/firebase/service-account.json (ver tabla de secretos)
php artisan migrate --force
php artisan config:cache   # solo producción — recuerda: env() fuera de config/*.php se rompe tras cachear

# Frontend
cd ../frontend
npm install
cp .env.example .env
# completar .env (BACKEND_URL, NEXT_PUBLIC_GOOGLE_CLIENT_ID)
npm run build
```

`lang/es/*.php` (mensajes de validación/auth en español) ya están
commiteados — no requieren `lang:publish` en una máquina nueva.

---

## Correr en producción (4 procesos, cada uno en su propia terminal / servicio)

```bash
# 1) Backend — SIEMPRE con host explícito 127.0.0.1, nunca 0.0.0.0
cd app/backend
php artisan serve --host=127.0.0.1 --port=8000

# 2) Cola — hoy la app no encola jobs propios (los push se envían de forma
#    síncrona dentro de habits:dispatch-due-reminders); se mantiene para
#    la cola `database` de Laravel y jobs futuros
cd app/backend
php artisan queue:work --tries=1

# 3) Scheduler — OBLIGATORIO: ocurrencias, cierres, stats y recordatorios (routes/console.php)
cd app/backend
php artisan schedule:work

# 4) Frontend — build web, sirviendo en el puerto que apunta el túnel
cd app/frontend
PORT=3000 npm run start
```

**El scheduler es obligatorio.** Sin `schedule:work` la API sigue
respondiendo, pero no se materializan las ocurrencias del mes, los días
vencidos nunca pasan a `missed`, las rachas y estadísticas no se
actualizan y no sale ningún recordatorio push (`vault/decisions/architecture.md`
→ Jobs). Esto pasó entre el 9 de agosto y el 28 de septiembre de 2026 y se
notó como hábitos que "desaparecían" de Hoy. Desde entonces, "Hoy" crea la
ocurrencia del día si falta y los jobs se recuperan solos al volver, pero
los recordatorios y los cierres siguen dependiendo del scheduler.

### Después de un tiempo con el scheduler detenido

Los jobs recuperan solos el mes en curso y los últimos 7 días de
estadísticas. Para huecos más largos, ejecuta una vez (es idempotente):

```bash
cd app/backend
php artisan habits:evaluate-closures   # cierra días vencidos y recalcula rachas
php artisan habits:rebuild-stats       # reconstruye estadísticas diarias y mensuales
```

Los días que nunca tuvieron ocurrencia por la falla quedan neutros: no se
rellenan como fallados (`vault/intent/vision.md`).

---

## En esta máquina: scripts de servicios

La producción actual (`habittracker.gonzaloromero.dev`) corre en la PC de
desarrollo con dos scripts de la raíz del repo, ignorados por git porque
contienen rutas locales:

- **`iniciar_servicios.ps1`** — en orden: verifica PostgreSQL, aplica
  `migrate --force` (si falla, no levanta nada más), y abre una terminal
  para cada proceso: API (`127.0.0.1:8010`), queue worker, scheduler,
  frontend (`:3010`) y Cloudflare Tunnel. El frontend se recompila
  automáticamente si `src/`, `public/`, la configuración o algún `.env*`
  son más nuevos que `.next/BUILD_ID`.
- **`detener_servicios.ps1`** — libera los puertos 8010 y 3010, detiene el
  túnel de Habit Tracker y los procesos php de Habit Tracker (queue worker,
  scheduler). `artisan` se lanza con ruta absoluta justamente para poder
  identificarlos sin tocar FinanceHub (puerto 8000, misma máquina).

Para desplegar cambios: `detener_servicios.ps1` y luego
`iniciar_servicios.ps1`. Un cambio de backend queda activo apenas se guarda
(`php artisan serve` lee el código en cada request), así que las
migraciones deben aplicarse enseguida.

---

## Exponer solo el frontend con Cloudflare Tunnel

**Esta sección es una plantilla de referencia** — no crea ni modifica
ningún túnel real. En esta máquina ya existe un túnel nombrado (`far-medic`,
usado por otro proyecto) en `~/.cloudflared/config.yml`; decidir a mano si
Habit Tracker se agrega como una regla de `ingress` más ahí (mismo túnel,
otro hostname) o si se crea un túnel dedicado — ambas opciones son válidas,
la diferencia es solo organizativa.

```yaml
# ~/.cloudflared/config.yml — un túnel puede enrutar varios hostnames
tunnel: <nombre-o-uuid-del-tunnel>
credentials-file: C:/Users/<usuario>/.cloudflared/<uuid>.json

ingress:
  - hostname: <hostname-existente-si-lo-hay>
    service: http://localhost:<puerto-existente>
  - hostname: <hostname-nuevo-de-habit-tracker>   # ej. habits.tu-dominio.com
    service: http://localhost:3000                # el PORT del paso 4 de arriba
  - service: http_status:404                       # catch-all, siempre al final
```

Después de editar: `cloudflared tunnel route dns <tunnel> <hostname-nuevo>`
y correr `cloudflared tunnel run <tunnel>` (o como servicio de Windows).
**Solo el hostname del frontend entra en `ingress`** — el backend y
PostgreSQL nunca tienen una entrada acá, es lo que los mantiene cerrados.

**Importante para el login con Google**: Google Identity Services valida el
origen del navegador contra la lista de "Authorized JavaScript origins" del
OAuth Client ID en Google Cloud Console. En cuanto se fije el hostname
público definitivo, hay que agregarlo ahí (`https://<hostname-nuevo>`) o el
botón de "Continuar con Google" falla en producción aunque funcione en
`localhost`. Un túnel rápido (`cloudflared tunnel --url ...`, sin dominio
propio) genera una URL aleatoria distinta en cada corrida — incompatible
con este requisito, por eso se necesita un túnel nombrado con hostname fijo.

---

## Checklist "cambio de equipo"

Con lo de arriba, mover el proyecto a otra máquina debería ser exactamente
esto y nada de tocar código:

- [ ] Clonar el repo.
- [ ] `app/backend/.env` y `app/frontend/.env` desde sus `.env.example`,
      completando la tabla de variables de arriba.
- [ ] Copiar `storage/app/firebase/service-account.json` (secreto, fuera de git).
- [ ] Windows: configurar `curl.cainfo`/`openssl.cafile` en `php.ini`.
- [ ] `composer install` + `php artisan migrate --force` + `npm install` + `npm run build`.
- [ ] Apuntar (o crear) la regla de `ingress` del túnel de Cloudflare al
      nuevo `localhost:<puerto>` del frontend en esa máquina.
- [ ] Si cambió el hostname público: actualizarlo en "Authorized JavaScript
      origins" del OAuth Client ID en Google Cloud Console.

---

## Nota sobre el vault

La decisión de despliegue está en `vault/decisions/deploy.md` y el
pendiente "Dónde se despliega" de `vault/decisions/architecture.md` está
resuelto.
