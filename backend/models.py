
from sqlalchemy import Column, Integer, String, DateTime, Boolean, Float, ForeignKey, Text
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
