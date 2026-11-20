
from sqlalchemy import Column, Integer, String, DateTime, Date, Boolean, Float, ForeignKey, Text, UniqueConstraint
from sqlalchemy.sql import func


from database import Base


class Store(Base):
    __tablename__ = "stores"

    id = Column(Integer, primary_key=True, index=True)
    store_name = Column(String(255), nullable=False)
    platform = Column(String(50), default="shopify")
    store_url = Column(String(255), unique=True, nullable=True)

    access_token_encrypted = Column(Text, nullable=True)
    refresh_token_encrypted = Column(Text, nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)
    refresh_token_expires_at = Column(DateTime(timezone=True), nullable=True)
    scopes = Column(Text, nullable=True)
    timezone = Column(String(64), nullable=True)
    currency = Column(String(10), nullable=True)
    last_synced_at = Column(DateTime(timezone=True), nullable=True)
    notification_email = Column(String(255), nullable=True)
    email_alerts_enabled = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"))
    product_name = Column(String(255), nullable=False)
    category = Column(String(100))
    sku = Column(String(100), unique=True, nullable=True)
    shopify_product_id = Column(String(64), nullable=True)
    product_type = Column(String(255), nullable=True)
    tags = Column(Text, nullable=True)
    # URL handle (/products/<handle>) - used to match Microsoft Clarity page
    # views to the product.
    handle = Column(String(255), nullable=True, index=True)


class Order(Base):
    __tablename__ = "orders"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"))
    order_number = Column(String(100), unique=True, nullable=False)
    total_amount = Column(Float, default=0)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    shopify_order_id = Column(String(64), nullable=True)
    financial_status = Column(String(50), nullable=True)
    cancelled_at = Column(DateTime(timezone=True), nullable=True)
    currency = Column(String(10), nullable=True)
    # "Total sales breakdown" (manager's ask to mirror Shopify's own Analytics
    # page): subtotal = line items after discount, before shipping/tax.
    subtotal_amount = Column(Float, default=0)
    total_discounts = Column(Float, default=0)
    total_shipping = Column(Float, default=0)
    total_tax = Column(Float, default=0)
    total_refunded = Column(Float, default=0)

class OrderItem(Base):
    __tablename__ = "order_items"

    id = Column(Integer, primary_key=True, index=True)
    order_id = Column(Integer, ForeignKey("orders.id"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id"), nullable=False)
    quantity = Column(Integer, default=1)
    unit_price = Column(Float, default=0)


class AlarmRule(Base):
    __tablename__ = "alarm_rules"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text)
    threshold = Column(Float)
    is_active = Column(Boolean, default=True)
    last_checked_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class ChangeLogEntry(Base):
    """
    Manager checklist section 8, P1: "Change log: date, change, area (theme,
    app, price, promo, ad), owner" + markers on trend charts. This is a manual
    log (the team records what they changed) - there's no automatic Shopify
    "theme/price/promo changed" feed we can sync, so entries are typed in.
    """
    __tablename__ = "change_log_entries"

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    entry_date = Column(Date, nullable=False, index=True)
    change = Column(Text, nullable=False)
    area = Column(String(50), nullable=False, default="other")  # theme, app, price, promo, ad, other
    owner = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class AlertHistory(Base):
    __tablename__ = "alert_history"

    id = Column(Integer, primary_key=True, index=True)
    alarm_rule_id = Column(Integer, ForeignKey("alarm_rules.id"))
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=True, index=True)
    message = Column(Text, nullable=False)
    status = Column(String(50), default="pending")
    triggered_at = Column(DateTime(timezone=True), server_default=func.now())
    resolved_at = Column(DateTime(timezone=True), nullable=True)


class ClarityProductDay(Base):
    """
    One day of product-page traffic from Microsoft Clarity (Data Export API).
    Clarity only gives the last 1-3 days and 10 calls a day, so we save one
    snapshot per day and build the 28-day picture from these rows.
    sessions = human sessions that opened this product page (bots removed).
    """
    __tablename__ = "clarity_product_days"
    __table_args__ = (UniqueConstraint("store_id", "day", "handle", name="ux_clarity_product_day"),)

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    day = Column(Date, nullable=False, index=True)
    handle = Column(String(255), nullable=False)
    sessions = Column(Integer, default=0)
    bot_sessions = Column(Integer, default=0)
    fetched_at = Column(DateTime(timezone=True), server_default=func.now())


class DailyReportLog(Base):
    """One row per daily numbers email sent, so it never goes out twice."""
    __tablename__ = "daily_report_log"
    __table_args__ = (UniqueConstraint("store_id", "report_date", name="ux_daily_report_day"),)

    id = Column(Integer, primary_key=True, index=True)
    store_id = Column(Integer, ForeignKey("stores.id"), nullable=False, index=True)
    report_date = Column(Date, nullable=False)
    recipients = Column(Text, nullable=True)
    sent_at = Column(DateTime(timezone=True), server_default=func.now())
