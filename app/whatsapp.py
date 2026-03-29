from __future__ import annotations

import json
import urllib.error
import urllib.request

from app.config import settings


def send_text_message(phone_number: str, body: str) -> None:
    if not settings.whatsapp_access_token or not settings.whatsapp_phone_number_id:
        return

    payload = {
        "messaging_product": "whatsapp",
        "to": phone_number,
        "type": "text",
        "text": {"body": body},
    }
    request = urllib.request.Request(
        url=f"{settings.meta_api_base_url}/{settings.whatsapp_phone_number_id}/messages",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {settings.whatsapp_access_token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10):
            return
    except urllib.error.URLError:
        return
