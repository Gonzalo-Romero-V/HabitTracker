"""GenericExtractor — fallback inspector + scaffolder acumulativo.

Diseño (decidido en Fase 0):
    1. Detecta el stack por signal files (heurística simple, sin LLM).
    2. Corre extracción genérica baseline: file listing por layer heurístico,
       env vars universales, import graph regex multi-lenguaje.
    3. Si el stack detectado NO está en el REGISTRY ni en bootstrap/stacks/:
         - Genera `bootstrap/stacks/_proposed_<stack>.json` con hierarchy_mapping
           inferido de convenciones del lenguaje.
         - Genera `scripts/lib/extractors/_proposed_<stack>.py` con un scaffold
           que hereda de ExtractorBase y delega al GenericExtractor como
           baseline + TODOs marcados.
       Avisa por stdout y en `facts.proposed_files`.
    4. Nunca auto-promueve. El humano revisa, edita, renombra (quita
       `_proposed_`), agrega a REGISTRY, y el catálogo crece.

El extractor SIEMPRE corre la extracción genérica — el scaffolding es un
side-effect informativo, no bloquea la generación de facts.json.
"""
from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

from .base import ExtractorBase


# ──────────────────────────────────────────────────────────────────────────────
# Signal files → stack identifier
# Cada entrada es: nombre del archivo signal (relative al repo root) y un
# pattern opcional que debe matchear dentro del archivo para confirmar el stack.
# El primer match en este orden gana.
# ──────────────────────────────────────────────────────────────────────────────

_STACK_SIGNALS: list[tuple[str, str, str | None]] = [
    # (stack_id, signal_file, content_pattern)
    ("nextjs-laravel", "Frontend/package.json", r'"next"\s*:'),
    ("nextjs-only", "package.json", r'"next"\s*:'),
    ("python-fastapi", "pyproject.toml", r"fastapi"),
    ("python-fastapi", "requirements.txt", r"^fastapi\b"),
    ("python-django", "manage.py", r"django"),
    ("angular", "angular.json", None),
    ("java-spring", "pom.xml", r"spring-boot"),
    ("java-spring", "build.gradle", r"spring-boot"),
    ("java-spring", "build.gradle.kts", r"spring-boot"),
    ("go-generic", "go.mod", None),
    ("rust-generic", "Cargo.toml", None),
    ("ruby-rails", "Gemfile", r"rails"),
    ("ruby-generic", "Gemfile", None),
]


# Stacks ya cubiertos por archetypes en bootstrap/stacks/ o por extractores
# en el REGISTRY. Si la detección cae en uno de estos, NO se genera scaffold.
# NOTE: `python-django` no tiene archetype propio pero el extractor
# `python-generic` ya cubre Django (ver _detect_django en python_generic.py).
# Por eso entra a _KNOWN_STACKS aunque no haya bootstrap/stacks/python-django.json.
_KNOWN_STACKS: frozenset[str] = frozenset({
    "nextjs-laravel",
    "nextjs-only",
    "python-fastapi",
    "python-django",
    "generic",
})


# Convenciones de layer por lenguaje detectado — se usa para inferir
# hierarchy_mapping en el scaffold _proposed_<stack>.json.
_LANG_LAYER_CONVENTIONS: dict[str, dict[str, list[str]]] = {
    "angular": {
        "H4_contracts": [
            "src/app/**/*.module.ts",
            "src/app/**/*.service.ts",
            "src/app/models/**",
            "src/app/types/**",
        ],
        "H5_implementation": [
            "src/app/**/*.component.ts",
            "src/app/**/*.component.html",
            "src/app/pages/**",
            "src/app/**/*.directive.ts",
        ],
    },
    "java-spring": {
        "H4_contracts": [
            "src/main/java/**/entity/**",
            "src/main/java/**/model/**",
            "src/main/java/**/repository/**",
            "src/main/java/**/dto/**",
            "src/main/resources/db/migration/**",
        ],
        "H5_implementation": [
            "src/main/java/**/controller/**",
            "src/main/java/**/service/**",
            "src/main/java/**/Application.java",
        ],
    },
    "go-generic": {
        "H4_contracts": [
            "internal/**/types/**",
            "internal/**/models/**",
            "pkg/**/types.go",
            "**/*.proto",
            "migrations/**",
        ],
        "H5_implementation": [
            "cmd/**",
            "internal/**/handler/**",
            "internal/**/service/**",
            "internal/**/server/**",
        ],
    },
    "rust-generic": {
        "H4_contracts": [
            "src/models/**",
            "src/schema.rs",
            "src/types/**",
            "migrations/**",
        ],
        "H5_implementation": [
            "src/main.rs",
            "src/lib.rs",
            "src/handlers/**",
            "src/routes/**",
            "src/services/**",
        ],
    },
    "ruby-rails": {
        "H4_contracts": [
            "app/models/**",
            "db/migrate/**",
            "config/routes.rb",
        ],
        "H5_implementation": [
            "app/controllers/**",
            "app/services/**",
            "app/jobs/**",
            "app/mailers/**",
        ],
    },
    "ruby-generic": {
        "H4_contracts": ["lib/**/types/**", "lib/**/models/**"],
        "H5_implementation": ["lib/**", "bin/**"],
    },
}


# ──────────────────────────────────────────────────────────────────────────────
# Extractor
# ──────────────────────────────────────────────────────────────────────────────

class GenericExtractor(ExtractorBase):

    def name(self) -> str:
        return "generic"

    # ── Detección de stack ────────────────────────────────────────────────

    def _detect_stack(self) -> str | None:
        """Devuelve el stack_id detectado o None."""
        for stack_id, signal_file, pattern in _STACK_SIGNALS:
            p = self.repo_path / signal_file
            if not p.exists():
                continue
            if pattern is None:
                return stack_id
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            if re.search(pattern, text, re.MULTILINE | re.IGNORECASE):
                return stack_id
        return None

    # ── Scaffolding _proposed_ ────────────────────────────────────────────

    def _proposed_paths(self, stack_id: str) -> tuple[Path, Path]:
        """Resuelve los paths de los scaffolds para este stack.

        Asume que el extractor corre desde dentro del repo del usuario,
        donde existen `bootstrap/stacks/` y `scripts/lib/extractors/`
        (ambas heredadas del template).
        """
        slug = stack_id.replace("-", "_")
        cfg_path = self.repo_path / "bootstrap" / "stacks" / f"_proposed_{stack_id}.json"
        py_path = self.repo_path / "scripts" / "lib" / "extractors" / f"_proposed_{slug}.py"
        return cfg_path, py_path

    def _write_proposed_config(self, stack_id: str, dst: Path) -> None:
        conventions = _LANG_LAYER_CONVENTIONS.get(stack_id, {
            "H4_contracts": ["src/**/models/**", "src/**/types/**"],
            "H5_implementation": ["src/**", "app/**"],
        })
        proposed = {
            "_doc": f"AUTO-PROPOSED por GenericExtractor (stack detectado: {stack_id}).",
            "_doc_status": "draft — revisar, editar, renombrar (quitar _proposed_) y agregar a REGISTRY.",
            "schema_version": "1.0",
            "project_name": "__PROJECT_NAME__",
            "vault_path": "__VAULT_ABSOLUTE_PATH__",
            "extractor": "generic",
            "hierarchy_mapping": {
                "H1_intent": ["vault/intent/**"],
                "H2_requirements": ["vault/domain/**", "vault/raw/**"],
                "H3_architecture": ["vault/decisions/**"],
                **conventions,
                "ENV_references": [".env", ".env.example", ".env.local"],
            },
            "exclude_patterns": [
                "**/node_modules/**", "**/vendor/**", "**/__pycache__/**",
                "**/target/**", "**/build/**", "**/dist/**", "**/.gradle/**",
                "**/*.lock", "**/*.log", "**/graphify-out/**",
            ],
            "env_scan_scope": ["src/**", "app/**", "lib/**", "internal/**"],
            "vault_protected_status": ["locked"],
            "report_size_limits": {
                "max_files": 100,
                "max_diff_chars_per_file": 500,
                "split_threshold_files": 30,
            },
        }
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(
            json.dumps(proposed, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def _write_proposed_extractor(self, stack_id: str, dst: Path) -> None:
        slug = stack_id.replace("-", "_")
        class_name = "".join(part.capitalize() for part in slug.split("_")) + "Extractor"
        body = f'''"""Auto-proposed extractor for stack '{stack_id}'.

Este archivo fue generado por GenericExtractor al detectar el stack '{stack_id}'
sin archetype/extractor registrado.

Para promover este scaffold al catálogo:

    1. Implementar los TODOs de `extract()` con parsers específicos del stack.
       Mirar `scripts/lib/extractors/nextjs_laravel.py` como referencia de
       calidad y `python_generic.py` para inspiración multi-archivo.
    2. Renombrar el archivo quitando el prefijo `_proposed_`:
         _proposed_{slug}.py  →  {slug}.py
    3. Importar la clase y registrarla en `scripts/lib/extractors/__init__.py`:
         from .{slug} import {class_name}
         REGISTRY["{stack_id}"] = {class_name}
    4. Crear el archetype `bootstrap/stacks/{stack_id}.json` (ya hay un
       _proposed_*.json hermano que puedes renombrar).
    5. Verificar que `python scripts/vault_sync.py facts` produce un
       facts.json coherente cuando este extractor está activo.

Mientras tanto, este scaffold delega al GenericExtractor para que
`facts.json` siga generándose sin interrumpir el flujo.
"""
from __future__ import annotations

from .base import ExtractorBase
from .generic import GenericExtractor


class {class_name}(ExtractorBase):

    def name(self) -> str:
        return "{stack_id}"

    def extract(self) -> dict:
        # TODO: implementar parsers específicos del stack {stack_id}.
        # Por ahora, baseline genérico para que el sistema funcione.
        baseline = GenericExtractor(self.repo_path, self.config).extract()
        baseline["extractor"] = self.name()
        baseline["_scaffold_status"] = "proposed — TODOs pendientes"
        return baseline
'''
        dst.parent.mkdir(parents=True, exist_ok=True)
        dst.write_text(body, encoding="utf-8")

    def _maybe_scaffold(self, stack_id: str | None) -> list[str]:
        """Si el stack detectado no está registrado, escribe los scaffolds.
        Devuelve la lista de paths generados (relativos al repo)."""
        if stack_id is None or stack_id in _KNOWN_STACKS:
            return []

        cfg_path, py_path = self._proposed_paths(stack_id)
        written: list[str] = []

        # Solo escribimos si no existen (idempotente).
        if not cfg_path.exists():
            self._write_proposed_config(stack_id, cfg_path)
            written.append(cfg_path.relative_to(self.repo_path).as_posix())
        if not py_path.exists():
            self._write_proposed_extractor(stack_id, py_path)
            written.append(py_path.relative_to(self.repo_path).as_posix())

        return written

    # ── Baseline extraction genérica ──────────────────────────────────────

    _SKIP_DIRS = frozenset({
        "node_modules", "vendor", ".git", ".next", "__pycache__",
        ".venv", "venv", "target", "build", "dist", ".gradle",
        ".pytest_cache", ".mypy_cache", "site-packages", "graphify-out",
    })

    _CODE_EXTENSIONS = frozenset({
        ".py", ".ts", ".tsx", ".js", ".jsx", ".mjs",
        ".go", ".rs", ".java", ".kt", ".rb",
        ".php", ".cs", ".swift", ".scala",
    })

    # Import regexes por lenguaje — usadas todas en el mismo archivo si aplica.
    _IMPORT_REGEXES: list[tuple[re.Pattern, frozenset[str]]] = [
        # JS/TS
        (re.compile(r"""(?:^|\n)\s*import\s+(?:[^"';\n]+?\s+from\s+)?["']([^"']+)["']""",
                    re.MULTILINE),
         frozenset({".ts", ".tsx", ".js", ".jsx", ".mjs"})),
        # Python
        (re.compile(r"""^\s*(?:from\s+([\w.]+)\s+import\s+|import\s+([\w.]+))""",
                    re.MULTILINE),
         frozenset({".py"})),
        # Go
        (re.compile(r'^import\s+"([^"]+)"|"([^"]+)"', re.MULTILINE),
         frozenset({".go"})),
        # Rust
        (re.compile(r"^\s*use\s+([\w:]+)", re.MULTILINE),
         frozenset({".rs"})),
        # Java / Kotlin
        (re.compile(r"^\s*import\s+([\w.]+);?", re.MULTILINE),
         frozenset({".java", ".kt", ".scala"})),
    ]

    def _extract_imports(self, file_path: Path) -> dict:
        suffix = file_path.suffix.lower()
        try:
            text = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            return {"external": [], "internal_alias": [], "relative": []}

        external: list[str] = []
        relative: list[str] = []
        internal: list[str] = []

        for pattern, exts in self._IMPORT_REGEXES:
            if suffix not in exts:
                continue
            for match in pattern.finditer(text):
                spec = next((g for g in match.groups() if g), "")
                if not spec:
                    continue
                if spec.startswith(".") and (suffix in {".ts", ".tsx", ".js", ".jsx", ".mjs"}
                                              or suffix == ".py"):
                    relative.append(spec)
                elif spec.startswith("@/"):
                    internal.append(spec)
                else:
                    external.append(spec)

        return {
            "external": sorted(set(external)),
            "internal_alias": sorted(set(internal)),
            "relative": sorted(set(relative)),
        }

    def _build_import_graph(self) -> dict:
        graph: dict[str, dict] = {}
        for p in self.repo_path.rglob("*"):
            if not p.is_file():
                continue
            if any(seg in self._SKIP_DIRS for seg in p.parts):
                continue
            if p.suffix.lower() not in self._CODE_EXTENSIONS:
                continue
            rel = p.relative_to(self.repo_path).as_posix()
            imports = self._extract_imports(p)
            # Solo guardar archivos que tuvieron al menos un import
            # (mantener el grafo manejable en repos grandes).
            if any(imports.values()):
                graph[rel] = imports
        return graph

    # Env vars universales — JS/TS, Python, PHP, Go, Java/Spring.
    _ENV_PATTERNS = [
        re.compile(r"process\.env\.([A-Z][A-Z0-9_]*)"),
        re.compile(r"process\.env\[\s*['\"]([A-Z][A-Z0-9_]*)['\"]\s*\]"),
        re.compile(r"os\.getenv\(\s*['\"]([A-Z][A-Z0-9_]*)['\"]"),
        re.compile(r"os\.environ(?:\.get)?\(?\s*\[?\s*['\"]([A-Z][A-Z0-9_]*)['\"]"),
        re.compile(r"env\(\s*['\"]([A-Z][A-Z0-9_]*)['\"]"),       # PHP / Laravel
        re.compile(r"os\.Getenv\(\s*\"([A-Z][A-Z0-9_]*)\""),       # Go
        re.compile(r"System\.getenv\(\s*\"([A-Z][A-Z0-9_]*)\""),   # Java
        re.compile(r"\$\{([A-Z][A-Z0-9_]*)\}"),                   # Spring config
    ]

    def _collect_env_references(self) -> dict:
        refs: dict[str, list[str]] = {}
        for p in self.repo_path.rglob("*"):
            if not p.is_file():
                continue
            if any(seg in self._SKIP_DIRS for seg in p.parts):
                continue
            if p.suffix.lower() not in self._CODE_EXTENSIONS:
                continue
            try:
                text = p.read_text(encoding="utf-8", errors="ignore")
            except Exception:
                continue
            rel = p.relative_to(self.repo_path).as_posix()
            for pattern in self._ENV_PATTERNS:
                for var in pattern.findall(text):
                    refs.setdefault(var, []).append(rel)
        return {k: sorted(set(v)) for k, v in refs.items()}

    def _collect_layers(self) -> dict:
        """Heurística cross-language para layers H4 (contratos) y H5 (impl).

        Usa nombres de carpetas como pista — funciona razonable en proyectos
        que respetan convenciones (esos son la mayoría de los modernos).
        """
        h4_hints = ("model", "schema", "entit", "migration", "type", "dto", "proto")
        h5_hints = ("service", "controller", "handler", "endpoint", "route",
                    "view", "page", "component", "cmd", "worker")
        h4: set[str] = set()
        h5: set[str] = set()
        for p in self.repo_path.rglob("*"):
            if not p.is_file():
                continue
            if any(seg in self._SKIP_DIRS for seg in p.parts):
                continue
            if p.suffix.lower() not in self._CODE_EXTENSIONS:
                continue
            rel_lower = p.as_posix().lower()
            for hint in h4_hints:
                if f"/{hint}" in rel_lower:
                    h4.add(p.relative_to(self.repo_path).as_posix())
                    break
            for hint in h5_hints:
                if f"/{hint}" in rel_lower:
                    h5.add(p.relative_to(self.repo_path).as_posix())
                    break
        return {"H4": sorted(h4), "H5": sorted(h5)}

    # ── extract() ─────────────────────────────────────────────────────────

    def extract(self) -> dict:
        detected = self._detect_stack()
        proposed = self._maybe_scaffold(detected)

        facts: dict = {
            "extractor": self.name(),
            "extracted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "detected_stack": detected,
            "import_graph": self._build_import_graph(),
            "env_references": self._collect_env_references(),
            "layers": self._collect_layers(),
        }
        facts["import_graph_size"] = len(facts["import_graph"])

        if proposed:
            facts["proposed_files"] = proposed
            facts["_scaffold_message"] = (
                f"Stack '{detected}' detectado pero no registrado. "
                f"Scaffolds generados: {proposed}. "
                f"Revísalos, edita los TODOs, renombra (quita _proposed_), "
                f"agrega la clase a REGISTRY y el sistema lo incorpora al catálogo."
            )

        return facts
