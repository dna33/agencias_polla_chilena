from __future__ import annotations

from app.census_population import _count_adults_by_code


def test_count_adults_by_code_counts_only_people_over_18(tmp_path):
    path = tmp_path / "personas_censo2024.csv"
    path.write_text(
        "\n".join([
            "id_persona;comuna;edad",
            "1;13127;18",
            "2;13127;19",
            "3;13127;80",
            "4;2101;17",
            "5;2101;45",
            "6;9999;70",
        ]),
        encoding="utf-8",
    )

    counts = _count_adults_by_code(path, {"13127", "2101"})

    assert counts["13127"] == 2
    assert counts["2101"] == 1
