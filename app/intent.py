from __future__ import annotations


INTENT_KEYWORDS = {
    "agencia",
    "tienda",
    "local",
    "abierta",
    "abierto",
    "cercana",
    "cercano",
    "cerca",
    "sucursal",
    "polla",
}


def wants_nearest_agency(text: str | None) -> bool:
    if not text:
        return False
    normalized = text.lower()
    return any(keyword in normalized for keyword in INTENT_KEYWORDS)
