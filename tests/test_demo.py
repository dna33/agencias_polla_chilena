from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_demo_page_loads():
    response = client.get("/demo")
    assert response.status_code == 200
    assert "Demo local" in response.text


def test_demo_message_endpoint_with_text():
    response = client.post("/demo/message", json={"text": "agencia más cercana"})
    assert response.status_code == 200
    assert "Compárteme tu ubicación" in response.json()["reply"]


def test_demo_message_endpoint_with_location_returns_results():
    response = client.post("/demo/message", json={"latitude": -18.4780, "longitude": -70.3190})
    assert response.status_code == 200
    payload = response.json()
    assert payload["mode"] == "location"
    assert len(payload["results"]) >= 1
    assert "agent_name" in payload["results"][0]
