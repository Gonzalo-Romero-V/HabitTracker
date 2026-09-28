#!/usr/bin/env python3
"""init_vault.py — bootstrapper del Code Vault.

Instancia el sistema completo en un proyecto nuevo: crea el vault Obsidian,
sustituye placeholders en la config y AGENTS.md, e instala el git hook.

Modo de operación: in-place. Se asume que el cwd YA es el template clonado
(p.ej. `git clone <url> mi-proyecto && cd mi-proyecto`). El bootstrapper no
copia archivos del template a sí mismos; solo (a) crea el vault externo,
(b) sustituye placeholders en los archivos del cwd, y (c) instala el hook.

Uso:

    python bootstrap/init_vault.py \\
        --stack nextjs-laravel \\
        --project-name "MiProyecto" \\
        --vault-path "/ruta/absoluta/al/vault" \\
        [--with-graphify]
        [--dry-run]

Reglas:
    - Zero dependencias externas (stdlib only).
    - Cross-platform (Windows / Unix) usando pathlib.
    - Falla loud: validaciones previas con mensajes accionables.
    - Idempotente bajo --dry-run: dos invocaciones imprimen las mismas operaciones.
    - No sobreescribe un vault existente — `--vault-path` debe no existir.
    - El hook se escribe con line endings LF (necesario para shebang en Unix).
"""
from __future__ import annotations

import argparse
import json
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path


# Paths del propio template — resueltos respecto a este archivo.
TEMPLATE_ROOT = Path(__file__).resolve().parent.parent
STACKS_DIR = TEMPLATE_ROOT / "bootstrap" / "stacks"
VAULT_SKELETON = TEMPLATE_ROOT / "bootstrap" / "vault-skeleton"
HOOK_SRC = TEMPLATE_ROOT / "hooks" / "post-commit"
AGENTS_TEMPLATE = TEMPLATE_ROOT / "AGENTS.md"


# ──────────────────────────────────────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────────────────────────────────────

def parse_args(argv: list[str]) -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="init_vault.py",
        description="Bootstrap del Code Vault en el repo del cwd.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Stacks disponibles: ver bootstrap/stacks/*.json.\n"
            "Para stacks no listados, usa --stack generic y el extractor\n"
            "detectará el lenguaje y dejará propuestas _proposed_<stack>.* en\n"
            "bootstrap/stacks/ y scripts/lib/extractors/ para que las promovás."
        ),
    )
    p.add_argument("--stack", required=True,
                   help="archetype a usar (ej: nextjs-laravel, python-fastapi, generic)")
    p.add_argument("--project-name", required=True,
                   help="nombre humano del proyecto; sustituye __PROJECT_NAME__")
    p.add_argument("--vault-path", required=True,
                   help="ruta absoluta al vault Obsidian — NO debe existir")
    p.add_argument("--with-graphify", action="store_true",
                   help="forzar extractor 'graphify' (sobreescribe el del archetype)")
    p.add_argument("--dry-run", action="store_true",
                   help="imprime las operaciones planeadas sin escribir nada")
    return p.parse_args(argv)


# ──────────────────────────────────────────────────────────────────────────────
# Validación previa
# ──────────────────────────────────────────────────────────────────────────────

def list_available_stacks() -> list[str]:
    if not STACKS_DIR.exists():
        return []
    return sorted(p.stem for p in STACKS_DIR.glob("*.json"))


def validate(args: argparse.Namespace) -> tuple[Path, Path]:
    """Falla loud si una precondición no se cumple. Devuelve (repo_root, vault_path)."""
    errors: list[str] = []

    # Template sano
    if not STACKS_DIR.exists():
        errors.append(f"Template inválido: no existe {STACKS_DIR}")
    if not VAULT_SKELETON.exists():
        errors.append(f"Template inválido: no existe {VAULT_SKELETON}")
    if not HOOK_SRC.exists():
        errors.append(f"Template inválido: no existe {HOOK_SRC}")
    if not AGENTS_TEMPLATE.exists():
        errors.append(f"Template inválido: no existe {AGENTS_TEMPLATE}")

    # Bootstrap doble: si AGENTS.md ya no contiene __PROJECT_NAME__, el repo
    # ya fue bootstrappeado. Sustituir un placeholder inexistente es no-op
    # silencioso y dejaría el repo en estado inconsistente.
    if AGENTS_TEMPLATE.exists():
        try:
            agents_text = AGENTS_TEMPLATE.read_text(encoding="utf-8")
            if "__PROJECT_NAME__" not in agents_text:
                errors.append(
                    "AGENTS.md ya no tiene placeholders — este repo parece haber sido\n"
                    "    bootstrappeado antes. Re-bootstrappear in-place no es soportado.\n"
                    "    Opciones:\n"
                    "      a) git restore AGENTS.md vault_sync.config.json  (descarta el bootstrap previo)\n"
                    "      b) Clonar el template a una carpeta nueva."
                )
        except OSError:
            pass

    # Stack debe existir
    stack_file = STACKS_DIR / f"{args.stack}.json"
    if STACKS_DIR.exists() and not stack_file.exists():
        errors.append(
            f"--stack '{args.stack}' no es un archetype conocido.\n"
            f"    Disponibles:  {list_available_stacks()}\n"
            f"    Buscado en:   {stack_file}"
        )

    # Vault path: absoluto y no debe existir
    vault = Path(args.vault_path).expanduser()
    if not vault.is_absolute():
        errors.append(
            f"--vault-path debe ser absoluto: {args.vault_path}\n"
            f"    Sugerencia: usar $HOME/vaults/... o C:\\Users\\...\\vaults\\..."
        )
    elif vault.exists():
        errors.append(
            f"--vault-path ya existe: {vault}\n"
            f"    El bootstrapper rechaza sobreescribir un vault.\n"
            f"    Elige otra ruta o bórrala manualmente antes de reintentar."
        )

    # Cwd debe ser un repo git (hook se instala en .git/hooks/)
    repo_root = Path.cwd()
    git_dir = repo_root / ".git"
    if not git_dir.exists():
        errors.append(
            f"El cwd no es un repositorio git: {repo_root}\n"
            f"    Corre 'git init' antes del bootstrapper."
        )

    # Project name básico
    if not args.project_name.strip():
        errors.append("--project-name no puede estar vacío.")

    if errors:
        sys.stderr.write("\nERROR de validación previa:\n\n")
        for e in errors:
            sys.stderr.write(f"  • {e}\n\n")
        sys.exit(2)

    return repo_root, vault


# ──────────────────────────────────────────────────────────────────────────────
# Carga del archetype y placeholders
# ──────────────────────────────────────────────────────────────────────────────

def _strip_doc_keys(obj):
    """Filtra recursivamente claves '_doc*' de dicts anidados.

    Esto evita que comentarios paralelos (tanto top-level como anidados dentro
    de hierarchy_mapping u otros subdicts) se cuelen al config final, donde
    podrían confundir al engine (ej. detect_layer iterando sobre un fake layer
    '_doc').
    """
    if isinstance(obj, dict):
        return {k: _strip_doc_keys(v) for k, v in obj.items()
                if not k.startswith("_doc")}
    if isinstance(obj, list):
        return [_strip_doc_keys(item) for item in obj]
    return obj


def load_stack_config(stack_name: str) -> dict:
    """Lee el archetype JSON descartando recursivamente las claves '_doc*'."""
    raw = json.loads((STACKS_DIR / f"{stack_name}.json").read_text(encoding="utf-8"))
    return _strip_doc_keys(raw)


def build_replacements(args: argparse.Namespace, vault_path: Path) -> dict[str, str]:
    """Mapa de placeholders → valor concreto."""
    return {
        "__PROJECT_NAME__": args.project_name,
        "__VAULT_ABSOLUTE_PATH__": vault_path.as_posix(),
        "__DATE__": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "__STACK__": args.stack,
    }


def substitute(text: str, replacements: dict[str, str]) -> str:
    for placeholder, value in replacements.items():
        text = text.replace(placeholder, value)
    return text


# ──────────────────────────────────────────────────────────────────────────────
# Planificación de operaciones (dict-based para soportar --dry-run)
# ──────────────────────────────────────────────────────────────────────────────

def plan_operations(args: argparse.Namespace, stack_cfg: dict,
                    repo_root: Path, vault_path: Path) -> list[dict]:
    """Devuelve la lista ordenada de operaciones que execute() ejecutará."""
    ops: list[dict] = []

    # 1) Crear el vault con el skeleton. Cada .md.tpl se renombra a .md.
    for src in sorted(VAULT_SKELETON.rglob("*")):
        if src.is_dir():
            continue
        rel = src.relative_to(VAULT_SKELETON)
        # Renombrar .tpl → quita la extensión, ej: vision.md.tpl → vision.md.
        if rel.suffix == ".tpl":
            rel = rel.with_suffix("")
        dst = vault_path / rel
        ops.append({"action": "render_into_vault", "src": src, "dst": dst})

    # 2) Generar vault_sync.config.json final con valores reales.
    #    stack_cfg ya viene sin _doc* (filtrado recursivamente por load_stack_config),
    #    así que solo sustituimos los valores variables.
    final_cfg = dict(stack_cfg)
    final_cfg["project_name"] = args.project_name
    final_cfg["vault_path"] = vault_path.as_posix()
    if args.with_graphify:
        final_cfg["extractor"] = "graphify"
    ops.append({
        "action": "write_json",
        "dst": repo_root / "vault_sync.config.json",
        "content": final_cfg,
    })

    # 3) Regenerar AGENTS.md sustituyendo placeholders.
    ops.append({
        "action": "render_template",
        "src": AGENTS_TEMPLATE,
        "dst": repo_root / "AGENTS.md",
    })

    # 4) Instalar el git hook.
    ops.append({
        "action": "install_hook",
        "src": HOOK_SRC,
        "dst": repo_root / ".git" / "hooks" / "post-commit",
    })

    # 5) Inicializar .vault-sync/ (carpeta para reports posteriores).
    ops.append({
        "action": "ensure_dir",
        "dst": repo_root / ".vault-sync",
    })

    return ops


# ──────────────────────────────────────────────────────────────────────────────
# Ejecución
# ──────────────────────────────────────────────────────────────────────────────

def execute(ops: list[dict], replacements: dict[str, str], dry_run: bool) -> None:
    for op in ops:
        action = op["action"]
        dst = op["dst"]

        if action == "render_into_vault":
            text = op["src"].read_text(encoding="utf-8")
            text = substitute(text, replacements)
            _do_write(dst, text, dry_run, kind="VAULT")

        elif action == "write_json":
            body = json.dumps(op["content"], indent=2, ensure_ascii=False) + "\n"
            _do_write(dst, body, dry_run, kind="JSON ")

        elif action == "render_template":
            text = op["src"].read_text(encoding="utf-8")
            text = substitute(text, replacements)
            _do_write(dst, text, dry_run, kind="MD   ")

        elif action == "install_hook":
            # Leer y normalizar a LF — el shebang en Unix falla con CRLF.
            body = op["src"].read_text(encoding="utf-8").replace("\r\n", "\n")
            if dry_run:
                print(f"  [dry-run] HOOK   {dst}  (+x)")
            else:
                dst.parent.mkdir(parents=True, exist_ok=True)
                dst.write_bytes(body.encode("utf-8"))
                _chmod_executable(dst)
                print(f"  HOOK     {dst}  (+x)")

        elif action == "ensure_dir":
            if dry_run:
                print(f"  [dry-run] MKDIR  {dst}")
            else:
                dst.mkdir(parents=True, exist_ok=True)
                print(f"  MKDIR    {dst}")

        else:
            raise ValueError(f"Unknown op action: {action}")


def _do_write(dst: Path, content: str, dry_run: bool, kind: str) -> None:
    if dry_run:
        print(f"  [dry-run] {kind}  {dst}  ({len(content)} chars)")
    else:
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(content, encoding="utf-8")
        print(f"  {kind}    {dst}")


def _chmod_executable(path: Path) -> None:
    """Agrega bits de ejecución (no-op silencioso en Windows)."""
    try:
        cur = path.stat().st_mode
        path.chmod(cur | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    except OSError:
        # Windows no soporta chmod tradicional; el hook funciona igual bajo Git Bash.
        pass


# ──────────────────────────────────────────────────────────────────────────────
# Mensaje final
# ──────────────────────────────────────────────────────────────────────────────

def print_next_steps(args: argparse.Namespace, vault_path: Path) -> None:
    extractor = "graphify" if args.with_graphify else "(según archetype)"
    print()
    print("=" * 70)
    print(f"  Code Vault inicializado — '{args.project_name}'")
    print("=" * 70)
    print()
    print(f"  Vault:       {vault_path}")
    print(f"  Stack:       {args.stack}")
    print(f"  Extractor:   {extractor}")
    print()
    print("  Próximos pasos:")
    print()
    print(f"    1. Editar  {(vault_path / 'intent' / 'vision.md').as_posix()}")
    print("       (H1 — obligatorio antes del primer feature)")
    print()
    print(f"    2. Editar  {(vault_path / 'decisions' / 'stack.md').as_posix()}")
    print("       (H3 — decisiones técnicas)")
    print()
    print("    3. git add . && git commit -m 'chore: init code-vault'")
    print("       → El hook generará .vault-sync/change_report.json automáticamente.")
    print()
    print("    4. Ejecutar /snapshot si el repo tiene código pre-existente.")
    print()
    if args.with_graphify:
        print("  Graphify activo — antes del primer /sync correr:")
        print("    pip install graphifyy")
        print("    graphify extract . --no-cluster")
        print()


# ──────────────────────────────────────────────────────────────────────────────
# Entry point
# ──────────────────────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    # En consolas legacy (cmd.exe, Git Bash sin LANG) el default es cp1252 y las
    # tildes salen como mojibake. Reconfiguramos a UTF-8 si está disponible.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8")
        except (AttributeError, OSError):
            pass

    args = parse_args(argv if argv is not None else sys.argv[1:])
    repo_root, vault_path = validate(args)
    stack_cfg = load_stack_config(args.stack)
    replacements = build_replacements(args, vault_path)
    ops = plan_operations(args, stack_cfg, repo_root, vault_path)

    mode = "DRY-RUN" if args.dry_run else "EXECUTING"
    print()
    print(f"  Code Vault bootstrap  stack='{args.stack}'  project='{args.project_name}'")
    print(f"  {mode}: {len(ops)} operations")
    print()

    execute(ops, replacements, args.dry_run)

    if args.dry_run:
        print()
        print(f"  [dry-run] No se escribió nada. {len(ops)} operations planeadas.")
    else:
        print_next_steps(args, vault_path)

    return 0


if __name__ == "__main__":
    sys.exit(main())
