from __future__ import annotations

from dataclasses import dataclass

from app.repository import AgencyRepository


@dataclass(slots=True)
class ResolvedLocation:
    latitude: float
    longitude: float
    label: str
    strategy: str


class FallbackGeocoder:
    def __init__(self, repository: AgencyRepository | None = None) -> None:
        self.repository = repository or AgencyRepository()

    def resolve(self, query: str | None) -> ResolvedLocation | None:
        if not query:
            return None
        normalized_query = query.strip().lower()
        if not normalized_query:
            return None

        agencies = self.repository.list_searchable()
        comuna_match = self._resolve_by_comuna(agencies, normalized_query)
        if comuna_match:
            return comuna_match

        return self._resolve_by_address(agencies, normalized_query)

    def _resolve_by_address(self, agencies, query: str) -> ResolvedLocation | None:
        for agency in agencies:
            if not agency.address or agency.latitude is None or agency.longitude is None:
                continue
            address = agency.address.strip().lower()
            if query in address:
                return ResolvedLocation(
                    latitude=agency.latitude,
                    longitude=agency.longitude,
                    label=agency.address,
                    strategy="address",
                )
        return None

    def _resolve_by_comuna(self, agencies, query: str) -> ResolvedLocation | None:
        matches = [
            agency
            for agency in agencies
            if agency.comuna
            and agency.latitude is not None
            and agency.longitude is not None
            and agency.comuna.strip().lower() == query
        ]
        if not matches:
            return None

        latitude = sum(agency.latitude for agency in matches if agency.latitude is not None) / len(matches)
        longitude = sum(agency.longitude for agency in matches if agency.longitude is not None) / len(matches)
        return ResolvedLocation(
            latitude=latitude,
            longitude=longitude,
            label=matches[0].comuna or query,
            strategy="comuna",
        )
