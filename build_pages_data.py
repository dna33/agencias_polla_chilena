from __future__ import annotations

import argparse
import json
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path
from math import sqrt
from statistics import mean, median
import re

from app.census_population import population_by_commune
from app.grouped_sales import parse_weekly_zone_evolution
from app.jackpot_pdf import parse_jackpot_pdfs
from app.weekly_sales import WeeklyAgencySale, parse_weekly_workbooks


DEFAULT_INPUT_DIR = Path("input")
DEFAULT_OUTPUT_PATH = Path("docs/data/dashboard.json")
PDF_YEAR_RE = re.compile(r"Quick Report LOTO_(\d{4})_\d{2}_\d{2}\.pdf$", re.IGNORECASE)


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
    payload = build_dashboard_payload(rows, paths, input_dir)
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


def build_dashboard_payload(rows: list[WeeklyAgencySale], paths: list[Path], input_dir: Path | str = DEFAULT_INPUT_DIR) -> dict:
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
    time_series_summary = summarize_time_series(agency_payload, weeks)
    jackpots = jackpot_payload(input_dir)
    top50_population = top50_population_context(agency_payload, latest_week, input_dir)
    commune_market = commune_market_context(rows, weeks, latest_week, input_dir)

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
        "time_series_summary": time_series_summary,
        "weekly_sales_with_jackpots": weekly_sales_with_jackpots(rows, jackpots),
        "weekly_jackpots": jackpots,
        "top50_population_context": top50_population,
        "commune_market_context": commune_market,
        "weekly_zone_evolution": weekly_zone_evolution(paths, input_dir),
        "priorities": priorities(agency_payload),
        "agencies": agency_payload,
    }


def jackpot_payload(input_dir: Path | str) -> list[dict]:
    return [
        {
            "source_file": row.source_file,
            "week": row.week,
            "date": row.date,
            "loto_total_mm": row.loto_total_mm,
            "kino_total_mm": row.kino_total_mm,
            "total_mm": row.total_mm,
            "draws": row.draws,
            "extraction_note": row.extraction_note,
        }
        for row in parse_jackpot_pdfs(input_dir)
    ]


def weekly_sales_with_jackpots(rows: list[WeeklyAgencySale], jackpots: list[dict]) -> list[dict]:
    sales_by_week: dict[int, int] = defaultdict(int)
    for row in rows:
        sales_by_week[row.week] += int(row.weekly_sales)
    if sales_by_week:
        sales_weeks = set(sales_by_week)
        max_week = max(sales_weeks)
        future_weeks = sorted(row["week"] for row in jackpots if row["week"] > max_week)
        allowed_weeks = sales_weeks | ({future_weeks[0]} if future_weeks else set())
        jackpot_by_week = {row["week"]: row for row in jackpots if row["week"] in allowed_weeks}
    else:
        jackpot_by_week = {row["week"]: row for row in jackpots}
    weeks = sorted(set(sales_by_week) | set(jackpot_by_week))
    return [
        {
            "week": week,
            "sales": sales_by_week.get(week),
            "jackpot_total_mm": jackpot_by_week.get(week, {}).get("total_mm"),
            "loto_total_mm": jackpot_by_week.get(week, {}).get("loto_total_mm"),
            "kino_total_mm": jackpot_by_week.get(week, {}).get("kino_total_mm"),
            "jackpot_draws": len(jackpot_by_week.get(week, {}).get("draws", {})),
        }
        for week in weeks
    ]


def weekly_zone_evolution(paths: list[Path], input_dir: Path | str = DEFAULT_INPUT_DIR) -> list[dict]:
    for path in paths:
        rows = parse_weekly_zone_evolution(path)
        if rows:
            all_communes = {
                commune
                for row in rows
                for commune in row.commune_names
            }
            populations = population_by_commune(input_dir, all_communes)
            payload = []
            for row in rows:
                population_adult = sum(populations.get(commune, 0) for commune in row.commune_names)
                payload.append({
                    "zone": row.zone,
                    "week": row.week,
                    "week_label": row.week_label,
                    "sales": row.sales,
                    "communes": row.communes,
                    "population_adult": population_adult,
                    "missing_population_communes": [
                        commune for commune in row.commune_names if commune not in populations
                    ],
                    "sales_per_adult": row.sales / population_adult if population_adult else None,
                    "sales_per_100k_adults": row.sales / population_adult * 100_000 if population_adult else None,
                })
            return payload
    return []


def top50_population_context(agencies: list[dict], latest_week: int | None, input_dir: Path | str) -> dict:
    top50 = sorted(
        [agency for agency in agencies if agency.get("time_series", {}).get("avg_sales", 0) > 0],
        key=lambda agency: agency["time_series"]["avg_sales"],
        reverse=True,
    )[:50]
    commune_names = {agency.get("comuna") for agency in top50 if agency.get("comuna")}
    populations = population_by_commune(input_dir, commune_names)

    by_commune: dict[str, dict] = {}
    for agency in top50:
        commune = agency.get("comuna") or "Sin comuna"
        snapshot = next((point for point in agency.get("history", []) if point["week"] == latest_week), None)
        if commune not in by_commune:
            by_commune[commune] = {
                "commune": commune,
                "population": populations.get(commune),
                "agencies": 0,
                "latest_sales": 0,
                "avg_sales": 0,
                "territories": {},
                "agency_codes": [],
            }
        item = by_commune[commune]
        item["agencies"] += 1
        item["latest_sales"] += int(snapshot["sales"]) if snapshot else 0
        item["avg_sales"] += int(agency.get("time_series", {}).get("avg_sales", 0))
        territory = agency.get("territory") or "Sin territorio"
        item["territories"][territory] = item["territories"].get(territory, 0) + 1
        item["agency_codes"].append(agency["lotos_code"])

    rows = []
    for item in by_commune.values():
        population = item["population"] or 0
        rows.append({
            **item,
            "agencies_per_100k": item["agencies"] / population * 100_000 if population else None,
            "latest_sales_per_capita": item["latest_sales"] / population if population else None,
            "avg_sales_per_capita": item["avg_sales"] / population if population else None,
        })
    rows.sort(key=lambda item: item["agencies_per_100k"] or 0, reverse=True)

    covered_population = sum(item["population"] or 0 for item in rows)
    top50_latest_sales = sum(item["latest_sales"] for item in rows)
    top50_avg_sales = sum(item["avg_sales"] for item in rows)
    return {
        "source_file": "personas_censo2024.csv",
        "population_basis": "Personas mayores de 18 años",
        "top_agencies": len(top50),
        "communes": len(rows),
        "covered_population": covered_population,
        "latest_sales": top50_latest_sales,
        "avg_sales": top50_avg_sales,
        "latest_sales_per_capita": top50_latest_sales / covered_population if covered_population else None,
        "avg_sales_per_capita": top50_avg_sales / covered_population if covered_population else None,
        "rows": rows,
    }


def commune_market_context(
    rows: list[WeeklyAgencySale],
    weeks: list[int],
    latest_week: int | None,
    input_dir: Path | str,
) -> dict:
    commune_names = {row.comuna for row in rows if row.comuna}
    populations = population_by_commune(input_dir, commune_names)
    calendar_year = infer_sales_calendar_year(input_dir)
    month_meta = month_reference(weeks, calendar_year)
    if not month_meta:
        return {
            "source_file": "personas_censo2024.csv",
            "population_basis": "Personas mayores de 18 años",
            "calendar_year": calendar_year,
            "latest_week": latest_week,
            "months": [],
            "rows": [],
        }

    month_by_week = {
        week: item
        for item in month_meta
        for week in item["weeks"]
    }
    commune_week_sales: dict[tuple[str, int], int] = defaultdict(int)
    monthly_agencies: dict[tuple[str, str], set[str]] = defaultdict(set)
    agencies_by_commune: dict[str, set[str]] = defaultdict(set)
    latest_sales_by_commune: dict[str, int] = defaultdict(int)

    for row in rows:
        if not row.comuna or row.week not in month_by_week:
            continue
        population = populations.get(row.comuna)
        if not population:
            continue
        month_key = month_by_week[row.week]["month"]
        commune_week_sales[(row.comuna, row.week)] += int(row.weekly_sales)
        if row.lotos_code:
            monthly_agencies[(row.comuna, month_key)].add(row.lotos_code)
            agencies_by_commune[row.comuna].add(row.lotos_code)
        if latest_week is not None and row.week == latest_week:
            latest_sales_by_commune[row.comuna] += int(row.weekly_sales)

    monthly_sales: dict[tuple[str, str], list[int]] = defaultdict(list)
    for (commune, week), sales in commune_week_sales.items():
        month_key = month_by_week[week]["month"]
        monthly_sales[(commune, month_key)].append(sales)

    if not monthly_sales:
        return {
            "source_file": "personas_censo2024.csv",
            "population_basis": "Personas mayores de 18 años",
            "calendar_year": calendar_year,
            "latest_week": latest_week,
            "months": month_meta,
            "rows": [],
        }

    available_months = []
    for item in month_meta:
        month_key = item["month"]
        month_communes = [commune for commune in populations if (commune, month_key) in monthly_sales]
        covered_population = sum(populations.get(commune, 0) for commune in month_communes)
        avg_sales_total = sum(round(mean(monthly_sales[(commune, month_key)])) for commune in month_communes)
        available_months.append({
            **item,
            "communes": len(month_communes),
            "covered_population": covered_population,
            "avg_sales": avg_sales_total,
            "avg_sales_per_adult": avg_sales_total / covered_population if covered_population else None,
            "avg_sales_per_100k_adults": avg_sales_total / covered_population * 100_000 if covered_population else None,
        })

    commune_rows = []
    for commune in sorted(agencies_by_commune):
        population = populations.get(commune)
        if not population:
            continue
        monthly_series = []
        for item in available_months:
            month_key = item["month"]
            values = monthly_sales.get((commune, month_key))
            if not values:
                continue
            avg_sales = round(mean(values))
            total_sales = sum(values)
            monthly_series.append({
                "month": month_key,
                "label": item["label"],
                "weeks": item["weeks"],
                "weeks_count": len(values),
                "avg_sales": avg_sales,
                "total_sales": total_sales,
                "agencies": len(monthly_agencies.get((commune, month_key), set())),
                "avg_sales_per_adult": avg_sales / population if population else None,
                "avg_sales_per_100k_adults": avg_sales / population * 100_000 if population else None,
                "benchmark_avg_sales_per_100k_adults": item["avg_sales_per_100k_adults"],
            })
        if not monthly_series:
            continue
        overall_avg_sales = round(mean(point["avg_sales"] for point in monthly_series))
        overall_avg_per_adult = overall_avg_sales / population if population else None
        overall_avg_per_100k = overall_avg_sales / population * 100_000 if population else None
        latest_month = monthly_series[-1]
        delta_vs_benchmark = None
        if (
            latest_month["avg_sales_per_100k_adults"] is not None
            and latest_month["benchmark_avg_sales_per_100k_adults"] is not None
        ):
            delta_vs_benchmark = (
                latest_month["avg_sales_per_100k_adults"] - latest_month["benchmark_avg_sales_per_100k_adults"]
            )
        commune_rows.append({
            "commune": commune,
            "population": population,
            "agencies": len(agencies_by_commune.get(commune, set())),
            "latest_sales": latest_sales_by_commune.get(commune, 0),
            "latest_month": latest_month["month"],
            "latest_month_label": latest_month["label"],
            "latest_month_avg_sales": latest_month["avg_sales"],
            "latest_month_avg_sales_per_adult": latest_month["avg_sales_per_adult"],
            "latest_month_avg_sales_per_100k_adults": latest_month["avg_sales_per_100k_adults"],
            "overall_avg_sales": overall_avg_sales,
            "overall_avg_sales_per_adult": overall_avg_per_adult,
            "overall_avg_sales_per_100k_adults": overall_avg_per_100k,
            "gap_vs_latest_month_benchmark_per_100k": delta_vs_benchmark,
            "months_observed": len(monthly_series),
            "monthly_series": monthly_series,
        })

    commune_rows.sort(
        key=lambda item: (
            item["overall_avg_sales_per_100k_adults"] if item["overall_avg_sales_per_100k_adults"] is not None else float("inf"),
            item["overall_avg_sales"],
        )
    )
    covered_population = sum(item["population"] for item in commune_rows)
    overall_avg_sales_total = sum(item["overall_avg_sales"] for item in commune_rows)
    below_latest_benchmark = [
        item for item in commune_rows
        if (
            item["gap_vs_latest_month_benchmark_per_100k"] is not None
            and item["gap_vs_latest_month_benchmark_per_100k"] < 0
        )
    ]
    return {
        "source_file": "personas_censo2024.csv",
        "population_basis": "Personas mayores de 18 años",
        "calendar_year": calendar_year,
        "latest_week": latest_week,
        "months": available_months,
        "communes": len(commune_rows),
        "covered_population": covered_population,
        "overall_avg_sales": overall_avg_sales_total,
        "overall_avg_sales_per_adult": overall_avg_sales_total / covered_population if covered_population else None,
        "overall_avg_sales_per_100k_adults": overall_avg_sales_total / covered_population * 100_000 if covered_population else None,
        "below_latest_benchmark_communes": len(below_latest_benchmark),
        "rows": commune_rows,
        "method_note": "Mes inferido desde la semana ISO disponible, usando el lunes de cada semana como referencia temporal.",
    }


def infer_sales_calendar_year(input_dir: Path | str) -> int:
    years = []
    for path in Path(input_dir).glob("Quick Report LOTO_*.pdf"):
        match = PDF_YEAR_RE.search(path.name)
        if match:
            years.append(int(match.group(1)))
    return max(years) if years else datetime.now().year


def month_reference(weeks: list[int], calendar_year: int) -> list[dict]:
    months: dict[str, dict] = {}
    for week in sorted(set(weeks)):
        try:
            monday = date.fromisocalendar(calendar_year, week, 1)
        except ValueError:
            continue
        month_key = monday.strftime("%Y-%m")
        if month_key not in months:
            months[month_key] = {
                "month": month_key,
                "label": spanish_month_label(monday),
                "weeks": [],
            }
        months[month_key]["weeks"].append(week)
    return [
        {**item, "week": item["weeks"][-1]}
        for _, item in sorted(months.items())
    ]


def spanish_month_label(value: date) -> str:
    labels = {
        1: "Ene",
        2: "Feb",
        3: "Mar",
        4: "Abr",
        5: "May",
        6: "Jun",
        7: "Jul",
        8: "Ago",
        9: "Sep",
        10: "Oct",
        11: "Nov",
        12: "Dic",
    }
    return f"{labels[value.month]} {value.year}"


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
    time_series = agency_time_series_metrics(history)

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
        "time_series": time_series,
        "priority": classify_priority(latest, delta, previous_sales, gap_vs_2019),
    }


def agency_time_series_metrics(history: list[dict]) -> dict:
    points = sorted(history, key=lambda item: item["week"])
    sales = [int(point["sales"]) for point in points]
    weeks = [int(point["week"]) for point in points]
    selling_sales = [value for value in sales if value > 0]
    latest = sales[-1] if sales else 0
    previous = sales[-2] if len(sales) > 1 else 0
    recent_values = sales[-4:]
    previous_values = sales[-8:-4] if len(sales) >= 8 else sales[:-4]
    recent_avg = mean(recent_values) if recent_values else 0
    previous_avg = mean(previous_values) if previous_values else 0
    delta_recent = recent_avg - previous_avg if previous_values else latest - previous
    slope = linear_slope(weeks, sales)
    avg_sales = mean(sales) if sales else 0
    volatility = coefficient_of_variation(sales)
    best_index = max(range(len(sales)), key=lambda index: sales[index]) if sales else None
    worst_index = min(range(len(sales)), key=lambda index: sales[index]) if sales else None
    zero_streak = trailing_zero_streak(sales)
    selling_weeks = len(selling_sales)
    trajectory = classify_trajectory(
        latest=latest,
        previous=previous,
        slope=slope,
        avg_sales=avg_sales,
        recent_delta=delta_recent,
        zero_streak=zero_streak,
        selling_weeks=selling_weeks,
        total_weeks=len(sales),
    )

    return {
        "weeks_observed": len(sales),
        "selling_weeks": selling_weeks,
        "selling_rate": selling_weeks / len(sales) if sales else 0,
        "avg_sales": int(avg_sales),
        "median_sales": int(median(sales)) if sales else 0,
        "recent_avg_sales": int(recent_avg),
        "previous_avg_sales": int(previous_avg),
        "recent_delta_sales": int(delta_recent),
        "slope_per_week": int(slope),
        "volatility": volatility,
        "zero_streak": zero_streak,
        "best_week": weeks[best_index] if best_index is not None else None,
        "best_sales": sales[best_index] if best_index is not None else 0,
        "worst_week": weeks[worst_index] if worst_index is not None else None,
        "worst_sales": sales[worst_index] if worst_index is not None else 0,
        "trajectory": trajectory,
    }


def linear_slope(x_values: list[int], y_values: list[int]) -> float:
    if len(x_values) < 2:
        return 0
    x_avg = mean(x_values)
    y_avg = mean(y_values)
    denominator = sum((x - x_avg) ** 2 for x in x_values)
    if denominator == 0:
        return 0
    numerator = sum((x - x_avg) * (y - y_avg) for x, y in zip(x_values, y_values, strict=True))
    return numerator / denominator


def coefficient_of_variation(values: list[int]) -> float:
    if not values:
        return 0
    avg = mean(values)
    if avg == 0:
        return 0
    variance = mean([(value - avg) ** 2 for value in values])
    return sqrt(variance) / avg


def trailing_zero_streak(values: list[int]) -> int:
    streak = 0
    for value in reversed(values):
        if value != 0:
            break
        streak += 1
    return streak


def classify_trajectory(
    latest: int,
    previous: int,
    slope: float,
    avg_sales: float,
    recent_delta: float,
    zero_streak: int,
    selling_weeks: int,
    total_weeks: int,
) -> str:
    meaningful = max(avg_sales * 0.08, 100_000)
    if zero_streak >= 2:
        return "apagada"
    if selling_weeks == 0:
        return "sin_venta"
    if previous == 0 and latest > 0:
        return "reactivada"
    if slope >= meaningful and recent_delta >= 0:
        return "creciente"
    if slope <= -meaningful or recent_delta <= -meaningful:
        return "deterioro"
    if total_weeks >= 4 and selling_weeks / total_weeks < 0.5:
        return "intermitente"
    return "estable"


def summarize_time_series(agencies: list[dict], weeks: list[int]) -> dict:
    trajectories: dict[str, int] = defaultdict(int)
    for agency in agencies:
        trajectories[agency["time_series"]["trajectory"]] += 1
    return {
        "weeks": weeks,
        "trajectory_counts": dict(sorted(trajectories.items())),
        "top_growth": top_by_metric(agencies, "slope_per_week", reverse=True),
        "top_deterioration": top_by_metric(agencies, "slope_per_week", reverse=False),
        "highest_volatility": top_by_metric(agencies, "volatility", reverse=True),
        "persistent_zero": [
            compact_agency(agency)
            for agency in sorted(
                [agency for agency in agencies if agency["time_series"]["zero_streak"] > 0],
                key=lambda item: item["time_series"]["zero_streak"],
                reverse=True,
            )[:25]
        ],
    }


def top_by_metric(agencies: list[dict], metric: str, reverse: bool) -> list[dict]:
    return [
        compact_agency(agency)
        for agency in sorted(agencies, key=lambda item: item["time_series"][metric], reverse=reverse)[:25]
    ]


def compact_agency(agency: dict) -> dict:
    return {
        "lotos_code": agency["lotos_code"],
        "agent_name": agency["agent_name"],
        "territory": agency["territory"],
        "executive": agency["executive"],
        "latest_sales": agency["latest_sales"],
        "time_series": agency["time_series"],
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
