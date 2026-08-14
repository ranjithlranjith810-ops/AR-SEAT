import os

os.environ.setdefault("SOLVER_INTERNAL_TOKEN", "test-token")

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient

from app.config import get_settings
from app.main import app


@pytest.fixture()
def client():
    return TestClient(app)


@pytest.fixture()
def headers():
    return {"X-Internal-Token": "test-token"}


@pytest.fixture()
def settings():
    return get_settings()
