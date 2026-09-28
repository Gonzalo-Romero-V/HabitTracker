"""GraphifyAdapter — lee graphify-out/graph.json y lo traduce al schema de Code Vault.

Adaptador opcional para [Graphify](https://graphify.net/). Cuando el extractor
activo es `graphify`, el engine sustituye su parsing AST propio por la lectura
del grafo que produce Graphify localmente (Pass 1, tree-sitter, sin LLM, sin red).

Requiere que el usuario haya corrido previamente:

    pip install graphifyy
    graphify extract . --no-cluster

Decisiones de diseño (verificadas en Fase 0 contra docs oficiales y código):
    - CLI correcto para AST-only: `graphify extract <path> --no-cluster`
      (`--no-viz` NO existe; era un error del spec original.)
    - NetworkX node-link format: tolerar tanto la key "edges" como "links"
      (NetworkX 3.4+ cambió el default — ambas variantes están en uso).
    - Field names: snake_case — `file_type` (no `fileType`), `source_file`
      (no `sourceFile`). Se tolera defensivamente la variante camelCase.
    - file_type values: code | document | paper | image | rationale
    - Edge relations: calls | imports | implements | semantically_similar_to
    - confidence: EXTRACTED | INFERRED | AMBIGUOUS
    - Hyperedges (3+ nodes) viven en graph["hyperedges"] — se preservan en metadata.

Falla LOUD si:
    - graphify-out/graph.json no existe → mensaje con comando exacto a correr.
    - El JSON está corrupto.
    - El schema es incompatible (ni "edges" ni "links" presentes).
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from .base import ExtractorBase


# Valores aceptados — si Graphify agrega más en el futuro, el adaptador
# los pasa de largo (no rompe) pero no los clasifica como import/call.
_RELATION_IMPORT = "imports"
_RELATION_CALL = "calls"
_CONFIDENCE_EXTRACTED = "EXTRACTED"


class GraphifyAdapter(ExtractorBase):

    def name(self) -> str:
        return "graphify"

    # ── Helpers para tolerancia de schema ─────────────────────────────────

    @staticmethod
    def _get(node_or_edge: dict, *keys: str, default=None):
        """Devuelve el primer key existente. Soporta snake_case vs camelCase."""
        for k in keys:
            if k in node_or_edge:
                return node_or_edge[k]
        return default

    @staticmethod
    def _edges_of(graph: dict) -> list[dict]:
        """Tolera 'edges' (NetworkX 3.4+) o 'links' (NetworkX <3.4)."""
        if "edges" in graph:
            return graph["edges"]
        if "links" in graph:
            return graph["links"]
        raise ValueError(
            "graph.json no contiene ni 'edges' ni 'links' al nivel raíz.\n"
            "  Schema incompatible. Versión de Graphify soportada: produce\n"
            "  NetworkX node-link format. Reportar este graph.json upstream."
        )

    # ── Construcción de los campos del schema mínimo ──────────────────────

    def _build_import_graph(self, edges: list[dict]) -> dict:
        """Edges con relation='imports' → {file: {external, internal_alias, relative}}."""
        result: dict[str, dict[str, list[str]]] = {}
        for edge in edges:
            if self._get(edge, "relation") != _RELATION_IMPORT:
                continue
            src = self._get(edge, "source", default="")
            tgt = self._get(edge, "target", default="")
            if not src or not tgt:
                continue
            bucket = result.setdefault(
                src, {"external": [], "internal_alias": [], "relative": []}
            )
            # Heurística de clasificación (idéntica al criterio nextjs-laravel):
            if tgt.startswith("."):
                bucket["relative"].append(tgt)
            elif tgt.startswith("@/"):
                bucket["internal_alias"].append(tgt)
            else:
                bucket["external"].append(tgt)

        # Deduplicación + orden estable.
        for src, bucket in result.items():
            for k in bucket:
                bucket[k] = sorted(set(bucket[k]))
        return result

    def _build_call_graph(self, edges: list[dict]) -> dict:
        """Campo extra que solo Graphify provee. Solo confianza EXTRACTED."""
        calls: dict[str, list[str]] = {}
        for edge in edges:
            if self._get(edge, "relation") != _RELATION_CALL:
                continue
            if self._get(edge, "confidence") != _CONFIDENCE_EXTRACTED:
                continue
            src = self._get(edge, "source", default="")
            tgt = self._get(edge, "target", default="")
            if not src or not tgt:
                continue
            calls.setdefault(src, []).append(tgt)
        return {k: sorted(set(v)) for k, v in calls.items()}

    def _classify_layers(self, nodes: list[dict]) -> dict:
        """Clasificación heurística H4/H5 desde nodes."""
        h4: set[str] = set()
        h5: set[str] = set()
        for node in nodes:
            ft = self._get(node, "file_type", "fileType", default="")
            sf = self._get(node, "source_file", "sourceFile", default="")
            if not sf:
                continue
            # Heurística H4 — contratos: schemas, models, types, migrations.
            sf_lower = sf.lower()
            if (
                ft in {"class", "interface", "schema"}
                or any(seg in sf_lower for seg in (
                    "/model", "/schema", "/entit", "/migration", "/type"
                ))
            ):
                h4.add(sf)
                continue
            # Heurística H5 — implementación: services, controllers, handlers.
            if (
                ft in {"function", "method"}
                or any(seg in sf_lower for seg in (
                    "/service", "/controller", "/handler", "/endpoint", "/route", "/view"
                ))
            ):
                h5.add(sf)
        return {"H4": sorted(h4), "H5": sorted(h5)}

    def _extract_env_refs(self, nodes: list[dict]) -> dict:
        """Extrae variables de entorno mencionadas en nodos rationale."""
        refs: dict[str, list[str]] = {}
        for node in nodes:
            ft = self._get(node, "file_type", "fileType", default="")
            if ft != "rationale":
                continue
            label = self._get(node, "label", default="")
            sf = self._get(node, "source_file", "sourceFile", default="unknown")
            if "process.env" in label or "os.environ" in label or "os.getenv" in label:
                # Extraer el identificador final (heurística simple).
                # Ej: "process.env.DATABASE_URL" → "DATABASE_URL"
                # Ej: "os.getenv('PORT')" → "PORT"
                import re
                for m in re.finditer(r"['\"]?([A-Z][A-Z0-9_]+)['\"]?", label):
                    refs.setdefault(m.group(1), []).append(sf)
        return {k: sorted(set(v)) for k, v in refs.items()}

    # ── extract() ─────────────────────────────────────────────────────────

    def extract(self) -> dict:
        graph_path = self.repo_path / "graphify-out" / "graph.json"

        if not graph_path.exists():
            raise FileNotFoundError(
                f"graphify-out/graph.json no encontrado en {self.repo_path}.\n\n"
                f"  Ejecuta primero:\n"
                f"      pip install graphifyy\n"
                f"      graphify extract . --no-cluster\n\n"
                f"  La flag --no-cluster activa solo Pass 1 (AST tree-sitter,\n"
                f"  local, sin LLM, sin red). Pass 2 y Pass 3 quedan desactivados."
            )

        try:
            graph = json.loads(graph_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise ValueError(
                f"graphify-out/graph.json está corrupto: {e}\n"
                f"  Regenerar con: graphify extract . --no-cluster --force"
            ) from e

        nodes = graph.get("nodes", [])
        edges = self._edges_of(graph)  # falla loud si ni edges ni links

        facts: dict = {
            "extractor": self.name(),
            "extracted_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "graphify_metadata": graph.get("graph", graph.get("metadata", {})),
            "node_count": len(nodes),
            "edge_count": len(edges),
            "import_graph": self._build_import_graph(edges),
            "call_graph": self._build_call_graph(edges),  # campo extra (solo Graphify)
            "env_references": self._extract_env_refs(nodes),
            "layers": self._classify_layers(nodes),
        }
        facts["import_graph_size"] = len(facts["import_graph"])

        # Hyperedges (relaciones 3+ nodos) — preservadas en metadata si existen.
        hyperedges = graph.get("hyperedges") or graph.get("graph", {}).get("hyperedges")
        if hyperedges:
            facts["hyperedges_count"] = len(hyperedges)

        return facts
