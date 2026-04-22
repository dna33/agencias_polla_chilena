from __future__ import annotations

from app.jackpot_pdf import parse_jackpot_pdf_current_draw, parse_jackpot_pdfs


def test_parse_known_quick_report_pdf_jackpot_values():
    draw = parse_jackpot_pdf_current_draw("input/Quick Report LOTO_2026_04_22.pdf")

    assert draw is not None
    assert draw.draw_date == "2026-04-21"
    assert draw.week == 17
    assert draw.loto_mm == 2300
    assert draw.kino_mm == 7500
    assert draw.total_mm == 9800


def test_parse_current_draw_uses_pdf_main_draw_not_historical_window():
    draw = parse_jackpot_pdf_current_draw("input/Quick Report LOTO_2026_04_16.pdf")

    assert draw is not None
    assert draw.draw_date == "2026-04-16"
    assert draw.loto_mm == 3250
    assert draw.kino_mm == 7100


def test_parse_quick_report_pdfs_deduplicates_draws_by_week():
    jackpots = parse_jackpot_pdfs("input")
    week_15 = next(row for row in jackpots if row.week == 15)

    assert week_15.loto_total_mm == 5750
    assert week_15.kino_total_mm == 6800
    assert week_15.total_mm == 12550
    assert len(week_15.draws) == 3
