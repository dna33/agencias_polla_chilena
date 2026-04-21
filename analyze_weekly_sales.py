from __future__ import annotations

import argparse
import csv
from collections import defaultdict
from dataclasses import asdict
from pathlib import Path

from app.weekly_sales import WeeklyAgencySale, parse_weekly_workbooks


DEFAULT_INPUT_DIR = Path("input")
DEFAULT_OUTPUT_DIR = Path("data")


def main() -> None:
    parser = argparse.ArgumentParser(description="Analiza bases semanales de ventas por agencia.")
    parser.add_argument("--input-dir", default=str(DEFAULT_INPUT_DIR), help="Carpeta con archivos .xlsx semanales.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Carpeta donde escribir reportes.")
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    paths = weekly_input_paths(input_dir)
    rows = parse_weekly_workbooks(paths)
    write_normalized_csv(rows, output_dir / "weekly_agency_sales.csv")
    write_report(rows, output_dir / "commercial_territorial_report.md", paths)

    print(f"Archivos procesados: {len(paths)}")
    print(f"Filas normalizadas: {len(rows)}")
    print(f"CSV: {output_dir / 'weekly_agency_sales.csv'}")
    print(f"Reporte: {output_dir / 'commercial_territorial_report.md'}")


def weekly_input_paths(input_dir: Path) -> list[Path]:
    paths: list[Path] = []
    for path in sorted(input_dir.glob("*.xlsx")):
        if path.name.startswith("~$"):
            continue
        if path.name.startswith("MaeGerCom"):
            continue
        paths.append(path)
    return paths


def write_normalized_csv(rows: list[WeeklyAgencySale], path: Path) -> None:
    fieldnames = list(asdict(rows[0]).keys()) if rows else []
    with path.open("w", newline="", encoding="utf-8") as file:
        writer = csv.DictWriter(file, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow(asdict(row))


def write_report(rows: list[WeeklyAgencySale], path: Path, input_paths: list[Path]) -> None:
    latest_week = max((row.week for row in rows), default=None)
    latest_rows = [row for row in rows if row.week == latest_week]
    previous_week = max((week for week in {row.week for row in rows} if latest_week is not None and week < latest_week), default=None)

    lines: list[str] = [
        "# Reporte comercial territorial",
        "",
        "## Fuentes",
        "",
        *[f"- `{input_path}`" for input_path in input_paths],
        "",
        "## Lectura ejecutiva",
        "",
    ]
    lines.extend(executive_reading(rows, latest_rows, latest_week, previous_week))
    lines.extend(["", "## KPIs por semana", ""])
    lines.extend(markdown_table(week_kpis(rows), ["Semana", "Agencias", "Con venta", "% con venta", "Venta", "Ticket prom. agencias con venta"]))
    lines.extend(["", "## Ultima semana por territorio", ""])
    lines.extend(markdown_table(group_kpis(latest_rows, "territory"), ["Territorio", "Agencias", "Con venta", "% con venta", "Venta", "Ticket prom. agencias con venta"]))
    lines.extend(["", "## Ultima semana por ejecutivo/coordinador", ""])
    lines.extend(markdown_table(group_kpis(latest_rows, "executive"), ["Ejecutivo", "Agencias", "Con venta", "% con venta", "Venta", "Ticket prom. agencias con venta"]))
    lines.extend(["", "## Alertas de gestion", ""])
    lines.extend(alerts(rows, latest_rows, latest_week, previous_week))
    lines.append("")

    path.write_text("\n".join(lines), encoding="utf-8")


def executive_reading(
    rows: list[WeeklyAgencySale],
    latest_rows: list[WeeklyAgencySale],
    latest_week: int | None,
    previous_week: int | None,
) -> list[str]:
    if latest_week is None:
        return ["No se encontraron bases semanales parseables."]

    total_sales = sum(row.weekly_sales for row in latest_rows)
    selling = sum(1 for row in latest_rows if row.is_selling)
    active_universe = len(latest_rows)
    closed = sum(1 for row in latest_rows if row.is_closed)
    lines = [
        f"- Semana mas reciente detectada: **{latest_week}**.",
        f"- Universo semanal: **{active_universe:,} agencias**, de las cuales **{selling:,}** tuvieron venta.",
        f"- Venta total semana {latest_week}: **{format_money(total_sales)}**.",
        f"- Agencias marcadas como baja/direccion baja: **{closed:,}**. Mantenerlas en el historial permite medir recuperacion, reemplazos y cobertura perdida.",
    ]

    if previous_week is not None:
        previous_total = sum(row.weekly_sales for row in rows if row.week == previous_week)
        delta = total_sales - previous_total
        pct = delta / previous_total if previous_total else 0
        lines.append(
            f"- Cambio vs semana {previous_week}: **{format_money(delta)}** ({pct:.1%})."
        )

    return lines


def week_kpis(rows: list[WeeklyAgencySale]) -> list[list[str]]:
    result: list[list[str]] = []
    for week in sorted({row.week for row in rows}):
        week_rows = [row for row in rows if row.week == week]
        result.append(kpi_row(str(week), week_rows))
    return result


def group_kpis(rows: list[WeeklyAgencySale], attribute: str) -> list[list[str]]:
    groups: dict[str, list[WeeklyAgencySale]] = defaultdict(list)
    for row in rows:
        key = getattr(row, attribute) or "Sin dato"
        groups[key].append(row)

    table = [kpi_row(group, group_rows) for group, group_rows in groups.items()]
    return sorted(table, key=lambda item: parse_money(item[4]), reverse=True)


def kpi_row(label: str, rows: list[WeeklyAgencySale]) -> list[str]:
    total = sum(row.weekly_sales for row in rows)
    selling = sum(1 for row in rows if row.is_selling)
    avg_selling = total / selling if selling else 0
    selling_pct = selling / len(rows) if rows else 0
    return [
        label,
        f"{len(rows):,}",
        f"{selling:,}",
        f"{selling_pct:.1%}",
        format_money(total),
        format_money(avg_selling),
    ]


def alerts(
    rows: list[WeeklyAgencySale],
    latest_rows: list[WeeklyAgencySale],
    latest_week: int | None,
    previous_week: int | None,
) -> list[str]:
    if latest_week is None:
        return ["- Sin datos."]

    lines: list[str] = []
    zero_top = [
        row for row in latest_rows
        if row.top_segment in {"T-500", "TOP1", "TOP2"} and not row.is_selling and not row.is_closed
    ]
    lines.append(f"- Agencias top sin venta en semana {latest_week}: **{len(zero_top):,}**.")

    if previous_week is not None:
        previous_by_lotos = {row.lotos_code: row for row in rows if row.week == previous_week}
        drops: list[tuple[float, WeeklyAgencySale, WeeklyAgencySale]] = []
        recoveries: list[tuple[float, WeeklyAgencySale, WeeklyAgencySale]] = []
        for row in latest_rows:
            previous = previous_by_lotos.get(row.lotos_code)
            if not previous:
                continue
            delta = row.weekly_sales - previous.weekly_sales
            if delta < 0:
                drops.append((delta, row, previous))
            elif delta > 0:
                recoveries.append((delta, row, previous))

        lines.append("")
        lines.append(f"### Mayores caidas semana {previous_week} -> {latest_week}")
        lines.extend(top_changes(drops, reverse=False))
        lines.append("")
        lines.append(f"### Mayores recuperaciones semana {previous_week} -> {latest_week}")
        lines.extend(top_changes(recoveries, reverse=True))

    return lines


def top_changes(changes: list[tuple[float, WeeklyAgencySale, WeeklyAgencySale]], reverse: bool) -> list[str]:
    sorted_changes = sorted(changes, key=lambda item: item[0], reverse=reverse)[:10]
    if not sorted_changes:
        return ["- Sin casos."]
    return [
        (
            f"- `{row.lotos_code}` {row.agent_name or 'Sin nombre'} "
            f"({row.territory or 'Sin territorio'}, {row.comuna or 'Sin comuna'}): "
            f"{format_money(previous.weekly_sales)} -> {format_money(row.weekly_sales)} "
            f"({format_money(delta)})"
        )
        for delta, row, previous in sorted_changes
    ]


def markdown_table(rows: list[list[str]], headers: list[str]) -> list[str]:
    if not rows:
        return ["Sin datos."]
    return [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join(["---"] * len(headers)) + " |",
        *["| " + " | ".join(row) + " |" for row in rows],
    ]


def format_money(value: float) -> str:
    return "$" + f"{value:,.0f}".replace(",", ".")


def parse_money(value: str) -> float:
    return float(value.replace("$", "").replace(".", "") or 0)


if __name__ == "__main__":
    main()
