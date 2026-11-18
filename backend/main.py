import models
from shopify_routes import router as shopify_router
from dashboard_routes import router as dashboard_router
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi import Depends
from sqlalchemy.orm import Session
from quilt_alarm import check_quilt_alarm
from sqlalchemy import text
from dependencies import get_db
from api_key import api_key_dependency

app = FastAPI(
    title="CRO Automation API",
    description="Backend API for CRO monitoring and automation",
    version="1.0.0",
    dependencies=[api_key_dependency],
)
app.include_router(shopify_router)
app.include_router(dashboard_router)

from scheduler import start_scheduler, stop_scheduler
import scheduler as cro_scheduler
from run_migrations import run_migrations


@app.on_event("startup")
def _start_background_jobs():
    run_migrations()
    start_scheduler()


@app.on_event("shutdown")
def _stop_background_jobs():
    stop_scheduler()


@app.get("/scheduler/status")
def scheduler_status():
    return {"interval_minutes": cro_scheduler.INTERVAL_MINUTES, "last_run": cro_scheduler.last_run}

# Allow React frontend to communicate with backend
import os
from dotenv import load_dotenv

load_dotenv()

FRONTEND_ORIGINS = os.getenv(
    "FRONTEND_ORIGINS",
    "http://localhost:5173"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return {
        "message": "CRO Automation Backend is running!",
        "status": "success"
    }

@app.get("/health")
def health_check():
    return {
        "status": "healthy",
        "service": "CRO Automation API"
    }
@app.get("/db-check")
def db_check(db: Session = Depends(get_db)):
    result = db.execute(text("SELECT 1"))

    return {
        "database": "connected",
        "result": result.scalar()
    }
@app.post("/stores")
def create_store(
    store_name: str,
    store_url: str,
    db: Session = Depends(get_db)
):
    new_store = models.Store(
        store_name=store_name,
        store_url=store_url
    )

    db.add(new_store)
    db.commit()
    db.refresh(new_store)

    return {
        "message": "Store created successfully",
        "id": new_store.id,
        "store_name": new_store.store_name,
        "store_url": new_store.store_url
    }
@app.get("/stores")
def get_stores(db: Session = Depends(get_db)):
    stores = db.query(models.Store).all()

    return stores
@app.post("/products")
def create_product(
    store_id: int,
    product_name: str,
    category: str,
    sku: str,
    db: Session = Depends(get_db)
):
    new_product = models.Product(
        store_id=store_id,
        product_name=product_name,
        category=category,
        sku=sku
    )

    db.add(new_product)
    db.commit()
    db.refresh(new_product)

    return {
        "message": "Product created successfully",
        "id": new_product.id,
        "product_name": new_product.product_name
    }
@app.get("/products")
def get_products(db: Session = Depends(get_db)):
    products = db.query(models.Product).all()

    return products

@app.post("/orders")
def create_order(
    store_id: int,
    order_number: str,
    total_amount: float,
    db: Session = Depends(get_db)
):
    new_order = models.Order(
        store_id=store_id,
        order_number=order_number,
        total_amount=total_amount
    )

    db.add(new_order)
    db.commit()
    db.refresh(new_order)

    return {
        "message": "Order created successfully",
        "id": new_order.id,
        "order_number": new_order.order_number
    }
@app.get("/orders")
def get_orders(db: Session = Depends(get_db)):
    orders = db.query(models.Order).all()

    return orders

@app.post("/order-items")
def create_order_item(
    order_id: int,
    product_id: int,
    quantity: int,
    unit_price: float,
    db: Session = Depends(get_db)
):
    new_item = models.OrderItem(
        order_id=order_id,
        product_id=product_id,
        quantity=quantity,
        unit_price=unit_price
    )

    db.add(new_item)
    db.commit()
    db.refresh(new_item)

    return {
        "message": "Order item created successfully",
        "id": new_item.id
    }
@app.get("/order-items")
def get_order_items(db: Session = Depends(get_db)):
    items = db.query(models.OrderItem).all()

    return items

@app.post("/alarm-rules")
def create_alarm_rule(
    title: str,
    description: str,
    threshold: float,
    db: Session = Depends(get_db)
):
    new_rule = models.AlarmRule(
        title=title,
        description=description,
        threshold=threshold
    )

    db.add(new_rule)
    db.commit()
    db.refresh(new_rule)

    return {
        "message": "Alarm rule created successfully",
        "id": new_rule.id,
        "title": new_rule.title
    }
@app.get("/alarm-rules")
def get_alarm_rules(db: Session = Depends(get_db)):
    rules = db.query(models.AlarmRule).all()

    return rules
@app.post("/alerts")
def create_alert(
    alarm_rule_id: int,
    message: str,
    db: Session = Depends(get_db)
):
    new_alert = models.AlertHistory(
        alarm_rule_id=alarm_rule_id,
        message=message,
        status="pending"
    )

    db.add(new_alert)
    db.commit()
    db.refresh(new_alert)

    return {
        "message": "Alert created successfully",
        "id": new_alert.id,
        "status": new_alert.status
    }
@app.get("/alerts")
def get_alerts(db: Session = Depends(get_db)):
    alerts = db.query(models.AlertHistory).all()

    return alerts
@app.post("/alarms/check/{store_id}")
def run_quilt_alarm_check(
    store_id: int,
    db: Session = Depends(get_db)
):
    result = check_quilt_alarm(db, store_id)
    return result

@app.get("/shopify-test")
def shopify_test():
    return {
        "message": "Shopify integration endpoint is ready",
        "status": "success"
    }
