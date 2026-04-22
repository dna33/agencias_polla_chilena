from __future__ import annotations

import csv
import unicodedata
from collections import Counter
from pathlib import Path


CENSUS_PEOPLE_FILENAME = "personas_censo2024.csv"

COMMUNE_CODE_BY_NAME = {
    "ANTOFAGASTA": "2101",
    "CALAMA": "2201",
    "CONCEPCION": "8101",
    "COPIAPO": "3101",
    "COYHAIQUE": "11101",
    "CURICO": "7301",
    "HUECHURABA": "13107",
    "IQUIQUE": "1101",
    "LA CALERA": "5502",
    "LA CISTERNA": "13109",
    "LA FLORIDA": "13110",
    "LA SERENA": "4101",
    "LAS CONDES": "13114",
    "LINARES": "7401",
    "LOS ANGELES": "8301",
    "MAIPU": "13119",
    "MELIPILLA": "13501",
    "PENALOLEN": "13122",
    "PUENTE ALTO": "13201",
    "PUERTO MONTT": "10101",
    "PUNTA ARENAS": "12101",
    "QUILICURA": "13125",
    "QUILLOTA": "5501",
    "QUILPUE": "5801",
    "RANCAGUA": "6101",
    "RECOLETA": "13127",
    "SAN ANTONIO": "5601",
    "SANTIAGO": "13101",
    "TOCOPILLA": "2301",
    "VALDIVIA": "14101",
    "VALLENAR": "3301",
    "VALPARAISO": "5101",
    "VILLA ALEMANA": "5804",
    "VINA DEL MAR": "5109",
    "VITACURA": "13132",
}


def population_by_commune(input_dir: str | Path, commune_names: set[str]) -> dict[str, int]:
    codes_by_commune = {
        commune: COMMUNE_CODE_BY_NAME.get(normalize_commune(commune))
        for commune in commune_names
    }
    target_codes = {code for code in codes_by_commune.values() if code}
    if not target_codes:
        return {}

    path = Path(input_dir) / CENSUS_PEOPLE_FILENAME
    if not path.exists():
        return {}

    counts = _count_people_by_code(path, target_codes)
    return {
        commune: counts.get(code, 0)
        for commune, code in codes_by_commune.items()
        if code
    }


def normalize_commune(value: str | None) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    return " ".join(text.upper().strip().split())


def _count_people_by_code(path: Path, target_codes: set[str]) -> Counter[str]:
    counts: Counter[str] = Counter()
    with path.open("r", encoding="utf-8", newline="") as file:
        reader = csv.reader(file, delimiter=";")
        header = next(reader, None)
        if not header or "comuna" not in header:
            return counts
        commune_index = header.index("comuna")
        for row in reader:
            if len(row) <= commune_index:
                continue
            code = row[commune_index]
            if code in target_codes:
                counts[code] += 1
    return counts
