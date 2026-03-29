from __future__ import annotations

import json
import sys

from app.importer import ExcelAgencyImporter


def main() -> int:
    if len(sys.argv) != 2:
        print("Uso: python import_agencies.py /ruta/archivo.xlsx")
        return 1

    importer = ExcelAgencyImporter()
    report = importer.import_file(sys.argv[1])
    print(
        json.dumps(
            {
                "total_rows": report.total_rows,
                "imported_rows": report.imported_rows,
                "searchable_rows": report.searchable_rows,
                "discarded_rows": report.discarded_rows,
                "invalid_coordinates_count": len(report.invalid_coordinates_rows),
                "invalid_coordinates_rows_sample": report.invalid_coordinates_rows[:25],
                "invalid_schedule_count": len(report.invalid_schedule_rows),
                "invalid_schedule_rows_sample": report.invalid_schedule_rows[:25],
                "ineligible_status_count": len(report.ineligible_status_rows),
                "ineligible_status_rows_sample": report.ineligible_status_rows[:25],
            },
            ensure_ascii=True,
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
