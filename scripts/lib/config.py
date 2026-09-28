"""Load and validate vault_sync.config.json.

Preservado desde FarMedic. Cambio menor v1.0: el campo `extractor` ahora es
parte del schema (con fallback a "nextjs-laravel" para compatibilidad hacia
atrás con configs anteriores al plugin system).
"""
from __future__ import annotations
import json
from pathlib import Path
from dataclasses import dataclass


REQUIRED_KEYS = {
    "schema_version",
    "project_name",
    "vault_path",
    "hierarchy_mapping",
    "exclude_patterns",
    "vault_protected_status",
    "report_size_limits",
}


@dataclass
class Config:
    project_root: Path
    vault_path: Path
    project_name: str
    extractor: str
    hierarchy_mapping: dict
    exclude_patterns: list
    vault_protected_status: list
    max_files: int
    max_diff_chars_per_file: int
    split_threshold_files: int
    raw: dict


def load_config(project_root: Path) -> Config:
    cfg_path = project_root / "vault_sync.config.json"
    if not cfg_path.exists():
        raise FileNotFoundError(f"Missing config: {cfg_path}")

    raw = json.loads(cfg_path.read_text(encoding="utf-8"))
    missing = REQUIRED_KEYS - set(raw.keys())
    if missing:
        raise ValueError(f"Config missing keys: {sorted(missing)}")

    vault = Path(raw["vault_path"])
    if not vault.is_absolute():
        vault = project_root / vault
    if not vault.exists():
        raise FileNotFoundError(f"Vault path does not exist: {vault}")

    limits = raw["report_size_limits"]
    return Config(
        project_root=project_root,
        vault_path=vault,
        project_name=raw["project_name"],
        extractor=raw.get("extractor", "nextjs-laravel"),
        hierarchy_mapping=raw["hierarchy_mapping"],
        exclude_patterns=raw["exclude_patterns"],
        vault_protected_status=raw["vault_protected_status"],
        max_files=limits["max_files"],
        max_diff_chars_per_file=limits["max_diff_chars_per_file"],
        split_threshold_files=limits["split_threshold_files"],
        raw=raw,
    )
