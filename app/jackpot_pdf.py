from __future__ import annotations

import re
import zlib
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path


PDF_DATE_RE = re.compile(r"(\d{4})_(\d{2})_(\d{2})")
TEXT_DATE_RE = re.compile(r"\b(\d{2})-(\d{2})-(\d{4})\b")
STREAM_RE = re.compile(rb"stream\r?\n(.*?)\r?\nendstream", re.S)
TEXT_OBJECT_RE = re.compile(rb"BT(.*?)ET", re.S)
TM_RE = re.compile(rb"1\s+0\s+0\s+1\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Tm")
LITERAL_RE = re.compile(rb"\((?:\\.|[^\\)])*\)")
DRAW_LABEL_RE = re.compile(r"^(Lun|Mar|Mie|Mié|Jue|Vie|Sab|Sáb|Dom)\s+(\d{1,2})$")

WEEKDAY_BY_LABEL = {
    "Lun": 0,
    "Mar": 1,
    "Mie": 2,
    "Mié": 2,
    "Jue": 3,
    "Vie": 4,
    "Sab": 5,
    "Sáb": 5,
    "Dom": 6,
}


@dataclass(frozen=True, slots=True)
class TextSpan:
    x: float
    y: float
    text: str


@dataclass(frozen=True, slots=True)
class DrawJackpot:
    source_file: str
    draw_date: str
    week: int
    draw_label: str
    loto_mm: int
    kino_mm: int
    total_mm: int


@dataclass(slots=True)
class WeeklyJackpot:
    source_file: str
    week: int
    date: str | None
    loto_total_mm: int
    kino_total_mm: int
    total_mm: int
    draws: dict[str, dict[str, int]] = field(default_factory=dict)
    extraction_note: str | None = None


def parse_jackpot_pdfs(input_dir: str | Path) -> list[WeeklyJackpot]:
    draws_by_date: dict[str, DrawJackpot] = {}
    for path in sorted(Path(input_dir).glob("Quick Report LOTO_*.pdf")):
        draw = parse_jackpot_pdf_current_draw(path)
        if draw:
            draws_by_date[draw.draw_date] = draw

    grouped: dict[int, list[DrawJackpot]] = defaultdict(list)
    for draw in draws_by_date.values():
        grouped[draw.week].append(draw)

    rows: list[WeeklyJackpot] = []
    for week, draws in sorted(grouped.items()):
        ordered = sorted(draws, key=lambda item: item.draw_date)
        loto_avg = round(sum(draw.loto_mm for draw in ordered) / len(ordered)) if ordered else 0
        kino_avg = round(sum(draw.kino_mm for draw in ordered) / len(ordered)) if ordered else 0
        rows.append(
            WeeklyJackpot(
                source_file=", ".join(sorted({draw.source_file for draw in ordered})),
                week=week,
                date=ordered[-1].draw_date if ordered else None,
                loto_total_mm=loto_avg,
                kino_total_mm=kino_avg,
                total_mm=loto_avg + kino_avg,
                draws={
                    draw.draw_date: {
                        "loto_mm": draw.loto_mm,
                        "kino_mm": draw.kino_mm,
                        "total_mm": draw.total_mm,
                    }
                    for draw in ordered
                },
                extraction_note="Promedio semanal de pozos desde la columna del sorteo principal de cada Quick Report PDF.",
            )
        )
    return rows


def parse_jackpot_pdf_current_draw(path: str | Path) -> DrawJackpot | None:
    pdf_path = Path(path)
    spans = extract_pdf_text_spans(pdf_path)
    reference_date = _reference_date(spans, pdf_path.name)
    if not reference_date:
        return None

    for draw in _parse_jackpot_pdf_draws(pdf_path, spans, reference_date):
        if draw.draw_date == reference_date.isoformat():
            return draw
    return None


def parse_jackpot_pdf_draws(path: str | Path) -> list[DrawJackpot]:
    pdf_path = Path(path)
    spans = extract_pdf_text_spans(pdf_path)
    reference_date = _reference_date(spans, pdf_path.name)
    if not reference_date:
        return []
    return _parse_jackpot_pdf_draws(pdf_path, spans, reference_date)


def _parse_jackpot_pdf_draws(pdf_path: Path, spans: list[TextSpan], reference_date: date) -> list[DrawJackpot]:
    date_columns = _draw_date_columns(spans, reference_date)
    loto_values = _money_row(spans, "Pozo Loto")
    kino_values = _money_row(spans, "Pozo Kino")
    if not date_columns or not loto_values or not kino_values:
        return []

    draws: list[DrawJackpot] = []
    for column in date_columns:
        loto = _nearest_value(column.x, loto_values)
        kino = _nearest_value(column.x, kino_values)
        if loto is None or kino is None:
            continue
        week = column.draw_date.isocalendar().week
        draws.append(
            DrawJackpot(
                source_file=pdf_path.name,
                draw_date=column.draw_date.isoformat(),
                week=week,
                draw_label=column.label,
                loto_mm=loto,
                kino_mm=kino,
                total_mm=loto + kino,
            )
        )
    return draws


def extract_pdf_text_spans(path: str | Path) -> list[TextSpan]:
    data = Path(path).read_bytes()
    spans: list[TextSpan] = []
    for stream in STREAM_RE.findall(data):
        content = _decompress_stream(stream)
        if b"BT" not in content:
            continue
        for match in TEXT_OBJECT_RE.finditer(content):
            text_object = match.group(1)
            matrices = list(TM_RE.finditer(text_object))
            if not matrices:
                continue
            matrix = matrices[-1]
            text = _decode_text_object(text_object)
            if text:
                spans.append(
                    TextSpan(
                        x=float(matrix.group(1)),
                        y=float(matrix.group(2)),
                        text=" ".join(text.split()),
                    )
                )
    return spans


@dataclass(frozen=True, slots=True)
class _DrawColumn:
    label: str
    x: float
    draw_date: date


def _draw_date_columns(spans: list[TextSpan], reference_date: date) -> list[_DrawColumn]:
    pozo_loto = _label_span(spans, "Pozo Loto")
    pozo_kino = _label_span(spans, "Pozo Kino")
    if not pozo_loto or not pozo_kino:
        return []

    candidates: list[TextSpan] = []
    for span in spans:
        if span.x <= 80:
            continue
        if not (pozo_loto.y + 80 <= span.y <= pozo_loto.y + 140):
            continue
        if DRAW_LABEL_RE.match(span.text):
            candidates.append(span)

    columns: list[_DrawColumn] = []
    for span in sorted(candidates, key=lambda item: item.x):
        draw_date = _resolve_draw_date(span.text, reference_date)
        if draw_date:
            columns.append(_DrawColumn(label=span.text, x=span.x, draw_date=draw_date))
    return columns


def _money_row(spans: list[TextSpan], label: str) -> list[tuple[float, int]]:
    label_span = _label_span(spans, label)
    if not label_span:
        return []
    values: list[tuple[float, int]] = []
    for span in spans:
        if abs(span.y - label_span.y) <= 1.5 and span.x > label_span.x + 30:
            amount = _parse_money_mm(span.text)
            if amount is not None:
                values.append((span.x, amount))
    return sorted(values)


def _label_span(spans: list[TextSpan], label: str) -> TextSpan | None:
    matches = [span for span in spans if span.text == label and span.x < 90]
    if not matches:
        return None
    return max(matches, key=lambda span: span.y)


def _nearest_value(x: float, values: list[tuple[float, int]]) -> int | None:
    if not values:
        return None
    nearest_x, value = min(values, key=lambda item: abs(item[0] - x))
    if abs(nearest_x - x) > 18:
        return None
    return value


def _parse_money_mm(text: str) -> int | None:
    if "$" not in text:
        return None
    digits = re.sub(r"[^0-9]", "", text)
    return int(digits) if digits else None


def _resolve_draw_date(label: str, reference_date: date) -> date | None:
    match = DRAW_LABEL_RE.match(label)
    if not match:
        return None
    weekday_label, day_text = match.groups()
    target_weekday = WEEKDAY_BY_LABEL[weekday_label]
    day = int(day_text)
    candidates: list[date] = []
    for year, month in _candidate_months(reference_date):
        try:
            candidate = date(year, month, day)
        except ValueError:
            continue
        if candidate <= reference_date and candidate.weekday() == target_weekday:
            candidates.append(candidate)
    return max(candidates) if candidates else None


def _candidate_months(reference_date: date) -> list[tuple[int, int]]:
    months: list[tuple[int, int]] = []
    year = reference_date.year
    month = reference_date.month
    for offset in range(0, -3, -1):
        month_index = month + offset
        candidate_year = year + (month_index - 1) // 12
        candidate_month = ((month_index - 1) % 12) + 1
        months.append((candidate_year, candidate_month))
    return months


def _reference_date(spans: list[TextSpan], filename: str) -> date | None:
    for span in spans:
        match = TEXT_DATE_RE.search(span.text)
        if match:
            day, month, year = (int(part) for part in match.groups())
            return date(year, month, day)
    return _date_from_filename(filename)


def _date_from_filename(filename: str) -> date | None:
    match = PDF_DATE_RE.search(filename)
    if not match:
        return None
    year, month, day = (int(group) for group in match.groups())
    return date(year, month, day)


def _decompress_stream(stream: bytes) -> bytes:
    try:
        return zlib.decompress(stream)
    except zlib.error:
        return stream


def _decode_text_object(text_object: bytes) -> str:
    return "".join(_decode_literal(match.group(0)) for match in LITERAL_RE.finditer(text_object))


def _decode_literal(raw: bytes) -> str:
    body = raw[1:-1]
    output = bytearray()
    index = 0
    while index < len(body):
        char = body[index]
        if char == 92 and index + 1 < len(body):
            escaped = body[index + 1]
            output.append(
                {
                    ord("n"): 10,
                    ord("r"): 13,
                    ord("t"): 9,
                    ord("b"): 8,
                    ord("f"): 12,
                    ord("("): 40,
                    ord(")"): 41,
                    ord("\\"): 92,
                }.get(escaped, escaped)
            )
            index += 2
            continue
        output.append(char)
        index += 1
    return output.decode("latin-1", errors="replace")
