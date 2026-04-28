from __future__ import annotations

from openpyxl import Workbook

from app.agency_prizes import parse_agency_prize_workbook


def test_parse_agency_prize_workbook_aggregates_by_agency_and_subgame(tmp_path):
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Informe 1"
    sheet.append([None, None, None, None, None, None])
    sheet.append([None, "ID del Agente", "Descripción del Agente Description", "Descripción del subjuego", "Monto bruto de premio", "Monto neto de premio"])
    sheet.append([None, 101001, "Agencia 1", "Loto", 1000, 900])
    sheet.append([None, 101001, "Agencia 1", "Multiplicar", 500, 450])
    sheet.append([None, 101001, "Agencia 1", "Loto", 200, 180])
    sheet.append([None, 101002, "Agencia 2", "Racha", None, None])
    sheet.append([None, 101002, "Agencia 2", "Racha", 700, 650])
    path = tmp_path / "premios.xlsx"
    workbook.save(path)

    rows = parse_agency_prize_workbook(path)

    assert len(rows) == 2
    first = next(row for row in rows if row.lotos_code == "101001")
    assert first.gross_total == 1700
    assert first.net_total == 1530
    assert first.subgames_count == 2
    assert first.top_subgames[0]["subgame"] == "Loto"
    assert first.top_subgames[0]["gross_total"] == 1200
