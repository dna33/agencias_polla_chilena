from __future__ import annotations

import re
from datetime import datetime, time, timedelta

from app.models import WEEKDAYS

TIME_RANGE_PATTERN = re.compile(r"^\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*$")

DAY_COLUMN_MAP = {
    "monday": ("Lun. Mañ.", "Lun. Tar."),
    "tuesday": ("Mar. Mañ.", "Mar. Tar."),
    "wednesday": ("Mie. Mañ.", "Mie. Tar."),
    "thursday": ("Jue. Mañ", "Jue. Tar."),
    "friday": ("Vie. Mañ.", "Vie. Tar."),
    "saturday": ("Sab. Mañ.", "Sab. Tar."),
    "sunday": ("Dom. Mañ.", "Dom. Tar."),
}


def normalize_time_text(value: str | None) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def parse_schedule_block(value: str | None) -> tuple[list[dict[str, str]], list[str]]:
    text = normalize_time_text(value)
    if text is None:
        return [], []
    if text.upper() == "CERRADO":
        return [], []
    match = TIME_RANGE_PATTERN.match(text)
    if not match:
        return [], [f"invalid_schedule:{text}"]
    start, end = match.groups()
    return [{"open": _normalize_hour(start), "close": _normalize_hour(end)}], []


def build_schedule(row: dict[str, object]) -> tuple[dict[str, list[dict[str, str]]], dict[str, dict[str, str | None]], list[str]]:
    normalized: dict[str, list[dict[str, str]]] = {day: [] for day in WEEKDAYS}
    raw: dict[str, dict[str, str | None]] = {}
    errors: list[str] = []

    for day, columns in DAY_COLUMN_MAP.items():
        day_raw: dict[str, str | None] = {}
        for column in columns:
            raw_value = normalize_time_text(row.get(column))
            day_raw[column] = raw_value
            blocks, block_errors = parse_schedule_block(raw_value)
            normalized[day].extend(blocks)
            errors.extend(f"{day}:{error}" for error in block_errors)
        raw[day] = day_raw

    return normalized, raw, errors


def is_agency_open(schedule: dict[str, list[dict[str, str]]], now: datetime) -> dict[str, str | bool | None]:
    day_name = WEEKDAYS[now.weekday()]
    current_time = now.time()
    current_minutes = current_time.hour * 60 + current_time.minute
    today_blocks = schedule.get(day_name, [])

    for block in today_blocks:
        opens_at_minutes = parse_hour_to_minutes(block["open"])
        closes_at_minutes = parse_hour_to_minutes(block["close"])
        if opens_at_minutes <= current_minutes <= closes_at_minutes:
            return {
                "is_open": True,
                "closes_at": _normalize_hour(block["close"]),
                "next_open_at": None,
            }

    next_open_at = find_next_open_at(schedule, now)
    return {
        "is_open": False,
        "closes_at": None,
        "next_open_at": next_open_at,
    }


def find_next_open_at(schedule: dict[str, list[dict[str, str]]], now: datetime) -> str | None:
    current_minutes = now.hour * 60 + now.minute
    for day_offset in range(0, 8):
        candidate = now + timedelta(days=day_offset)
        day_name = WEEKDAYS[candidate.weekday()]
        blocks = schedule.get(day_name, [])
        if not blocks:
            continue
        for block in blocks:
            opens_at_minutes = parse_hour_to_minutes(block["open"])
            if day_offset > 0 or opens_at_minutes > current_minutes:
                return f"{candidate.strftime('%A')} {_normalize_hour(block['open'])}"
    return None


def parse_hour(value: str) -> time:
    if _normalize_hour(value) == "24:00":
        return time(23, 59)
    return datetime.strptime(_normalize_hour(value), "%H:%M").time()


def parse_hour_to_minutes(value: str) -> int:
    normalized = _normalize_hour(value)
    if normalized == "24:00":
        return 24 * 60
    parsed = datetime.strptime(normalized, "%H:%M").time()
    return parsed.hour * 60 + parsed.minute


def _normalize_hour(value: str) -> str:
    hour, minute = value.split(":")
    return f"{int(hour):02d}:{int(minute):02d}"
