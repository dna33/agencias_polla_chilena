from __future__ import annotations

import csv
import unicodedata
from collections import Counter
from functools import lru_cache
from pathlib import Path


CENSUS_PEOPLE_FILENAME = "personas_censo2024.csv"
COMMUNE_CODES_FILENAME = "codigos_comunas_bidat.csv"

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
    "AISEN": "11201",
    "AYSEN": "11201",
    "LLAY LLAY": "5703",
    "LLAY-LLAY": "5703",
    "MARCHIGUE": "6204",
    "TIL TIL": "13303",
    "TIL-TIL": "13303",
}


def population_by_commune(input_dir: str | Path, commune_names: set[str]) -> dict[str, int]:
    input_path = Path(input_dir)
    code_lookup = _commune_code_lookup(input_path)
    codes_by_commune = {
        commune: code_lookup.get(normalize_commune(commune))
        for commune in commune_names
    }
    target_codes = {code for code in codes_by_commune.values() if code}
    if not target_codes:
        return {}

    path = input_path / CENSUS_PEOPLE_FILENAME
    if not path.exists():
        return {}

    counts = _count_adults_by_code(path, target_codes)
    return {
        commune: counts.get(code, 0)
        for commune, code in codes_by_commune.items()
        if code
    }


def normalize_commune(value: str | None) -> str:
    text = unicodedata.normalize("NFD", str(value or ""))
    text = "".join(char for char in text if unicodedata.category(char) != "Mn")
    text = text.replace("-", " ")
    return " ".join(text.upper().strip().split())


def _commune_code_lookup(input_dir: Path) -> dict[str, str]:
    lookup = dict(COMMUNE_CODE_BY_NAME)
    path = _commune_codes_path(input_dir)
    if not path.exists():
        return lookup

    with path.open("r", encoding="utf-8-sig", newline="") as file:
        reader = csv.DictReader(file, delimiter=";")
        if not reader.fieldnames or "COMUNA_INE" not in reader.fieldnames or "N_COMUNA" not in reader.fieldnames:
            return lookup
        for row in reader:
            name = normalize_commune(row.get("N_COMUNA"))
            code = str(row.get("COMUNA_INE") or "").strip()
            if name and code:
                lookup[name] = code
    return lookup


def _commune_codes_path(input_dir: Path) -> Path:
    input_path = input_dir / COMMUNE_CODES_FILENAME
    if input_path.exists():
        return input_path
    return Path(__file__).resolve().parent / "resources" / COMMUNE_CODES_FILENAME


def _count_adults_by_code(path: Path, target_codes: set[str]) -> Counter[str]:
    counts = _adult_counts_by_code(path)
    return Counter({code: counts.get(code, 0) for code in target_codes})


@lru_cache(maxsize=4)
def _adult_counts_by_code(path: Path) -> Counter[str]:
    counts: Counter[str] = Counter()
    with path.open("r", encoding="utf-8", newline="") as file:
        reader = csv.reader(file, delimiter=";")
        header = next(reader, None)
        if not header or "comuna" not in header or "edad" not in header:
            return counts
        commune_index = header.index("comuna")
        age_index = header.index("edad")
        for row in reader:
            if len(row) <= max(commune_index, age_index):
                continue
            code = row[commune_index]
            age = _parse_age(row[age_index])
            if age is not None and age > 18:
                counts[code] += 1
    return counts


def _parse_age(value: str) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
