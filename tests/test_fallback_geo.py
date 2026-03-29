from __future__ import annotations

from app.fallback_geo import FallbackGeocoder
from app.models import Agency


class FakeRepository:
    def __init__(self, agencies: list[Agency]) -> None:
        self._agencies = agencies

    def list_searchable(self) -> list[Agency]:
        return self._agencies


def test_resolves_exact_comuna_to_centroid():
    geocoder = FallbackGeocoder(
        FakeRepository(
            [
                Agency(id=1, comuna="ARICA", latitude=-18.47, longitude=-70.31, schedule_json={}, raw_row_hash="1", is_active_for_search=True),
                Agency(id=2, comuna="ARICA", latitude=-18.49, longitude=-70.33, schedule_json={}, raw_row_hash="2", is_active_for_search=True),
            ]
        )
    )
    resolved = geocoder.resolve("ARICA")
    assert resolved is not None
    assert round(resolved.latitude, 2) == -18.48
    assert round(resolved.longitude, 2) == -70.32
    assert resolved.strategy == "comuna"


def test_resolves_address_substring():
    geocoder = FallbackGeocoder(
        FakeRepository(
            [
                Agency(id=1, address="21 DE MAYO 265", comuna="ARICA", latitude=-18.47, longitude=-70.31, schedule_json={}, raw_row_hash="1", is_active_for_search=True),
            ]
        )
    )
    resolved = geocoder.resolve("21 de mayo")
    assert resolved is not None
    assert resolved.latitude == -18.47
    assert resolved.strategy == "address"
