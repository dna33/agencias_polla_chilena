from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from app.config import settings


def ensure_database() -> None:
    db_path = Path(settings.db_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS agencies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                lotos_code TEXT,
                master_code TEXT,
                raspe_code TEXT,
                agent_name TEXT,
                rut TEXT,
                address TEXT,
                comuna TEXT,
                region_number TEXT,
                rubro TEXT,
                legal_representative TEXT,
                phone_local TEXT,
                phone_1 TEXT,
                phone_2 TEXT,
                email TEXT,
                contact_name TEXT,
                observation TEXT,
                commercial_status TEXT,
                agent_status TEXT,
                status_change_date TEXT,
                latitude REAL,
                longitude REAL,
                raw_coordinates TEXT,
                schedule_json TEXT NOT NULL,
                schedule_raw_json TEXT NOT NULL,
                data_quality_errors_json TEXT NOT NULL,
                raw_row_hash TEXT NOT NULL UNIQUE,
                is_active_for_search INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS query_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                user_phone TEXT,
                incoming_text TEXT,
                had_location INTEGER NOT NULL DEFAULT 0,
                user_latitude REAL,
                user_longitude REAL,
                recommended_agency_id INTEGER,
                alternative_agency_ids_json TEXT NOT NULL,
                response_time_ms INTEGER,
                error_message TEXT,
                metadata_json TEXT NOT NULL,
                FOREIGN KEY (recommended_agency_id) REFERENCES agencies(id)
            );

            CREATE INDEX IF NOT EXISTS idx_agencies_search
            ON agencies(is_active_for_search, commercial_status, agent_status);
            """
        )


@contextmanager
def get_connection() -> Iterator[sqlite3.Connection]:
    ensure_database()
    connection = sqlite3.connect(settings.db_path)
    connection.row_factory = sqlite3.Row
    try:
        yield connection
        connection.commit()
    finally:
        connection.close()
