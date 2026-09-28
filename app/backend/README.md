# Habit Tracker — Backend (Laravel)

API REST (`/api/v1`) de Habit Tracker: Laravel 12 + Sanctum (tokens Bearer)
+ PostgreSQL. Contrato y convenciones en
[`vault/decisions/api-contracts.md`](../../vault/decisions/api-contracts.md).
Visión general en el [README raíz](../../README.md).

## Estructura

| Carpeta | Qué contiene |
|---|---|
| `app/Http/Controllers/Api/V1` | Controllers delgados: validan con Form Requests y delegan |
| `app/Services` | Lógica de dominio: `HabitLogService` (registrar, actualizar y deshacer; solo hoy), `HabitLifecycleService` (archivar, reactivar, reprogramar), `StreakService`, `HabitOccurrenceMaterializer`, `RecurrenceExpansionService`, consolidadores de estadísticas |
| `app/Console/Commands` | Jobs programados y comandos de mantenimiento (ver abajo) |
| `routes/api.php` | Rutas de la API |
| `routes/console.php` | Programación del scheduler |
| `tests/Feature` | Tests de regresión del dominio |

Reglas clave (detalle en `vault/decisions/architecture.md`):

- "Hoy" siempre es `User::today()`, en el timezone del usuario. Nunca
  `Date::today()`, que usa el timezone del servidor (UTC).
- Los controllers no contienen reglas de negocio; viven en `app/Services`.

## Desarrollo

```bash
composer install
cp .env.example .env && php artisan key:generate   # completar DB_* en .env
php artisan migrate
php artisan serve           # http://localhost:8000
php artisan schedule:work   # otra terminal: obligatorio (ver Jobs)
```

## Tests

Corren contra **PostgreSQL**, no SQLite: la app compara columnas `date` por
igualdad y SQLite las guarda con hora. `phpunit.xml` apunta a la base
`habittracker_test` (vacía; las credenciales salen de `.env`).

```bash
php artisan test
```

## Jobs

| Comando | Frecuencia | Qué hace |
|---|---|---|
| `habits:materialize-month` | cada hora | Crea las ocurrencias `pending` de hábitos fijos desde hoy hasta fin de mes (y el mes siguiente el último día); consolida el mes recién cerrado |
| `habits:evaluate-closures` | cada 30 min | Días vencidos → `missed`, rachas, estadísticas de los últimos 7 días, auto-archivado por vigencia |
| `habits:dispatch-due-reminders` | cada minuto | Recordatorios push (FCM) |
| `habits:rebuild-stats` | manual | Reconstruye todas las estadísticas cerradas desde el historial (idempotente) |

Todos son idempotentes y se recuperan solos si el servidor estuvo apagado.
Despliegue y operación: [`DEPLOY.md`](../../DEPLOY.md).
