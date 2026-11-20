"""
Daily numbers email - sent by the backend itself every morning.

What it sends: yesterday's numbers (store time zone, a complete day) as a
plain-text email - revenue / orders / AOV, sessions + conversion, the funnel,
top landing pages, payments, and a data-check line.

When: every day at DAILY_REPORT_UTC (default 05:30 UTC = 11:00 AM IST). The
scheduler checks every run; Render's free plan sleeps, so if the backend
wakes up after that time and today's report hasn't gone yet, it sends then.
A row in daily_report_log stops it sending twice.

Settings (Render -> Environment; never paste them in chat):
  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD   - same as alert emails
  DAILY_REPORT_TO     - who gets it (comma-separated for more than one)
  DAILY_REPORT_FROM   - optional, default SMTP_USER
  DAILY_REPORT_UTC    - optional send time "HH:MM" in UTC, default 05:30
  DAILY_REPORT_ENABLED - optional, "false" turns the daily send off

Read-only towards Shopify, like everything else in this app.
"""

import logging
import os
import smtplib
from datetime import datetime, timedelta, timezone
from email.mime.text import MIMEText

from sqlalchemy.orm import Session

import models

logger = logging.getLogger("daily_report")


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _money(v, currency: str | None) -> str:
    if v is None:
        return "-"
    sym = {"USD": "$", "INR": "₹", "EUR": "€", "GBP": "£"}.get((currency or "USD").upper(), "")
    return f"{sym}{v:,.0f}" if sym else f"{v:,.0f} {currency}"


def _pct(v, digits: int = 1) -> str:
    return "-" if v is None else f"{v:.{digits}f}%"


def _chg(block: dict) -> str:
    if not block:
        return ""
    if block.get("too_early"):
        return " (too early to compare)"
    c = block.get("change_pct")
    if c is None:
        return ""
    arrow = "▲" if c > 0 else ("▼" if c < 0 else "=")
    return f" ({arrow} {c:+.1f}% {block.get('baseline_label', '')})".rstrip() + ""


def _send_time_utc() -> tuple[int, int]:
    raw = os.getenv("DAILY_REPORT_UTC", "05:30")
    try:
        h, m = raw.split(":")
        return max(0, min(23, int(h))), max(0, min(59, int(m)))
    except ValueError:
        return 5, 30


def recipients() -> list[str]:
    return [a.strip() for a in (os.getenv("DAILY_REPORT_TO") or "").split(",") if a.strip()]


def _send(subject: str, body: str, to: list[str]) -> tuple[bool, str]:
    host = os.getenv("SMTP_HOST")
    if not host:
        return False, "SMTP_HOST is not set"
    if not to:
        return False, "DAILY_REPORT_TO is not set"
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER")
    password = os.getenv("SMTP_PASSWORD")
    sender = os.getenv("DAILY_REPORT_FROM") or user
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = ", ".join(to)
    try:
        with smtplib.SMTP(host, port, timeout=20) as server:
            server.starttls()
            if user and password:
                server.login(user, password)
            server.sendmail(sender, to, msg.as_string())
        return True, "sent"
    except Exception as exc:
        logger.exception("Daily report email failed")
        return False, f"SMTP error: {str(exc)[:200]}"


# ---------------------------------------------------------------------------
# the report
# ---------------------------------------------------------------------------

def build_report(db: Session, store: models.Store) -> tuple[str, str]:
    """(subject, plain-text body) for yesterday, store time."""
    from cart_extras import fetch_cart_extras
    from funnel import fetch_funnel_compare
    from landing import fetch_landing_pages
    from overview import fetch_overview
    from shopify_sync import ensure_fresh_orders

    ensure_fresh_orders(db, store)  # backend may have just woken up
    cur = store.currency
    lines: list[str] = []
    checks: list[str] = []

    # 1. Sales
    ov = fetch_overview(db, store, period="yesterday", compare="4week_avg")
    m = ov["metrics"]
    day_label = ov["period_label"]
    lines += [
        f"Ridhi Pulse daily numbers - {day_label}",
        f"Store time zone: {ov.get('timezone')}. Changes are vs the 4-week same-weekday average.",
        "",
        "SALES",
        f"  Revenue:   {_money(m['revenue']['value'], cur)}{_chg(m['revenue'])}",
        f"  Orders:    {m['orders']['value']}{_chg(m['orders'])}",
        f"  AOV:       {_money(m['aov']['value'], cur)}{_chg(m['aov'])}",
    ]
    cr = m["conversion_rate"]
    lines += [
        f"  Sessions:  {cr['sessions']:,}" if cr.get("sessions") else "  Sessions:  -",
        f"  Conversion rate: {_pct(cr.get('value'), 2)}{_chg(cr)}  ({cr.get('base_label', '')})",
        "",
    ]
    if not m["orders"]["value"]:
        checks.append("0 orders for the day - check the order sync.")
    if not cr.get("sessions"):
        checks.append("No sessions from Shopify Analytics for the day.")
    if ov.get("cvr_error"):
        checks.append(f"Conversion data error: {ov['cvr_error'][:120]}")
    for w in ov.get("warnings") or []:
        checks.append(w)

    # 2. Funnel
    try:
        fn = fetch_funnel_compare(store, period="yesterday")
        lines.append(f"FUNNEL ({fn['compare_label']})")
        for st in fn["steps"]:
            if not st.get("available"):
                lines.append(f"  {st['label']}: not available")
                continue
            step = f" · {st['step_pct']:.1f}% of previous step" if st.get("step_pct") is not None else ""
            ch = (
                f" ({st['step_change_pts']:+.2f} pts)"
                if st.get("step_change_pts") is not None and not fn.get("too_early") else ""
            )
            lines.append(f"  {st['label']}: {st['value']:,}{step}{ch}")
    except Exception as exc:
        lines.append("FUNNEL: could not load from Shopify")
        checks.append(f"Funnel error: {str(exc)[:120]}")
    lines.append("")

    # 3. Landing pages
    try:
        lp = fetch_landing_pages(store, days=7, period="yesterday")
        lines.append(f"TOP LANDING PAGES ({lp['window_label']})")
        for p in lp["pages"][:5]:
            path = "/ (homepage)" if p["path"] == "/" else p["path"]
            lines.append(
                f"  {path}: {p['sessions']:,} sessions · bounce {_pct(p['bounce_rate'])} · conversion {_pct(p['conversion_rate'], 2)}"
            )
        flagged = [p for p in lp["pages"] if p.get("bounce_flag")]
        if flagged:
            lines.append(f"  Bounce got worse by {lp['bounce_flag_pts']:.0f}+ pts vs {lp['compare_label']}:")
            for p in flagged[:5]:
                lines.append(f"    {p['path']}: {_pct(p['bounce_rate'])} ({p['bounce_change_pts']:+.1f} pts)")
        else:
            lines.append("  No page's bounce rate jumped vs the same day last week.")
    except Exception as exc:
        lines.append("TOP LANDING PAGES: could not load from Shopify")
        checks.append(f"Landing pages error: {str(exc)[:120]}")
    lines.append("")

    # 4. Payments
    try:
        ce = fetch_cart_extras(db, store, days=7, period="yesterday")
        p = ce.get("payments")
        lines.append("PAYMENTS")
        if not p or not p.get("attempts"):
            lines.append("  Not out yet - Shopify hasn't published payment data for this day.")
        else:
            lines.append(
                f"  Success rate {_pct(p['authorization_rate'])} ({p['successful']:,} of {p['attempts']:,} purchase attempts) · "
                f"{p['failed_attempts']} failed attempts"
            )
            for row in p["methods"][:3]:
                lines.append(f"  {row['label']}: {_pct(row['share_of_payments'])} of payments, {_pct(row['authorization_rate'])} success")
        ovals = ce.get("order_values") or {}
        if ovals.get("orders"):
            lines.append(f"  Order value: average {_money(ovals['average'], cur)}, median {_money(ovals['median'], cur)}")
    except Exception as exc:
        lines.append("PAYMENTS: could not load")
        checks.append(f"Payments error: {str(exc)[:120]}")
    lines.append("")

    # 5. Data check
    open_alerts = (
        db.query(models.AlertHistory)
        .filter(
            models.AlertHistory.store_id == store.id,
            models.AlertHistory.resolved_at.is_(None),
            models.AlertHistory.status != "resolved",
        )
        .count()
    )
    if open_alerts:
        checks.append(f"{open_alerts} open alert(s) on the dashboard.")
    lines.append("DATA CHECK")
    if checks:
        lines += [f"  ! {c}" for c in checks]
    else:
        lines.append("  OK - orders synced, sessions and orders present, no open alerts.")
    lines += ["", "Dashboard: https://cro-automation-1.onrender.com/", "Sent automatically by Ridhi Pulse."]

    subject = f"Ridhi Pulse daily numbers - {day_label.split('(')[-1].split(',')[0] if '(' in day_label else day_label}"
    return subject, "\n".join(lines)


# ---------------------------------------------------------------------------
# send once a day
# ---------------------------------------------------------------------------

def _already_sent(db: Session, store: models.Store, day) -> bool:
    return (
        db.query(models.DailyReportLog)
        .filter(models.DailyReportLog.store_id == store.id, models.DailyReportLog.report_date == day)
        .first()
        is not None
    )


def send_daily_report(db: Session, store: models.Store, force: bool = False, to: list[str] | None = None) -> dict:
    """Build and send the report for yesterday (store time). force=True ignores the once-a-day log."""
    from overview import _tz

    day = datetime.now(_tz(store)).date() - timedelta(days=1)
    if not force and _already_sent(db, store, day):
        return {"status": "skipped", "reason": f"already sent for {day}"}
    if not os.getenv("SMTP_HOST"):
        return {"status": "error", "detail": "SMTP_HOST is not set"}
    if not (to or recipients()):
        return {"status": "error", "detail": "DAILY_REPORT_TO is not set"}
    subject, body = build_report(db, store)
    ok, detail = _send(subject, body, to or recipients())
    if ok and not force:
        db.add(models.DailyReportLog(store_id=store.id, report_date=day, recipients=", ".join(to or recipients())))
        db.commit()
    return {"status": "sent" if ok else "error", "detail": detail, "report_date": day.isoformat(), "subject": subject,
            "preview": body}


def maybe_send_daily_report(db: Session, store: models.Store) -> dict:
    """Called by the scheduler every run: sends once a day, at/after the set UTC time."""
    if os.getenv("DAILY_REPORT_ENABLED", "true").lower() == "false":
        return {"status": "disabled"}
    if not os.getenv("SMTP_HOST") or not recipients():
        return {"status": "not_configured"}
    h, m = _send_time_utc()
    now = datetime.now(timezone.utc)
    if (now.hour, now.minute) < (h, m):
        return {"status": "waiting", "send_at_utc": f"{h:02d}:{m:02d}"}
    return send_daily_report(db, store)
