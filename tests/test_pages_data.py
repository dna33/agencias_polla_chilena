from __future__ import annotations

import build_pages_data
from app.weekly_sales import WeeklyAgencySale
from pathlib import Path
import json

from build_pages_data import (
    agency_time_series_metrics,
    build_dashboard_payload,
    commune_market_context,
    territorial_prize_communes_context,
    weekly_zone_input_paths,
    weekly_input_paths,
)


def make_row(
    week: int,
    lotos_code: str,
    sales: float,
    commune: str = "Comuna",
    territory: str = "Norte",
    executive: str = "DINO DIAZ",
    commercial_status: str = "Activo",
    sales_status: str = "OK",
) -> WeeklyAgencySale:
    return WeeklyAgencySale(
        source_file="base.xlsx",
        source_sheet="Hoja1",
        source_row=2,
        week=week,
        lotos_code=lotos_code,
        master_code=lotos_code,
        previous_lotos_code=None,
        agent_name=f"Agencia {lotos_code}",
        rut=None,
        address="Direccion",
        comuna=commune,
        region_number="1",
        rubro="Exclusivo",
        executive=executive,
        admission_date=None,
        commercial_status=commercial_status,
        operational_status=None,
        top_segment="T-500",
        coverage="FOCO",
        sales_status=sales_status,
        weekly_sales=sales,
        average_sales_2019=2_000_000,
        difference_vs_2019=sales - 2_000_000,
        latitude=-33.0,
        longitude=-70.0,
        territory=territory,
        closed_date=None,
    )


def test_build_dashboard_payload_tracks_latest_delta_and_priorities():
    payload = build_dashboard_payload(
        [
            make_row(15, "123456", 2_500_000),
            make_row(16, "123456", 900_000),
            make_row(16, "654321", 0),
        ],
        [],
    )

    assert payload["weeks"] == [15, 16]
    assert payload["latest_week"] == 16
    agency = next(item for item in payload["agencies"] if item["lotos_code"] == "123456")
    assert agency["delta_sales"] == -1_600_000
    assert agency["priority"] == "caida_fuerte"
    assert payload["summary"]["by_week"][1]["sales"] == 900_000
    assert payload["priorities"]["biggest_drops"][0]["lotos_code"] == "123456"


def test_agency_time_series_metrics_classifies_growth_and_deterioration():
    growing = agency_time_series_metrics([
        {"week": 1, "sales": 100_000},
        {"week": 2, "sales": 250_000},
        {"week": 3, "sales": 420_000},
        {"week": 4, "sales": 700_000},
    ])
    deteriorating = agency_time_series_metrics([
        {"week": 1, "sales": 900_000},
        {"week": 2, "sales": 650_000},
        {"week": 3, "sales": 300_000},
        {"week": 4, "sales": 50_000},
    ])

    assert growing["trajectory"] == "creciente"
    assert growing["slope_per_week"] > 0
    assert deteriorating["trajectory"] == "deterioro"
    assert deteriorating["slope_per_week"] < 0


def test_agency_time_series_metrics_detects_trailing_zero_streak():
    metrics = agency_time_series_metrics([
        {"week": 1, "sales": 500_000},
        {"week": 2, "sales": 300_000},
        {"week": 3, "sales": 0},
        {"week": 4, "sales": 0},
    ])

    assert metrics["trajectory"] == "apagada"
    assert metrics["zero_streak"] == 2


def test_commune_market_context_builds_monthly_relative_series(monkeypatch):
    monkeypatch.setattr(
        build_pages_data,
        "population_by_commune",
        lambda _input_dir, commune_names: {commune: {"A": 1_000, "B": 2_000}[commune] for commune in commune_names},
    )
    monkeypatch.setattr(build_pages_data, "infer_sales_calendar_year", lambda _input_dir: 2026)

    context = commune_market_context(
        [
            make_row(5, "100001", 100_000, commune="A"),
            make_row(5, "100002", 50_000, commune="A"),
            make_row(5, "100003", 0, commune="A"),
            make_row(5, "200001", 400_000, commune="B"),
            make_row(6, "100001", 200_000, commune="A"),
            make_row(6, "100002", 20_000, commune="A"),
            make_row(6, "100003", 0, commune="A"),
            make_row(6, "200001", 600_000, commune="B"),
            make_row(7, "100001", 300_000, commune="A"),
            make_row(7, "100002", 30_000, commune="A"),
            make_row(7, "100003", 0, commune="A"),
            make_row(7, "200001", 500_000, commune="B"),
        ],
        [5, 6, 7],
        7,
        "input",
    )

    assert [item["month"] for item in context["months"]] == ["2026-01", "2026-02"]
    assert context["communes"] == 2
    a_row = next(item for item in context["rows"] if item["commune"] == "A")
    b_row = next(item for item in context["rows"] if item["commune"] == "B")
    assert a_row["latest_month_label"].endswith("2026")
    assert a_row["agencies"] == 2
    assert a_row["latest_month_avg_sales"] == 275_000
    assert a_row["overall_avg_sales"] == 233_333
    assert a_row["overall_avg_sales_per_100k_adults"] == 23_333_300
    assert len(a_row["monthly_series"]) == 2
    assert a_row["monthly_series"][1]["weeks_count"] == 2
    assert a_row["weeks_observed"] == 3
    assert context["rows"][0]["commune"] == "A"
    assert b_row["overall_avg_sales_per_100k_adults"] == 25_000_000
    assert context["below_latest_benchmark_communes"] == 0


def test_build_dashboard_payload_attaches_prize_totals(monkeypatch):
    monkeypatch.setattr(
        build_pages_data,
        "prize_payload",
        lambda _input_dir: [
            {
                "lotos_code": "123456",
                "agent_name": "Agencia 123456",
                "gross_total": 900_000,
                "net_total": 850_000,
                "subgames_count": 2,
                "top_subgames": [{"subgame": "Loto", "gross_total": 700_000, "net_total": 660_000}],
                "source_file": "premios.xlsx",
            }
        ],
    )

    payload = build_dashboard_payload(
        [
            make_row(16, "123456", 900_000),
            make_row(16, "654321", 300_000),
        ],
        [],
    )

    agency = next(item for item in payload["agencies"] if item["lotos_code"] == "123456")
    assert agency["prize_total_gross"] == 900_000
    assert agency["prize_total_net"] == 850_000
    assert payload["agency_prize_summary"]["gross_total"] == 900_000
    assert payload["agency_prize_summary"]["top_agencies"][0]["lotos_code"] == "123456"


def test_weekly_input_paths_excludes_prize_workbook(tmp_path):
    (tmp_path / "Base Semana 17.xlsx").write_text("", encoding="utf-8")
    (tmp_path / "Premios Vendidos por Lotos 2026 al 04-26.xlsx").write_text("", encoding="utf-8")
    (tmp_path / "MaeGerCom - Base Datos.xlsx").write_text("", encoding="utf-8")

    paths = weekly_input_paths(tmp_path)

    assert [path.name for path in paths] == ["Base Semana 17.xlsx"]


def test_weekly_input_paths_prefers_historical_sales_report(tmp_path):
    (tmp_path / "Base Semana 17.xlsx").write_text("", encoding="utf-8")
    (tmp_path / "Venta Loto Semana 17 vs Anteriores Reporte DAZ vsimple.xlsx").write_text("", encoding="utf-8")

    paths = weekly_input_paths(tmp_path)

    assert [path.name for path in paths] == ["Venta Loto Semana 17 vs Anteriores Reporte DAZ vsimple.xlsx"]


def test_weekly_input_paths_includes_newer_incremental_weeks_after_historical_report(tmp_path):
    (tmp_path / "Base Semana 17.xlsx").write_text("", encoding="utf-8")
    (tmp_path / "Base Semana 18.xlsx").write_text("", encoding="utf-8")
    (tmp_path / "Venta Loto Semana 17 vs Anteriores Reporte DAZ vsimple.xlsx").write_text("", encoding="utf-8")

    paths = weekly_input_paths(tmp_path)

    assert [path.name for path in paths] == [
        "Venta Loto Semana 17 vs Anteriores Reporte DAZ vsimple.xlsx",
        "Base Semana 18.xlsx",
    ]


def test_weekly_input_paths_accepts_abbreviated_sem_with_dot(tmp_path):
    (tmp_path / "Venta Loto Semana 17 vs Anteriores Reporte DAZ vsimple.xlsx").write_text("", encoding="utf-8")
    (tmp_path / "Base_ sem. 23.xlsx").write_text("", encoding="utf-8")

    paths = weekly_input_paths(tmp_path)

    assert [path.name for path in paths] == [
        "Venta Loto Semana 17 vs Anteriores Reporte DAZ vsimple.xlsx",
        "Base_ sem. 23.xlsx",
    ]


def test_weekly_zone_input_paths_excludes_historical_sales_report(tmp_path):
    (tmp_path / "Base Semana 17.xlsx").write_text("", encoding="utf-8")
    (tmp_path / "Venta Loto Semana 17 vs Anteriores Reporte DAZ vsimple.xlsx").write_text("", encoding="utf-8")

    paths = weekly_zone_input_paths(tmp_path)

    assert [path.name for path in paths] == ["Base Semana 17.xlsx"]


def test_territorial_prize_communes_context_aggregates_prizes_on_geojson(tmp_path):
    geojson_path = tmp_path / "comunas.geojson"
    geojson_path.write_text(json.dumps({
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"Comuna": "Santiago", "codregion": 13, "Region": "RM"},
                "geometry": {"type": "Polygon", "coordinates": []},
            },
            {
                "type": "Feature",
                "properties": {"Comuna": "Maipu", "codregion": 13, "Region": "RM"},
                "geometry": {"type": "Polygon", "coordinates": []},
            },
        ],
    }), encoding="utf-8")

    context = territorial_prize_communes_context(
        [
            {"lotos_code": "123456", "gross_total": 900_000, "net_total": 850_000},
            {"lotos_code": "654321", "gross_total": 300_000, "net_total": 250_000},
        ],
        [
            {"lotos_code": "123456", "comuna": "SANTIAGO", "history": [{"sales": 2_000_000}, {"sales": 1_000_000}]},
            {"lotos_code": "654321", "comuna": "MAIPU", "history": [{"sales": 500_000}]},
        ],
        tmp_path,
    )

    assert context["communes_with_prizes"] == 2
    santiago = next(feature for feature in context["features"] if feature["properties"]["commune"] == "Santiago")
    assert santiago["properties"]["gross_total"] == 900_000
    assert santiago["properties"]["agencies_with_prizes"] == 1
    assert santiago["properties"]["sales_total"] == 3_000_000
    assert round(santiago["properties"]["net_over_sales_pct"], 2) == 28.33
