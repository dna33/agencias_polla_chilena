from __future__ import annotations

import build_pages_data
from app.weekly_sales import WeeklyAgencySale
from build_pages_data import agency_time_series_metrics, build_dashboard_payload, commune_market_context


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
            make_row(5, "200001", 400_000, commune="B"),
            make_row(6, "100001", 200_000, commune="A"),
            make_row(6, "100002", 20_000, commune="A"),
            make_row(6, "200001", 600_000, commune="B"),
            make_row(7, "100001", 300_000, commune="A"),
            make_row(7, "100002", 30_000, commune="A"),
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
    assert a_row["overall_avg_sales"] == 212_500
    assert a_row["overall_avg_sales_per_100k_adults"] == 21_250_000
    assert len(a_row["monthly_series"]) == 2
    assert a_row["monthly_series"][1]["weeks_count"] == 2
    assert context["rows"][0]["commune"] == "A"
    assert b_row["overall_avg_sales_per_100k_adults"] == 23_750_000
    assert context["below_latest_benchmark_communes"] == 0
