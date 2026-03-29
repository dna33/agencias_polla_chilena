from __future__ import annotations

import math


def parse_coordinates(value: str | None) -> tuple[float | None, float | None, list[str]]:
    if value is None or not str(value).strip():
        return None, None, ["missing_coordinates"]
    parts = [part.strip() for part in str(value).split(",")]
    if len(parts) != 2:
        return None, None, [f"invalid_coordinates:{value}"]
    try:
        latitude = float(parts[0])
        longitude = float(parts[1])
    except ValueError:
        return None, None, [f"invalid_coordinates:{value}"]
    if not (-90 <= latitude <= 90):
        return None, None, [f"invalid_latitude:{latitude}"]
    if not (-180 <= longitude <= 180):
        return None, None, [f"invalid_longitude:{longitude}"]
    return latitude, longitude, []


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    earth_radius_km = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lon / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return earth_radius_km * c


def build_google_maps_link(latitude: float, longitude: float) -> str:
    return f"https://www.google.com/maps/search/?api=1&query={latitude},{longitude}"
