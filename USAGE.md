# Cómo funciona el sistema de grafo semántico

Este documento describe cómo se opera el sistema vault-sync en este
proyecto, instanciado a partir de `code-vault-template`. Es la referencia
para el uso diario.

---

## El modelo mental

```
┌─────────────────────────────────────────────────────────────┐
│  CÓDIGO (repo)         ←→         VAULT (segundo cerebro)   │
│  fuente de verdad técnica         fuente de verdad semántica │
└─────────────────────────────────────────────────────────────┘
                  ↕ vault-sync                   ↕
            change_report.json (determinista)
                  ↕
            propuesta de cambios (Claude)
                  ↕
            aprobación humana → script aplica
```

**Capas (jerarquía descendente):**

- **H1 — INTENT**: visión, reglas de negocio, invariantes (`vault/intent/`)
- **H2 — REQUISITOS**: entidades de dominio y reglas operativas (`vault/domain/`, `vault/raw/`)
- **H3 — ARQUITECTURA**: decisiones de stack y patrones (`vault/decisions/`)
- **H4 — CONTRATOS**: modelos, migraciones, schemas, rutas (en código)
- **H5 — IMPLEMENTACIÓN**: controllers, handlers, services, components (en código)

**Regla de oro**: las capas superiores causan las inferiores. Los cambios en
H1–H3 son decisión del equipo y se propagan hacia abajo. Los cambios en H5
nunca contradicen H1–H3 silenciosamente.

---

## Comandos diarios

### `/sync` — después de cada commit aprobado

El git hook ya generó `.vault-sync/change_report.json` y
`.vault-sync/facts.json` automáticamente. El comando a ejecutar:

```
/sync
```

Claude:

1. Lee el reporte y los facts.
2. Identifica qué notas del vault deben actualizarse.
3. **Muestra la propuesta** (qué se actualiza, qué se crea, qué se
   deprecia).
4. Se aprueba (o se piden ajustes).
5. El script aplica los cambios.

Si el commit fue solo H5 (refactor de implementación), la propuesta puede
ser **0 cambios al vault**. Eso está bien.

### `/check` — auditoría de coherencia

Cuando hay dudas sobre si el código sigue reflejando los requisitos:

```
/check
```

Claude corre los chequeos deterministas (`env_references`,
`vault_code_paths`) y luego analiza coherencia semántica entre capas.
Reporta:

- 🔴 **Contradicciones** — el código hace algo que viola una regla del vault
- 🟡 **Drift** — algo en el vault sin reflejo en código (o al revés)
- 🟢 **Coherente** — todo OK

**`/check` no resuelve nada por sí solo.** Reporta y el humano decide.

Si el extractor activo es Graphify, `/check` además verifica que
`graphify-out/graph.json` no esté desactualizado.

### `/ingest <ruta>` — se agregó un documento nuevo

Cuando se coloca un PDF, .txt o imagen en `vault/raw/`:

```
/ingest raw/requisitos-cliente.pdf
```

Claude lee el contenido, extrae conceptos, propone agregar/enriquecer
notas. Tras aprobación, las notas creadas siguen los templates tipados
(`intent/`, `domain/`, `decisions/`).

### `/snapshot` — solo en momentos especiales

- Al iniciar un proyecto nuevo.
- Después de un refactor masivo.
- Cuando se sospecha que el grafo perdió sincronía con el código.

```
/snapshot
```

Claude regenera el mapeo completo concepto ↔ código. **Operación cara en
tokens** — usar con criterio.

---

## Windows: el hook necesita Git Bash

El `post-commit` hook tiene shebang `#!/usr/bin/env bash`. En **Git for
Windows** (instalación por defecto desde el sitio oficial), msys2 lo
interpreta sin problemas. Si se usa Git vía Scoop sin msys, Cygwin u otra
instalación sin un intérprete bash en el PATH del hook, el hook no se
ejecuta y `.vault-sync/` no se regenera tras el commit. En ese caso,
ejecutar manualmente:

```
python scripts/vault_sync.py report
```

Y/o configurar Git para que use el bash de Git for Windows.

### Verificar que el hook esté instalado

El hook versionado vive en `hooks/post-commit`, pero git solo ejecuta lo que
está en `.git/hooks/`, que no viaja con `git clone`. Si
`.vault-sync/change_report.json` no cambia tras un commit, lo más probable
es que no esté instalado (en este repo no lo estuvo hasta el 28 de
septiembre de 2026). Para instalarlo:

```bash
cp hooks/post-commit .git/hooks/post-commit
chmod +x .git/hooks/post-commit
```

Si editas `hooks/post-commit`, vuelve a copiarlo.

---

## Comandos manuales (sin Claude)

```bash
# Estado del sistema
python scripts/vault_sync.py status

# Generar reporte manualmente (lo hace el git hook automáticamente)
python scripts/vault_sync.py report

# Regenerar solo facts.json (sin cambiar el reporte)
python scripts/vault_sync.py facts

# Validar un reporte
python scripts/vault_sync.py validate .vault-sync/change_report.json

# Correr solo los chequeos deterministas
python scripts/vault_sync.py check

# Aplicar un changes.json aprobado
python scripts/vault_sync.py apply .vault-sync/proposed-changes.json
```

Exit codes:

| Código | Significado |
|---|---|
| 0 | Éxito |
| 1 | Argumentos inválidos / archivo no encontrado |
| 2 | Reporte excede `max_files` — dividir el commit |
| 3 | Reporte falló schema validation |
| 4 | `check` encontró failures de consistency |
| 5 | `apply` tuvo operaciones fallidas |

---

## Reglas que el sistema respeta SIEMPRE

1. **Nunca** modifica notas con `status: locked`. Si una propuesta de
   `/sync` intenta tocar una, abortar manualmente.
2. **Nunca** borra una nota. Como mucho, la marca `deprecated`.
3. **Nunca** sobrescribe el cuerpo entero de una nota. Solo: setea
   frontmatter, agrega secciones.
4. **Idempotente**: aplicar el mismo `changes.json` dos veces no produce
   cambios duplicados.
5. **Falla ruidosa**: si algo no cuadra, aborta y loguea. No adivina.
6. **Logs en `.vault-sync/sync.log`**: revisar ahí cuando haya dudas sobre
   qué pasó.

---

## Estados de las notas

| `status` | Significado | Quién la modifica |
|----------|-------------|-------------------|
| `draft` | Borrador | Claude libremente |
| `stable` | Activa | Claude solo `code_path` y secciones append |
| `locked` | Inmutable | Solo edición humana directa |
| `deprecated` | Obsoleta, queda como histórico | Nadie la actualiza |

---

## Flujo cotidiano completo

```
1. Se codea un cambio
2. Claude pide permiso de commit → propone mensaje → se aprueba
3. git commit (post-commit hook genera change_report.json + facts.json)
4. Si el cambio amerita actualizar el vault → /sync
5. Claude presenta la propuesta
6. Se aprueba o se ajusta
7. Vault actualizado
8. (Opcional) /check si se tocó algo crítico
```

**Antes de cualquier acción de impacto** (commit, push, sync, ingest),
Claude **siempre** pide aprobación explícita.

---

## Trabajando con un stack nuevo (catálogo acumulativo)

Si el proyecto usa una pila sin archetype (Angular, Java/Spring, Go, Rust,
Ruby/Rails, etc.), elegir `--stack generic` en el bootstrap. El extractor
`generic`:

1. **Detecta el stack** por signal files (`package.json`, `pom.xml`,
   `Cargo.toml`, `angular.json`, `go.mod`, `Gemfile`, etc.).
2. **Corre extracción genérica baseline**: file listing por capa
   heurística, env vars universales, import graph regex multi-lenguaje.
3. Si el stack detectado **no está en el catálogo**, escribe 2 scaffolds:
   - `bootstrap/stacks/_proposed_<stack>.json` — config inferido de
     convenciones.
   - `scripts/lib/extractors/_proposed_<stack>.py` — clase scaffold con
     TODOs.
4. Avisa en stdout y en `facts.json::proposed_files`.

Pasos siguientes:

1. Editar el extractor con parsers específicos del framework.
2. Quitar el prefijo `_proposed_` en ambos archivos.
3. Registrar la clase en `scripts/lib/extractors/__init__.py::REGISTRY`.

El sistema **nunca auto-promueve** — el humano valida. Es scaffolding
honesto, no auto-aprendizaje.

Ver `README.md` sección "Cómo contribuir → Agregar un stack al catálogo"
para el detalle.

---

## Re-instanciar o cambiar de stack

Para cambiar el extractor activo sin re-bootstrappear:

```bash
# Editar manualmente:
"extractor": "graphify"      # en vault_sync.config.json
```

Después ejecutar `python scripts/vault_sync.py facts` para regenerar
`facts.json` con el nuevo extractor. El `change_report.json` no cambia (su
schema es universal).

Para bootstrappear el sistema sobre un proyecto **que ya existe** (sin
clonar el template), ver `README.md` sección "Inicio rápido". La idea es
clonar el template a una carpeta hermana y copiar a mano `scripts/`,
`.claude/`, `hooks/`, y los 3 markdowns (`AGENTS.md`, `CLAUDE.md`,
`USAGE.md`).
