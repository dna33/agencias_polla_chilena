from __future__ import annotations

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo


@dataclass(frozen=True)
class Settings:
    app_name: str = os.getenv("APP_NAME", "Polla Agencies WhatsApp MVP")
    db_path: str = os.getenv("DATABASE_PATH", "data/agencies.db")
    timezone_name: str = os.getenv("APP_TIMEZONE", "America/Santiago")
    whatsapp_verify_token: str = os.getenv("WHATSAPP_VERIFY_TOKEN", "dev-verify-token")
    whatsapp_access_token: str = os.getenv("WHATSAPP_ACCESS_TOKEN", "")
    whatsapp_phone_number_id: str = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "")
    meta_api_base_url: str = os.getenv("META_API_BASE_URL", "https://graph.facebook.com/v21.0")

    @property
    def timezone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone_name)


settings = Settings()
