"""Service configuration.

Read from environment with the ``SOLVER_`` prefix (e.g. ``SOLVER_INTERNAL_TOKEN``).
Nothing here reads database credentials. The solver service never touches PostgreSQL.

Trust boundary (Phase 6 TB3): the service is FAIL-CLOSED. verify_token() rejects
every request when SOLVER_INTERNAL_TOKEN is unset (blank) or is still set to the
well-known default ``dev-internal-token``. A real, environment-configured secret
must be provided for any solver request to be accepted.
"""
from __future__ import annotations

import secrets

from pydantic_settings import BaseSettings, SettingsConfigDict

KNOWN_DEFAULT_TOKEN = "dev-internal-token"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SOLVER_", env_file=".env", extra="ignore")

    internal_token: str = KNOWN_DEFAULT_TOKEN
    default_time_limit_seconds: int = 60
    max_time_limit_seconds: int = 3600
    max_candidates: int = 10_000
    max_request_bytes: int = 16 * 1024 * 1024
    random_seed: int = 42
    num_search_workers: int = 8
    model: str = "structured"
    log_search_progress: bool = False

    def verify_token(self, token: str | None) -> bool:
        if not self.internal_token:
            return False
        if self.internal_token == KNOWN_DEFAULT_TOKEN:
            return False
        if token is None:
            return False
        return secrets.compare_digest(token, self.internal_token)


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings
