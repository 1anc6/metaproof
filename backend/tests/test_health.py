from fastapi.testclient import TestClient

from app.main import app

# No context manager: the lifespan (worker, database) is not needed for /health.
client = TestClient(app)


def test_health_answers_get():
    res = client.get("/api/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_health_answers_head_for_uptime_monitors():
    assert client.head("/api/health").status_code == 200
