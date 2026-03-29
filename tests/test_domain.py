from __future__ import annotations

from datetime import datetime

from app.geo import parse_coordinates
from app.importer import is_search_eligible
from app.matcher import AgencyMatcher
from app.models import Agency
from app.scheduler import is_agency_open, parse_schedule_block
from app.service import AgencySearchService


class FakeRepository:
    def __init__(self, agencies: list[Agency]) -> None:
        self._agencies = agencies

    def list_searchable(self) -> list[Agency]:
        return self._agencies


def make_agency(
    agency_id: int,
    latitude: float,
    longitude: float,
    schedule_json: dict,
    commercial_status: str = "Activo",
    agent_status: str = "Active",
    is_active_for_search: bool = True,
) -> Agency:
    return Agency(
        id=agency_id,
        agent_name=f"Agency {agency_id}",
        address="Address",
        comuna="Comuna",
        latitude=latitude,
        longitude=longitude,
        schedule_json=schedule_json,
        commercial_status=commercial_status,
        agent_status=agent_status,
        raw_row_hash=str(agency_id),
        is_active_for_search=is_active_for_search,
    )


def test_active_open_agency_found_correctly():
    open_agency = make_agency(
        1,
        -33.45,
        -70.66,
        {"monday": [{"open": "09:00", "close": "20:00"}], "tuesday": [], "wednesday": [], "thursday": [], "friday": [], "saturday": [], "sunday": []},
    )
    matcher = AgencyMatcher(FakeRepository([open_agency]))
    now = datetime(2025, 9, 1, 10, 0)
    results = matcher.find_nearest_open_agencies(-33.44, -70.65, now)
    assert results[0].agency.id == 1
    assert results[0].is_open is True


def test_open_agency_ranks_over_closed_one():
    closed = make_agency(
        1,
        -33.4401,
        -70.6501,
        {"monday": [{"open": "20:00", "close": "21:00"}], "tuesday": [], "wednesday": [], "thursday": [], "friday": [], "saturday": [], "sunday": []},
    )
    open_agency = make_agency(
        2,
        -33.45,
        -70.66,
        {"monday": [{"open": "09:00", "close": "20:00"}], "tuesday": [], "wednesday": [], "thursday": [], "friday": [], "saturday": [], "sunday": []},
    )
    matcher = AgencyMatcher(FakeRepository([closed, open_agency]))
    now = datetime(2025, 9, 1, 10, 0)
    results = matcher.find_nearest_open_agencies(-33.44, -70.65, now)
    assert results[0].agency.id == 2
    assert results[0].is_open is True


def test_returns_closed_when_no_open_agencies():
    closed_near = make_agency(
        1,
        -33.4401,
        -70.6501,
        {"monday": [{"open": "20:00", "close": "21:00"}], "tuesday": [], "wednesday": [], "thursday": [], "friday": [], "saturday": [], "sunday": []},
    )
    closed_far = make_agency(
        2,
        -33.45,
        -70.66,
        {"monday": [{"open": "20:00", "close": "21:00"}], "tuesday": [], "wednesday": [], "thursday": [], "friday": [], "saturday": [], "sunday": []},
    )
    matcher = AgencyMatcher(FakeRepository([closed_far, closed_near]))
    now = datetime(2025, 9, 1, 10, 0)
    results = matcher.find_nearest_open_agencies(-33.44, -70.65, now)
    assert results[0].agency.id == 1
    assert results[0].is_open is False


def test_parse_schedule_block_range():
    blocks, errors = parse_schedule_block("10:00 - 14:00")
    assert blocks == [{"open": "10:00", "close": "14:00"}]
    assert errors == []


def test_parse_schedule_block_closed():
    blocks, errors = parse_schedule_block("CERRADO")
    assert blocks == []
    assert errors == []


def test_parse_schedule_block_with_24_hour_close():
    blocks, errors = parse_schedule_block("18:00 - 24:00")
    assert blocks == [{"open": "18:00", "close": "24:00"}]
    assert errors == []


def test_parse_coordinates():
    latitude, longitude, errors = parse_coordinates("-18.477873645963168, -70.31901590319711")
    assert round(latitude, 4) == -18.4779
    assert round(longitude, 4) == -70.3190
    assert errors == []


def test_excludes_non_active_commercial_status():
    assert is_search_eligible(
        commercial_status="Baja",
        agent_status="Active",
        latitude=-33.45,
        longitude=-70.66,
        schedule_errors=[],
    ) is False


def test_excludes_non_active_agent_status():
    assert is_search_eligible(
        commercial_status="Activo",
        agent_status="Inactive",
        latitude=-33.45,
        longitude=-70.66,
        schedule_errors=[],
    ) is False


def test_google_maps_link_uses_address_query():
    service = AgencySearchService()
    agency = make_agency(
        1,
        -33.45,
        -70.66,
        {"monday": [{"open": "09:00", "close": "20:00"}], "tuesday": [], "wednesday": [], "thursday": [], "friday": [], "saturday": [], "sunday": []},
    )
    agency.address = "MAIPU 529"
    agency.comuna = "ARICA"
    payload = service.serialize_results([
        type("Result", (), {
            "agency": agency,
            "distance_km": 0.8,
            "is_open": True,
            "closes_at": "21:00",
            "next_open_at": None,
        })()
    ])
    assert "MAIPU+529%2C+ARICA" in payload[0]["google_maps_url"]
