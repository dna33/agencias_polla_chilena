from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


WEEKDAYS = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
]


@dataclass(slots=True)
class Agency:
    id: int | None = None
    lotos_code: str | None = None
    master_code: str | None = None
    raspe_code: str | None = None
    agent_name: str | None = None
    rut: str | None = None
    address: str | None = None
    comuna: str | None = None
    region_number: str | None = None
    rubro: str | None = None
    legal_representative: str | None = None
    phone_local: str | None = None
    phone_1: str | None = None
    phone_2: str | None = None
    email: str | None = None
    contact_name: str | None = None
    observation: str | None = None
    commercial_status: str | None = None
    agent_status: str | None = None
    status_change_date: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    raw_coordinates: str | None = None
    schedule_json: dict[str, list[dict[str, str]]] = field(default_factory=dict)
    schedule_raw_json: dict[str, dict[str, str | None]] = field(default_factory=dict)
    data_quality_errors: list[str] = field(default_factory=list)
    raw_row_hash: str | None = None
    is_active_for_search: bool = False
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True)
class SearchResult:
    agency: Agency
    distance_km: float
    is_open: bool
    closes_at: str | None = None
    next_open_at: str | None = None


@dataclass(slots=True)
class QueryLog:
    id: int | None = None
    created_at: datetime | None = None
    user_phone: str | None = None
    incoming_text: str | None = None
    had_location: bool = False
    user_latitude: float | None = None
    user_longitude: float | None = None
    recommended_agency_id: int | None = None
    alternative_agency_ids: list[int] = field(default_factory=list)
    response_time_ms: int | None = None
    error_message: str | None = None
    metadata_json: dict[str, Any] = field(default_factory=dict)
