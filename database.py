"""
QuickBill Pro - Native SQLite 3 Database Manager (Python CLI Backend)
Uses standard library sqlite3 to manage billing database, products, and customer orders.
"""

import sys
import os
import sqlite3
import json
from datetime import datetime

DB_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "billing.sqlite")

def get_connection():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

def init_database():
    """Initializes tables and seeds starting products."""
    conn = get_connection()
    cursor = conn.cursor()

    cursor.executescript("""
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sku TEXT UNIQUE NOT NULL,
            category TEXT NOT NULL,
            price REAL NOT NULL,
            cost REAL DEFAULT 0,
            stock INTEGER NOT NULL DEFAULT 0,
            min_stock_alert INTEGER DEFAULT 5,
            unit TEXT DEFAULT 'pcs',
            description TEXT
        );

        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            bill_number TEXT UNIQUE NOT NULL,
            customer_name TEXT NOT NULL,
            customer_phone TEXT,
            notes TEXT,
            subtotal REAL NOT NULL,
            discount_percent REAL DEFAULT 0,
            discount_amount REAL DEFAULT 0,
            tax_rate REAL DEFAULT 0,
            tax_amount REAL DEFAULT 0,
            grand_total REAL NOT NULL,
            payment_method TEXT NOT NULL,
            order_date TEXT NOT NULL,
            order_time TEXT NOT NULL,
            status TEXT DEFAULT 'COMPLETED',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            product_id TEXT NOT NULL,
            name TEXT NOT NULL,
            sku TEXT NOT NULL,
            unit TEXT DEFAULT 'pcs',
            price REAL NOT NULL,
            quantity INTEGER NOT NULL,
            total REAL NOT NULL,
            FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
            FOREIGN KEY (product_id) REFERENCES products(id)
        );

        CREATE TABLE IF NOT EXISTS supplier_purchase_orders (
            id TEXT PRIMARY KEY,
            po_number TEXT UNIQUE NOT NULL,
            supplier_name TEXT NOT NULL,
            product_id TEXT NOT NULL,
            product_name TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            cost_per_unit REAL NOT NULL,
            total_cost REAL NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expected_date TEXT,
            received_at TEXT
        );

        CREATE TABLE IF NOT EXISTS stock_logs (
            id TEXT PRIMARY KEY,
            timestamp TEXT NOT NULL,
            date_str TEXT NOT NULL,
            time_str TEXT NOT NULL,
            action_type TEXT NOT NULL,
            product_id TEXT,
            product_name TEXT,
            delta INTEGER NOT NULL,
            new_stock INTEGER NOT NULL,
            reference_id TEXT,
            details TEXT
        );
    """)

    # Seed products if empty
    cursor.execute("SELECT COUNT(*) FROM products")
    if cursor.fetchone()[0] == 0:
        sample_products = [
            ('prod-101', 'Apple iPhone 15 (128GB - Midnight)', 'ELEC-IPH-15', 'Electronics', 74900, 67000, 14, 5, 'pcs', 'Dynamic Island, 48MP camera, USB-C'),
            ('prod-102', 'Sony WH-1000XM5 Wireless Headphones', 'ELEC-SNY-XM5', 'Electronics', 26990, 21500, 8, 3, 'pcs', 'Industry-leading noise cancellation'),
            ('prod-103', 'Logitech MX Master 3S Mouse', 'ELEC-LOG-MX3', 'Electronics', 8995, 7200, 22, 6, 'pcs', 'Ergonomic quiet click 8K DPI sensor'),
            ('prod-104', 'Organic Arabica Coffee Beans (500g)', 'GROC-COF-001', 'Groceries', 650, 420, 35, 10, 'pkts', 'Single-origin medium dark roast'),
            ('prod-105', 'Extra Virgin Olive Oil (1 Litre)', 'GROC-OIL-002', 'Groceries', 1150, 880, 4, 6, 'btl', 'Cold-pressed Mediterranean harvest'),
            ('prod-106', 'SanDisk 1TB Extreme Portable SSD', 'ELEC-SSD-1TB', 'Electronics', 10499, 8500, 2, 4, 'pcs', '1050MB/s NVMe USB 3.2 Gen 2'),
            ('prod-107', 'Premium Cotton Oxford Shirt (Size L)', 'APPR-SHRT-01', 'Apparel', 1899, 1100, 19, 5, 'pcs', '100% breathable premium combed cotton'),
            ('prod-108', 'Stainless Steel Insulated Flask (750ml)', 'LIF-BTL-750', 'Lifestyle', 899, 490, 28, 8, 'pcs', '24hr cold / 12hr hot thermal insulation'),
            ('prod-109', 'Almonds Premium California (1kg)', 'GROC-ALM-1KG', 'Groceries', 920, 710, 1, 5, 'pkts', 'Crisp, vacuum-packed raw almonds'),
            ('prod-110', 'Type-C Braided Fast Charging Cable (2m)', 'ELEC-CBL-02M', 'Electronics', 499, 180, 0, 5, 'pcs', '100W PD Power Delivery nylon braided')
        ]
        cursor.executemany("""
            INSERT INTO products (id, name, sku, category, price, cost, stock, min_stock_alert, unit, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, sample_products)

        now = datetime.now()
        cursor.execute("""
            INSERT INTO stock_logs (id, timestamp, date_str, time_str, action_type, product_name, delta, new_stock, reference_id, details)
            VALUES ('log-init', ?, ?, ?, 'SYSTEM_INIT', 'Initial Catalog', 0, 131, 'INIT', 'Seeded products in SQLite')
        """, (now.isoformat(), now.strftime("%b %d, %Y"), now.strftime("%H:%M:%S")))

    conn.commit()
    conn.close()
    print(f"✅ SQLite Database initialized at: {DB_FILE}")

def list_products(order_by="name ASC"):
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute(f"SELECT id, name, sku, category, price, stock, unit FROM products ORDER BY {order_by}")
    rows = cursor.fetchall()
    conn.close()

    print("\n" + "="*85)
    print(f"{'ID':<12} {'SKU':<15} {'PRODUCT NAME':<35} {'PRICE':<10} {'STOCK':<10}")
    print("="*85)
    for r in rows:
        print(f"{r['id']:<12} {r['sku']:<15} {r['name'][:33]:<35} ₹{r['price']:<9} {r['stock']} {r['unit']}")
    print("="*85 + "\n")

def order_product(product_id, quantity, customer_name="Customer", customer_phone=""):
    """Places an order for a product, atomically decrements stock in SQLite, and logs sale."""
    conn = get_connection()
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT * FROM products WHERE id = ? OR sku = ?", (product_id, product_id))
        prod = cursor.fetchone()
        if not prod:
            print(f"❌ Error: Product '{product_id}' not found.")
            return

        qty = int(quantity)
        if prod['stock'] < qty:
            print(f"❌ Error: Insufficient stock. Requested: {qty}, Available: {prod['stock']}")
            return

        # Start transaction
        order_id = f"ord-{int(datetime.now().timestamp()*1000)}"
        bill_num = f"QB-{datetime.now().strftime('%y%m%d')}-{order_id[-4:]}"
        now = datetime.now()
        subtotal = prod['price'] * qty
        grand_total = subtotal

        cursor.execute("""
            INSERT INTO orders (id, bill_number, customer_name, customer_phone, subtotal, grand_total, payment_method, order_date, order_time, created_at)
            VALUES (?, ?, ?, ?, ?, ?, 'Cash', ?, ?, ?)
        """, (order_id, bill_num, customer_name, customer_phone, subtotal, grand_total, now.strftime("%b %d, %Y"), now.strftime("%H:%M"), now.isoformat()))

        cursor.execute("""
            INSERT INTO order_items (order_id, product_id, name, sku, unit, price, quantity, total)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (order_id, prod['id'], prod['name'], prod['sku'], prod['unit'], prod['price'], qty, subtotal))

        # Decrement stock
        cursor.execute("UPDATE products SET stock = stock - ? WHERE id = ?", (qty, prod['id']))

        new_stock = prod['stock'] - qty
        cursor.execute("""
            INSERT INTO stock_logs (id, timestamp, date_str, time_str, action_type, product_id, product_name, delta, new_stock, reference_id, details)
            VALUES (?, ?, ?, ?, 'BILL_SALE', ?, ?, ?, ?, ?, ?)
        """, (f"log-{now.timestamp()}", now.isoformat(), now.strftime("%b %d, %Y"), now.strftime("%H:%M:%S"),
              prod['id'], prod['name'], -qty, new_stock, bill_num, f"Ordered {qty} {prod['unit']} for {customer_name}"))

        conn.commit()
        print(f"🎉 Order placed successfully!")
        print(f"   Bill Number: #{bill_num}")
        print(f"   Product:     {prod['name']} (Qty: {qty} {prod['unit']})")
        print(f"   Total:       ₹{grand_total:,.2f}")
        print(f"   New Stock:   {new_stock} {prod['unit']} (Reduced by {qty})")
        print(f"   Customer:    {customer_name} ({customer_phone})")
    except Exception as e:
        conn.rollback()
        print(f"❌ Transaction failed: {e}")
    finally:
        conn.close()

def supplier_order(product_id, quantity, supplier_name="Wholesale Supply Co"):
    """Orders new stock from supplier."""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM products WHERE id = ? OR sku = ?", (product_id, product_id))
    prod = cursor.fetchone()
    if not prod:
        print(f"❌ Product not found.")
        return

    po_id = f"po-{int(datetime.now().timestamp()*1000)}"
    po_num = f"PO-{datetime.now().strftime('%y%m%d')}-{po_id[-3:]}"
    now = datetime.now()
    cost = prod['cost'] or (prod['price'] * 0.75)
    total_cost = cost * int(quantity)

    cursor.execute("""
        INSERT INTO supplier_purchase_orders (id, po_number, supplier_name, product_id, product_name, quantity, cost_per_unit, total_cost, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
    """, (po_id, po_num, supplier_name, prod['id'], prod['name'], int(quantity), cost, total_cost, now.isoformat()))

    conn.commit()
    conn.close()
    print(f"📦 Supplier Purchase Order created: #{po_num} for {quantity} {prod['unit']} of {prod['name']}")

def execute_sql(query):
    conn = get_connection()
    cursor = conn.cursor()
    try:
        cursor.execute(query)
        if query.strip().upper().startswith("SELECT"):
            rows = cursor.fetchall()
            print(f"Results ({len(rows)} rows):")
            for r in rows:
                print(dict(r))
        else:
            conn.commit()
            print(f"Query executed successfully. Rows affected: {cursor.rowcount}")
    except Exception as e:
        print(f"SQL Error: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    if len(sys.argv) < 2:
        init_database()
        list_products()
        print("Usage:")
        print("  python database.py init")
        print("  python database.py list-products [ORDER_BY]")
        print("  python database.py order-product <PRODUCT_ID_OR_SKU> <QTY> [CUSTOMER_NAME] [PHONE]")
        print("  python database.py supplier-order <PRODUCT_ID> <QTY> [SUPPLIER_NAME]")
        print("  python database.py sql \"<QUERY>\"")
        sys.exit(0)

    cmd = sys.argv[1].lower()
    if cmd == "init":
        init_database()
    elif cmd == "list-products":
        order_by = sys.argv[2] if len(sys.argv) > 2 else "name ASC"
        list_products(order_by)
    elif cmd == "order-product":
        if len(sys.argv) < 4:
            print("Usage: python database.py order-product <prod_id_or_sku> <qty> [customer_name] [phone]")
        else:
            cust = sys.argv[4] if len(sys.argv) > 4 else "Customer"
            phone = sys.argv[5] if len(sys.argv) > 5 else ""
            order_product(sys.argv[2], sys.argv[3], cust, phone)
    elif cmd == "supplier-order":
        if len(sys.argv) < 4:
            print("Usage: python database.py supplier-order <prod_id> <qty> [supplier_name]")
        else:
            supp = sys.argv[4] if len(sys.argv) > 4 else "Wholesale Co"
            supplier_order(sys.argv[2], sys.argv[3], supp)
    elif cmd == "sql":
        if len(sys.argv) < 3:
            print("Usage: python database.py sql \"SELECT * FROM products;\"")
        else:
            execute_sql(sys.argv[2])
    else:
        print(f"Unknown command: {cmd}")
