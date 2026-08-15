"""Phase 6 TB3 — config-level trust boundary tests.

verify_token must be FAIL-CLOSED: blank config and the well-known default token
are rejected even on an exact string match; a real configured token is accepted
and compared in constant time.
"""
from __future__ import annotations

from app.config import KNOWN_DEFAULT_TOKEN, Settings


def test_real_token_accepted():
    s = Settings(internal_token="a-real-secret")
    assert s.verify_token("a-real-secret") is True


def test_missing_request_token_rejected():
    s = Settings(internal_token="a-real-secret")
    assert s.verify_token(None) is False


def test_wrong_request_token_rejected():
    s = Settings(internal_token="a-real-secret")
    assert s.verify_token("wrong") is False


def test_blank_config_rejects_everything():
    s = Settings(internal_token="")
    assert s.verify_token("") is False
    assert s.verify_token("anything") is False
    assert s.verify_token(None) is False


def test_known_default_config_rejects_even_exact_match():
    """TB3 headline: with the well-known default configured, a request that
    presents exactly that token is still refused."""
    s = Settings(internal_token=KNOWN_DEFAULT_TOKEN)
    assert s.verify_token(KNOWN_DEFAULT_TOKEN) is False
    assert s.verify_token("anything") is False


def test_known_default_never_constructed_implicitly(monkeypatch):
    """An unconfigured Settings must carry the known default, which is
    unusable, so a fresh server is closed by default. conftest sets the env,
    so simulate an unset SOLVER_INTERNAL_TOKEN here."""
    monkeypatch.delenv("SOLVER_INTERNAL_TOKEN", raising=False)
    s = Settings(_env_file=None)
    assert s.internal_token == KNOWN_DEFAULT_TOKEN
    assert s.verify_token(KNOWN_DEFAULT_TOKEN) is False