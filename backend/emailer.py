"""
Alert email notifications (SMTP).

Agar SMTP env vars set nahi hain, yeh silently no-op karta hai (dashboard-only
mode, jaisa ab tak tha) - isse koi existing flow nahi tootega.

Required env vars (sab .env mein, kabhi chat mein paste mat kijiye):
  SMTP_HOST       - e.g. smtp.gmail.com
  SMTP_PORT       - e.g. 587
  SMTP_USER       - aapka email address
  SMTP_PASSWORD   - app password (Gmail ke liye "App Password", normal password nahi)
  ALERT_EMAIL_TO  - jiska email pe alert jaana hai (comma se multiple)
  ALERT_EMAIL_FROM (optional) - default SMTP_USER
"""

import logging
import os
import smtplib
from email.mime.text import MIMEText

logger = logging.getLogger("emailer")


def send_alert_email(subject: str, body: str, override_to: str | None = None) -> bool:
    host = os.getenv("SMTP_HOST")
    to_raw = override_to or os.getenv("ALERT_EMAIL_TO")
    if not host or not to_raw:
        logger.info("Email alerts not configured (SMTP_HOST/ALERT_EMAIL_TO missing) - skipping.")
        return False

    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("ALERT_EMAIL_FROM") or user
    recipients = [addr.strip() for addr in to_raw.split(",") if addr.strip()]

    msg = MIMEText(body)
    msg["Subject"] = f"[CRO Automation] {subject}"
    msg["From"] = sender
    msg["To"] = ", ".join(recipients)

    try:
        with smtplib.SMTP(host, port, timeout=15) as server:
            server.starttls()
            if user and password:
                server.login(user, password)
            server.sendmail(sender, recipients, msg.as_string())
        logger.info("Alert email sent: %s", subject)
        return True
    except Exception:
        logger.exception("Failed to send alert email")
        return False
