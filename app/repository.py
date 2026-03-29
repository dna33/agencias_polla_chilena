from __future__ import annotations

import json
from dataclasses import asdict
from datetime import UTC, datetime

from app.database import get_connection
from app.models import Agency, QueryLog


class AgencyRepository:
    def replace_all(self, agencies: list[Agency]) -> None:
        with get_connection() as connection:
            connection.execute("DELETE FROM agencies")
            for agency in agencies:
                now = datetime.now(UTC).isoformat()
                connection.execute(
                    """
                    INSERT INTO agencies (
                        lotos_code, master_code, raspe_code, agent_name, rut, address, comuna,
                        region_number, rubro, legal_representative, phone_local, phone_1, phone_2,
                        email, contact_name, observation, commercial_status, agent_status,
                        status_change_date, latitude, longitude, raw_coordinates, schedule_json,
                        schedule_raw_json, data_quality_errors_json, raw_row_hash, is_active_for_search,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        agency.lotos_code,
                        agency.master_code,
                        agency.raspe_code,
                        agency.agent_name,
                        agency.rut,
                        agency.address,
                        agency.comuna,
                        agency.region_number,
                        agency.rubro,
                        agency.legal_representative,
                        agency.phone_local,
                        agency.phone_1,
                        agency.phone_2,
                        agency.email,
                        agency.contact_name,
                        agency.observation,
                        agency.commercial_status,
                        agency.agent_status,
                        agency.status_change_date,
                        agency.latitude,
                        agency.longitude,
                        agency.raw_coordinates,
                        json.dumps(agency.schedule_json, ensure_ascii=True),
                        json.dumps(agency.schedule_raw_json, ensure_ascii=True),
                        json.dumps(agency.data_quality_errors, ensure_ascii=True),
                        agency.raw_row_hash,
                        1 if agency.is_active_for_search else 0,
                        now,
                        now,
                    ),
                )

    def list_searchable(self) -> list[Agency]:
        with get_connection() as connection:
            rows = connection.execute(
                """
                SELECT * FROM agencies
                WHERE is_active_for_search = 1
                AND commercial_status = 'Activo'
                AND agent_status = 'Active'
                AND latitude IS NOT NULL
                AND longitude IS NOT NULL
                """
            ).fetchall()
        return [self._row_to_agency(row) for row in rows]

    def list_all(self) -> list[Agency]:
        with get_connection() as connection:
            rows = connection.execute("SELECT * FROM agencies").fetchall()
        return [self._row_to_agency(row) for row in rows]

    def _row_to_agency(self, row) -> Agency:
        return Agency(
            id=row["id"],
            lotos_code=row["lotos_code"],
            master_code=row["master_code"],
            raspe_code=row["raspe_code"],
            agent_name=row["agent_name"],
            rut=row["rut"],
            address=row["address"],
            comuna=row["comuna"],
            region_number=row["region_number"],
            rubro=row["rubro"],
            legal_representative=row["legal_representative"],
            phone_local=row["phone_local"],
            phone_1=row["phone_1"],
            phone_2=row["phone_2"],
            email=row["email"],
            contact_name=row["contact_name"],
            observation=row["observation"],
            commercial_status=row["commercial_status"],
            agent_status=row["agent_status"],
            status_change_date=row["status_change_date"],
            latitude=row["latitude"],
            longitude=row["longitude"],
            raw_coordinates=row["raw_coordinates"],
            schedule_json=json.loads(row["schedule_json"]),
            schedule_raw_json=json.loads(row["schedule_raw_json"]),
            data_quality_errors=json.loads(row["data_quality_errors_json"]),
            raw_row_hash=row["raw_row_hash"],
            is_active_for_search=bool(row["is_active_for_search"]),
            created_at=datetime.fromisoformat(row["created_at"]),
            updated_at=datetime.fromisoformat(row["updated_at"]),
        )


class QueryLogRepository:
    def create(self, log: QueryLog) -> None:
        with get_connection() as connection:
            connection.execute(
                """
                INSERT INTO query_logs (
                    created_at, user_phone, incoming_text, had_location, user_latitude, user_longitude,
                    recommended_agency_id, alternative_agency_ids_json, response_time_ms, error_message, metadata_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.now(UTC).isoformat(),
                    log.user_phone,
                    log.incoming_text,
                    1 if log.had_location else 0,
                    log.user_latitude,
                    log.user_longitude,
                    log.recommended_agency_id,
                    json.dumps(log.alternative_agency_ids, ensure_ascii=True),
                    log.response_time_ms,
                    log.error_message,
                    json.dumps(log.metadata_json, ensure_ascii=True),
                ),
            )
