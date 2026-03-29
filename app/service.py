from __future__ import annotations

from datetime import datetime

from app.config import settings
from app.geo import build_google_maps_link
from app.matcher import AgencyMatcher
from app.models import SearchResult


class AgencySearchService:
    def __init__(self, matcher: AgencyMatcher | None = None) -> None:
        self.matcher = matcher or AgencyMatcher()

    def find_and_format(self, latitude: float, longitude: float, now: datetime | None = None) -> tuple[str, list[SearchResult]]:
        reference_time = now or datetime.now(settings.timezone)
        results = self.matcher.find_nearest_open_agencies(latitude, longitude, reference_time)
        if not results:
            return "No encontré agencias aptas para búsqueda en este momento.", []

        top = results[0]
        if top.is_open:
            lead = (
                "La agencia abierta más cercana es:\n"
                f"Agencia: {top.agency.agent_name}\n"
                f"Dirección: {self._format_address(top)}\n"
                f"Abierta ahora hasta las {top.closes_at}\n"
                f"Distancia aproximada: {top.distance_km:.1f} km\n"
                f"Cómo llegar: {build_google_maps_link(top.agency.latitude, top.agency.longitude)}"
            )
        else:
            lead = (
                "No encontré agencias abiertas cerca ahora. Las más cercanas son:\n"
                f"1. {top.agency.agent_name} - {self._format_address(top)} - {self._closed_copy(top)} - {top.distance_km:.1f} km\n"
                f"Cómo llegar: {build_google_maps_link(top.agency.latitude, top.agency.longitude)}"
            )

        if len(results) == 1:
            return lead, results

        alternatives = []
        for index, item in enumerate(results[1:], start=2):
            status = (
                f"abierta hasta las {item.closes_at}"
                if item.is_open
                else self._closed_copy(item)
            )
            alternatives.append(
                f"{index}. {item.agency.agent_name} - {self._format_address(item)} - {status} - {item.distance_km:.1f} km"
            )

        return f"{lead}\n\nOtras cercanas:\n" + "\n".join(alternatives), results

    def serialize_results(self, results: list[SearchResult]) -> list[dict[str, object]]:
        serialized: list[dict[str, object]] = []
        for item in results:
            agency = item.agency
            serialized.append(
                {
                    "agency_id": agency.id,
                    "agent_name": agency.agent_name,
                    "address": self._format_address(item),
                    "distance_km": round(item.distance_km, 1),
                    "is_open": item.is_open,
                    "closes_at": item.closes_at,
                    "next_open_at": item.next_open_at,
                    "status_text": self.describe_status(item),
                    "latitude": agency.latitude,
                    "longitude": agency.longitude,
                    "google_maps_url": build_google_maps_link(agency.latitude, agency.longitude),
                    "comuna": agency.comuna,
                }
            )
        return serialized

    def describe_status(self, result: SearchResult) -> str:
        if result.is_open:
            return f"Abierta ahora hasta las {result.closes_at}"
        return self._closed_copy(result).capitalize()

    def _format_address(self, result: SearchResult) -> str:
        agency = result.agency
        parts = [agency.address, agency.comuna]
        return ", ".join(part for part in parts if part)

    def _closed_copy(self, result: SearchResult) -> str:
        if result.next_open_at:
            return f"cerrada ahora, abre {result.next_open_at}"
        return "cerrada ahora"
