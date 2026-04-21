from __future__ import annotations

from openpyxl import Workbook

from app.weekly_sales import parse_weekly_workbook


def test_parse_weekly_sheet_with_header_on_first_row(tmp_path):
    path = tmp_path / "Base Sem 13.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Hoja1"
    sheet.append([
        "N°",
        "  Lotos",
        "Nombre Agente",
        "Comuna",
        "Est. Com.",
        "Vta.Sem.13",
        "Latitud",
        "Longitud",
        "Ubicación",
    ])
    sheet.append([1, 123456, "Agencia Uno", "SANTIAGO", "Direccion", 1000, "-33.4", "-70.6", "RM Norte"])
    workbook.save(path)

    result = parse_weekly_workbook(path)

    assert result.skipped_sheets == []
    assert len(result.rows) == 1
    assert result.rows[0].week == 13
    assert result.rows[0].lotos_code == "123456"
    assert result.rows[0].weekly_sales == 1000
    assert result.rows[0].territory == "RM Norte"


def test_parse_weekly_sheet_with_header_after_metadata_rows(tmp_path):
    path = tmp_path / "Base Semana 15.xlsx"
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "LOTO_ PtoVta"
    sheet.append(["metadata"])
    sheet.append([])
    sheet.append(["metadata"])
    sheet.append([])
    sheet.append([])
    sheet.append([])
    sheet.append(["F", 1])
    sheet.append(["N°", "  Lotos", "Nombre Agente", "Status", "Vta.Sem.15", "Master"])
    sheet.append([1, 654321, "Agencia Dos", "activo", 2500, 654321])
    workbook.save(path)

    result = parse_weekly_workbook(path)

    assert result.rows[0].source_row == 9
    assert result.rows[0].week == 15
    assert result.rows[0].operational_status == "activo"
    assert result.rows[0].master_code == "654321"
