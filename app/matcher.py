from __future__ import annotations

from datetime import datetime

from app.geo import haversine_km
from app.models import SearchResult
from app.repository import AgencyRepository
from app.scheduler import is_agency_open


class AgencyMatcher:
    def __init__(self, repository: AgencyRepository | None = None) -> None:
        self.repository = repository or AgencyRepository()

    def find_nearest_open_agencies(
        self,
        user_lat: float,
        user_lon: float,
        now: datetime,
        limit: int = 3,
    ) -> list[SearchResult]:
        agencies = self.repository.list_searchable()
        ranked: list[SearchResult] = []
        for agency in agencies:
            if agency.latitude is None or agency.longitude is None:
                continue
            opening = is_agency_open(agency.schedule_json, now)
            ranked.append(
                SearchResult(
                    agency=agency,
                    distance_km=haversine_km(user_lat, user_lon, agency.latitude, agency.longitude),
                    is_open=bool(opening["is_open"]),
                    closes_at=opening["closes_at"] if isinstance(opening["closes_at"], str) else None,
                    next_open_at=opening["next_open_at"] if isinstance(opening["next_open_at"], str) else None,
                )
            )

        open_results = sorted(
            [item for item in ranked if item.is_open],
            key=lambda item: item.distance_km,
        )
        if open_results:
            return open_results[:limit]

        closed_results = sorted(ranked, key=lambda item: item.distance_km)
        return closed_results[:limit]
