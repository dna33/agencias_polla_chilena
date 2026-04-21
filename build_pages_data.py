from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from statistics import median

from app.grouped_sales import parse_weekly_zone_evolution
from app.weekly_sales import WeeklyAgencySale, parse_weekly_workbooks


DEFAULT_INPUT_DIR = Path("input")
DEFAULT_OUTPUT_PATH = Path("docs/data/dashboard.json")


def main() -> None:
    parser = argparse.ArgumentParser(description="Genera datos estaticos para GitHub Pages.")
    parser.add_argument("--input-dir", default=str(DEFAULT_INPUT_DIR), help="Carpeta con archivos .xlsx semanales.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT_PATH), help="Archivo JSON de salida.")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    paths = weekly_input_paths(input_dir)
    rows = parse_weekly_workbooks(paths)
    payload = build_dashboard_payload(rows, paths)
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Archivos procesados: {len(paths)}")
    print(f"Semanas: {payload['weeks']}")
    print(f"Agencias: {len(payload['agencies'])}")
    print(f"JSON: {output_path}")


def weekly_input_paths(input_dir: Path) -> list[Path]:
    paths: list[Path] = []
    for path in sorted(input_dir.glob("*.xlsx")):
        if path.name.startswith("~$"):
            continue
        if path.name.startswith("MaeGerCom"):
            continue
        paths.append(path)
    return paths


def build_dashboard_payload(rows: list[WeeklyAgencySale], paths: list[Path]) -> dict:
    weeks = sorted({row.week for row in rows})
    latest_week = weeks[-1] if weeks else None
    previous_week = weeks[-2] if len(weeks) > 1 else None
    latest_rows = [row for row in rows if row.week == latest_week]
    rows_by_lotos = group_by_lotos(rows)
    agency_payload = [
        agency_summary(lotos_code, agency_rows, latest_week, previous_week)
        for lotos_code, agency_rows in rows_by_lotos.items()
    ]
    agency_payload.sort(key=lambda item: item["latest_sales"], reverse=True)

    return {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "source_files": [str(path) for path in paths],
        "weeks": weeks,
        "latest_week": latest_week,
        "previous_week": previous_week,
        "summary": {
            "by_week": kpis_by_group(rows, "week"),
            "by_territory": kpis_by_group(latest_rows, "territory"),
            "by_executive": kpis_by_group(latest_rows, "executive"),
            "by_region": kpis_by_group(latest_rows, "region_number"),
            "by_rubro": kpis_by_group(latest_rows, "rubro"),
        },
        "weekly_zone_evolution": weekly_zone_evolution(paths),
        "priorities": priorities(agency_payload),
        "agencies": agency_payload,
    }


def weekly_zone_evolution(paths: list[Path]) -> list[dict]:
    for path in paths:
        rows = parse_weekly_zone_evolution(path)
        if rows:
            return [
                {
                    "zone": row.zone,
                    "week": row.week,
                    "week_label": row.week_label,
                    "sales": row.sales,
                    "communes": row.communes,
                }
                for row in rows
            ]
    return []


def group_by_lotos(rows: list[WeeklyAgencySale]) -> dict[str, list[WeeklyAgencySale]]:
    grouped: dict[str, list[WeeklyAgencySale]] = defaultdict(list)
    for row in rows:
        if row.lotos_code:
            grouped[row.lotos_code].append(row)
    return grouped


def agency_summary(
    lotos_code: str,
    rows: list[WeeklyAgencySale],
    latest_week: int | None,
    previous_week: int | None,
) -> dict:
    rows_by_week = {row.week: row for row in rows}
    latest = rows_by_week.get(latest_week) or sorted(rows, key=lambda row: row.week)[-1]
    previous = rows_by_week.get(previous_week) if previous_week else None
    history = [
        {
            "week": row.week,
            "sales": int(row.weekly_sales),
            "commercial_status": row.commercial_status,
            "sales_status": row.sales_status,
            "territory": row.territory,
            "executive": row.executive,
        }
        for row in sorted(rows, key=lambda row: row.week)
    ]
    latest_sales = int(latest.weekly_sales)
    previous_sales = int(previous.weekly_sales) if previous else 0
    delta = latest_sales - previous_sales
    pct_delta = delta / previous_sales if previous_sales else None
    average_sales_2019 = int(latest.average_sales_2019 or 0)
    gap_vs_2019 = latest_sales - average_sales_2019 if average_sales_2019 else None

    return {
        "lotos_code": lotos_code,
        "master_code": latest.master_code,
        "previous_lotos_code": latest.previous_lotos_code,
        "agent_name": latest.agent_name,
        "rut": latest.rut,
        "address": latest.address,
        "comuna": latest.comuna,
        "region_number": latest.region_number,
        "rubro": latest.rubro,
        "executive": latest.executive,
        "territory": latest.territory,
        "commercial_status": latest.commercial_status,
        "operational_status": latest.operational_status,
        "top_segment": latest.top_segment,
        "coverage": latest.coverage,
        "sales_status": latest.sales_status,
        "closed_date": latest.closed_date,
        "latitude": latest.latitude,
        "longitude": latest.longitude,
        "latest_week": latest_week,
        "latest_sales": latest_sales,
        "previous_week": previous_week,
        "previous_sales": previous_sales,
        "delta_sales": delta,
        "pct_delta": pct_delta,
        "average_sales_2019": average_sales_2019,
        "gap_vs_2019": gap_vs_2019,
        "is_selling": latest.is_selling,
        "is_closed": latest.is_closed,
        "history": history,
        "priority": classify_priority(latest, delta, previous_sales, gap_vs_2019),
    }


def classify_priority(
    latest: WeeklyAgencySale,
    delta: int,
    previous_sales: int,
    gap_vs_2019: int | None,
) -> str:
    if latest.is_closed:
        return "cerrada"
    if latest.weekly_sales == 0 and latest.commercial_status in {"Activo", "Dirección", "Traspaso"}:
        return "sin_venta"
    if previous_sales > 0 and delta <= -1_000_000:
        return "caida_fuerte"
    if gap_vs_2019 is not None and gap_vs_2019 <= -1_000_000:
        return "bajo_2019"
    if previous_sales == 0 and latest.weekly_sales > 0:
        return "recuperacion"
    return "seguimiento"


def kpis_by_group(rows: list[WeeklyAgencySale], attribute: str) -> list[dict]:
    grouped: dict[str, list[WeeklyAgencySale]] = defaultdict(list)
    for row in rows:
        value = getattr(row, attribute)
        key = str(value) if value not in (None, "") else "Sin dato"
        grouped[key].append(row)

    result = [group_kpi(key, group_rows) for key, group_rows in grouped.items()]
    if attribute == "week":
        return sorted(result, key=lambda item: int(item["name"]))
    return sorted(result, key=lambda item: item["sales"], reverse=True)


def group_kpi(name: str, rows: list[WeeklyAgencySale]) -> dict:
    sales_values = [row.weekly_sales for row in rows if row.weekly_sales > 0]
    sales = int(sum(row.weekly_sales for row in rows))
    selling = len(sales_values)
    active = len(rows)
    closed = sum(1 for row in rows if row.is_closed)
    return {
        "name": name,
        "agencies": active,
        "selling": selling,
        "selling_rate": selling / active if active else 0,
        "closed": closed,
        "sales": sales,
        "avg_selling_sales": int(sales / selling) if selling else 0,
        "median_selling_sales": int(median(sales_values)) if sales_values else 0,
    }


def priorities(agencies: list[dict]) -> dict:
    return {
        "biggest_drops": sorted(
            [agency for agency in agencies if agency["delta_sales"] < 0],
            key=lambda agency: agency["delta_sales"],
        )[:25],
        "recoveries": sorted(
            [agency for agency in agencies if agency["delta_sales"] > 0],
            key=lambda agency: agency["delta_sales"],
            reverse=True,
        )[:25],
        "zero_sales": sorted(
            [agency for agency in agencies if agency["priority"] == "sin_venta"],
            key=lambda agency: (agency["territory"] or "", agency["executive"] or "", agency["agent_name"] or ""),
        )[:100],
        "below_2019": sorted(
            [agency for agency in agencies if agency["gap_vs_2019"] is not None],
            key=lambda agency: agency["gap_vs_2019"],
        )[:50],
    }


if __name__ == "__main__":
    main()
