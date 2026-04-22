from __future__ import annotations

from app.weekly_sales import WeeklyAgencySale
from build_pages_data import agency_time_series_metrics, build_dashboard_payload


def make_row(
    week: int,
    lotos_code: str,
    sales: float,
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
        comuna="Comuna",
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
