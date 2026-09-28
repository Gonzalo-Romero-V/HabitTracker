# Habit Tracker — Guía para agentes de IA

> Esta guía es **canónica** y la lee cualquier CLI de IA que abra el repo
> (Claude Code, Codex CLI, Cursor, etc.). `CLAUDE.md` la importa con `@AGENTS.md`.
>
> Stack activo: **`nextjs-laravel`** (extractor configurado en `vault_sync.config.json`).

---

## ⚠️ Pre-flight obligatorio (antes de tocar código)

El proyecto tiene un **vault Obsidian** como fuente de verdad semántica.
El código (H4–H5) refleja al vault (H1–H3), nunca al revés.
**Saltar este protocolo produce código que contradice contratos documentados.**

Toda sesión nueva, antes de la primera respuesta no-trivial, debe:

1. **Leer este archivo completo** — ya estás acá, sigamos.
2. **Leer el `INDEX.md` del vault** (`vault/INDEX.md`, relativo a la raíz del
   repo). Nota: en este proyecto el vault vive **dentro** del repo, en
   `./vault` — decisión deliberada (no la recomendación genérica de vault
   externo), versionado junto con el código.
3. **Identificar la tarea** y consultar la tabla de abajo para saber qué notas leer.
4. **Leer SOLO esas notas** — no leer el vault completo, no inventar.
5. **Recién entonces** explorar código del repo.

Si la tarea es trivial y no toca dominio (cambiar un copy, fix de import,
ajustar un README), los pasos 3–5 son opcionales — usar criterio.

---

## Qué notas leer según la tarea

> Tabla completada para el dominio real de Habit Tracker (ver también la
> copia en `vault/INDEX.md`, que es la fuente canónica — esta es un espejo
> para que el agente no tenga que abrir dos archivos).

| Tarea | Notas obligatorias |
|-------|---------------------|
| Nueva entidad de dominio | `domain/<entidad>.md` (usar `domain/entity.md` como plantilla) + `decisions/architecture.md` |
| Nuevo endpoint / ruta API | `decisions/api-contracts.md` + `domain/<entidad>.md` involucrada |
| Cambio en tipos de métrica (count/duration/currency) | `domain/habit-metric.md` + `domain/habit-metric-log.md` + `decisions/stack.md` |
| Cambio en cálculo de streak o expansión de recurrencia | `domain/habit.md` + `domain/habit-log.md` |
| Cambio en recordatorios / push notifications | `domain/reminder.md` + `domain/device-token.md` + `decisions/stack.md` (FCM) |
| Refactor de autenticación / autorización | `decisions/architecture.md` (Gestión de auth) + `intent/vision.md` (invariante de aislamiento por usuario) |
| Cambio de stack / librería estructural | `decisions/stack.md` + impacto en H4 completo |
| Cambiar URL de API / config de entorno / build mobile vs web | `decisions/environments.md` |
| Cualquier texto visible al usuario (UI, error, notificación, email) | `decisions/i18n-copy.md` (🔒 español neutro EC, tú, sin voseo — aplica también a este propio repo) |
| Estilos globales, tema claro/oscuro, tokens de color, responsive | `decisions/design-system.md` |
| Feature de **Proyectos** (Project/Phase/Activity) | `intent/roadmap.md` primero — no está modelado en H2 todavía |
| Feature cross-entidad (ej. dashboard de estadísticas) | todas las `domain/*.md` involucradas |
| Jobs programados (ocurrencias, cierres, stats, recordatorios) | `domain/habit-log.md` + `domain/habit-monthly-stat.md` + `domain/user-daily-stat.md` + `decisions/architecture.md` (Jobs) |
| Arranque/operación de producción (servicios, scheduler, build) | `decisions/deploy.md` + `DEPLOY.md` |

Si una nota referenciada no existe → **preguntar al humano**, no inventar.

---

## Regla de oro: contradicción → reportar, no resolver

Si el código actual contradice una nota del vault con `status: stable` o `locked`:

1. Parar.
2. Reportar al humano qué nota dice qué y qué código contradice.
3. Esperar decisión.

Resolver unilateralmente es **prohibido** (`SYSTEM.md`, regla 3).

---

## Estados de las notas

| Status | Edición |
|--------|---------|
| `draft` | Modificable libremente vía `/sync` |
| `stable` | Solo `code_path` y `append_section` vía `/sync` |
| `locked` | Inmutable — solo edición humana directa |
| `deprecated` | Histórico — nadie la actualiza |

Operaciones prohibidas siempre:

- Borrar archivos del vault.
- Sobrescribir cuerpo completo de una nota.
- Modificar notas `locked`.

---

## Flujo de trabajo cotidiano

```
1. Se recibe la tarea
2. Pre-flight (arriba) → leer vault relevante
3. Se implementa el código
4. Se pide al humano permiso para commit + se propone mensaje
5. git commit
   └─ post-commit hook genera .vault-sync/{change_report,facts}.json automáticamente
6. /sync skill → propone cambios al vault basados en el reporte
7. Humano revisa propuesta → aprueba o ajusta
8. apply ejecuta → vault queda alineado al código
```

**Después de cada commit no-trivial, sugerir al humano correr `/sync`** para
que el grafo refleje el estado actual. Si no se hace, el vault drifta y la
próxima sesión de IA tendrá contexto desactualizado.

Si el commit fue solo refactor de implementación (H5), `/sync` puede
proponer 0 cambios — eso es correcto.

---

## Reglas inviolables (resumen)

1. **Antes de tocar dominio**: leer las notas correspondientes del vault.
2. **Antes de cualquier commit / push**: pedir confirmación explícita al humano.
3. **Nunca** modificar notas con `status: locked`.
4. **Nunca** borrar notas (usar `deprecate` si hace falta).
5. **Nunca** commitear secrets (`.env`, credenciales, claves API).
6. **Solo proponer** cambios al vault; la aplicación la hace `apply` tras aprobación.
7. **Preferir scripts deterministas** (`scripts/vault_sync.py`) sobre razonamiento
   LLM cuando la operación es estructural (extracción de modelos, migraciones,
   rutas, imports).

---

## Skills disponibles

| Skill | Cuándo usar |
|-------|-------------|
| `/snapshot` | Solo en arranque de proyecto, refactor masivo, o sospecha de drift severo. Caro en tokens. |
| `/sync` | Después de cada commit aprobado. El flujo natural de mantenimiento del grafo. |
| `/ingest <ruta>` | Después de dropear un PDF / .txt / imagen en `vault/raw/`. |
| `/check` | Cuando dudes de la coherencia entre código y vault. Solo reporta, no resuelve. |

> **Si tu CLI no soporta slash commands** (Codex CLI, Cursor, Cline, Continue,
> etc.), las mismas 4 operaciones están documentadas de forma agnóstica en
> [`prompts/SKILLS.md`](prompts/SKILLS.md). Cuando el usuario te pida
> "sincronizar", "auditar", "ingerir" o "tomar snapshot", leer ese archivo
> antes de operar. El engine determinista (`scripts/vault_sync.py`) es el
> mismo en todos los casos.

Más detalle en `USAGE.md` (cara dev) y `vault/SYSTEM.md` (cara agente).

---

## Contexto rápido del proyecto

### Vault y código

- **Vault**: `./vault` (dentro del repo, ruta relativa en `vault_sync.config.json`)
- **Sistema vault-sync**: `vault/SYSTEM.md` (locked, leer una vez por sesión)
- **Manual de uso humano**: `USAGE.md`
- **Engine determinista**: `scripts/vault_sync.py` (stdlib only, 0 deps externas)
- **Estado en vivo**: `.vault-sync/facts.json` — snapshot semántico, actualizado
  por el post-commit hook. **No leer el código si la respuesta ya está acá.**
- **Extractor activo**: `nextjs-laravel`. Los campos que produce en `facts.json`
  varían según el extractor; ver `scripts/lib/extractors/<extractor>.py` para
  el contrato exacto.

### Stack

Documentado en `vault/decisions/stack.md`. Si se tocan dependencias,
librerías estructurales o decisiones de stack, esa nota es lectura
**obligatoria**.

### Convenciones

Documentadas en `vault/decisions/architecture.md`: capas, naming, manejo de
errores, autenticación, separación de responsabilidades. Cualquier feature
que toque más de un archivo debería respetar esas convenciones.

### Commits

- Mensajes en inglés (o como decidas en `decisions/git.md` si existe).
- Prefijos: `feat: fix: refactor: docs: style: chore: test:`.
- Cortos y honestos sobre el "qué/por qué", no sobre el "cómo".

---

## Estado del proyecto

Bootstrappeado con `--stack nextjs-laravel` el `2026-07-17`. **El MVP está
implementado y en producción** (`habittracker.gonzaloromero.dev`, servido
desde esta misma PC). El vault ya no es solo modelado: cada nota de
`domain/` tiene `code_path` y secciones de implementación, y la más
reciente, "Actualización 2026-09-28", refleja el estado real tras la
auditoría de lógica. Si el cuerpo de una nota contradice una sección
"Actualización" posterior, manda la sección más reciente.

- **Backend** (`app/backend`): Laravel 12 + Sanctum + PostgreSQL. Lógica de
  dominio en `app/Services/` (`HabitLogService`, `HabitLifecycleService`,
  `StreakService`, `HabitOccurrenceMaterializer`, consolidadores de stats).
- **Frontend** (`app/frontend`): Next.js App Router, 4 pestañas (Hoy,
  Calendario, Memento Mori, Análisis) + onboarding; el mismo build se
  empaqueta para Android con Capacitor.
- **Jobs**: `routes/console.php`. El scheduler (`schedule:work`) es
  obligatorio: sin él no se materializan ocurrencias, no se cierran días ni
  salen recordatorios. Ver `vault/decisions/architecture.md` → Jobs.
- **Tests backend**: `php artisan test` contra PostgreSQL
  (`habittracker_test`), nunca SQLite. Ver `decisions/architecture.md`.
- **Decisiones que siguen abiertas**: testing del frontend
  (`decisions/architecture.md`), paleta de marca y safe-area
  (`decisions/design-system.md`), meta descendente en métricas
  (`domain/habit-metric-log.md`).

### Producción corre en esta máquina — cuidado

- `iniciar_servicios.ps1` / `detener_servicios.ps1` (raíz, ignorados por
  git) levantan y detienen todo. Ver `DEPLOY.md` y `decisions/deploy.md`.
- La base `HabitTracker` son **datos reales**. Nunca escribir en ella para
  probar: usar `habittracker_test`.
- `php artisan serve` lee el PHP del disco en cada request: un cambio de
  backend queda activo al instante. Las migraciones se aplican enseguida,
  nunca se dejan pendientes.
- Los cambios de frontend solo llegan a producción al reiniciar los
  servicios, porque el script recompila cuando detecta cambios.
- FinanceHub corre en la misma máquina (puerto 8000): nunca detener sus
  procesos.

---

## Por qué este protocolo existe (anti-patrón histórico)

Sin pre-flight, una IA típicamente:

1. **Inventa enums**: ej. asume `Pedido.estado = "preparando|listo"` cuando
   el canónico es `pendiente|en_camino|entregado|cancelado` (especificado
   en `domain/pedido.md`).
2. **Duplica endpoints** o contradice una matriz de permisos documentada
   en `decisions/rbac.md`.
3. **Deja el vault desactualizado**, drifteando capa H4 vs H2 hasta que
   nadie sabe cuál tiene razón.

El vault existe precisamente para que la próxima sesión de IA pueda
recuperar contexto en **pocos tokens** (notas concisas, hipervínculos
`[[entidad]]`, índice). Cada vez que se salta `/sync`, se rompe ese contrato.

Tres frases que resumen el sistema:

> El código (H4–H5) refleja al vault (H1–H3), nunca al revés.
> El vault es la fuente de verdad semántica; el código es la fuente de verdad técnica.
> Contradicción se reporta, no se resuelve unilateralmente.
