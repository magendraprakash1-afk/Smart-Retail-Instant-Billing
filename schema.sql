-- ======================================================================
-- QuickBill Pro - Complete SQLite 3 Database Schema & Seed Data
-- Compatible with SQLite 3, DB Browser for SQLite, DBeaver, and SQL.js
-- ======================================================================

PRAGMA foreign_keys = ON;

-- 1. Products & Inventory Table
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
    description TEXT,
    expiry_date TEXT,
    batch_no TEXT
);

-- 2. Customer Sales Orders / Invoices Table
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
    whatsapp_dispatched INTEGER DEFAULT 0,
    sms_dispatched INTEGER DEFAULT 0,
    created_at TEXT NOT NULL
);

-- 3. Order Line Items Table
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

-- 4. Supplier Purchase Orders (Re-ordering stock from vendors)
CREATE TABLE IF NOT EXISTS supplier_purchase_orders (
    id TEXT PRIMARY KEY,
    po_number TEXT UNIQUE NOT NULL,
    supplier_name TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    cost_per_unit REAL NOT NULL,
    total_cost REAL NOT NULL,
    status TEXT NOT NULL, -- 'PENDING' | 'RECEIVED' | 'CANCELLED'
    created_at TEXT NOT NULL,
    expected_date TEXT,
    received_at TEXT
);

-- 5. Inventory Stock Movement Audit Ledger
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

-- 6. StockSense Historical Records Table (Imported from Excel file)
CREATE TABLE IF NOT EXISTS stock_history_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    record_date TEXT,
    sku TEXT,
    product_name TEXT,
    category TEXT,
    brand TEXT,
    warehouse TEXT,
    opening_stock INTEGER,
    stock_received INTEGER,
    units_sold INTEGER,
    current_stock INTEGER,
    reorder_level INTEGER,
    unit_price REAL,
    stock_value REAL,
    sales_value REAL,
    stock_status TEXT
);

-- ======================================================================
-- Seed Master Product Catalog (from StockSense Excel Data)
-- ======================================================================

INSERT OR REPLACE INTO products (id, name, sku, category, price, cost, stock, min_stock_alert, unit, description) VALUES
('prod-sku1001', 'Wireless Mouse', 'SKU-1001', 'Accessories', 18.5, 12.95, 47, 17, 'pcs', 'TechPro Wireless Mouse (Chennai Hub)'),
('prod-sku1012', 'HDMI Cable 2m', 'SKU-1012', 'Cables', 8.99, 6.29, 14, 33, 'pcs', 'ConnectX HDMI Cable 2m (Chennai Hub)'),
('prod-sku1002', 'Mechanical Keyboard', 'SKU-1002', 'Accessories', 64.0, 44.8, 137, 33, 'pcs', 'KeyWorks Mechanical Keyboard (Bengaluru Hub)'),
('prod-sku1013', 'Desk Lamp', 'SKU-1013', 'Office', 22.0, 15.4, 57, 23, 'pcs', 'BrightSpace Desk Lamp (Coimbatore Main)'),
('prod-sku1003', 'USB-C Hub', 'SKU-1003', 'Accessories', 32.75, 22.92, 70, 34, 'pcs', 'ConnectX USB-C Hub (Coimbatore Main)'),
('prod-sku1014', 'Notebook Pack', 'SKU-1014', 'Office', 6.5, 4.55, 165, 35, 'pcs', 'PaperMate Notebook Pack (Chennai Hub)'),
('prod-sku1004', '27-inch Monitor', 'SKU-1004', 'Displays', 219.0, 153.3, 80, 13, 'pcs', 'ViewMax 27-inch Monitor (Bengaluru Hub)'),
('prod-sku1015', 'Bluetooth Speaker', 'SKU-1015', 'Audio', 55.0, 38.5, 97, 17, 'pcs', 'SoundWave Bluetooth Speaker (Bengaluru Hub)'),
('prod-sku1005', 'Laptop Stand', 'SKU-1005', 'Accessories', 29.99, 20.99, 128, 26, 'pcs', 'ErgoDesk Laptop Stand (Coimbatore Main)'),
('prod-sku1006', 'Webcam HD', 'SKU-1006', 'Peripherals', 48.5, 33.95, 145, 19, 'pcs', 'ClearView Webcam HD (Chennai Hub)'),
('prod-sku1007', 'Headset', 'SKU-1007', 'Peripherals', 39.0, 27.3, 102, 18, 'pcs', 'SoundWave Headset (Coimbatore Main)'),
('prod-sku1008', 'External SSD 1TB', 'SKU-1008', 'Storage', 89.0, 62.3, 107, 14, 'pcs', 'DataCore External SSD 1TB (Chennai Hub)'),
('prod-sku1009', 'Ethernet Adapter', 'SKU-1009', 'Networking', 14.25, 9.98, 105, 28, 'pcs', 'ConnectX Ethernet Adapter (Bengaluru Hub)'),
('prod-sku1010', 'Power Bank', 'SKU-1010', 'Power', 27.5, 19.25, 146, 29, 'pcs', 'VoltPlus Power Bank (Chennai Hub)'),
('prod-sku1011', 'Laptop Backpack', 'SKU-1011', 'Bags', 44.0, 30.8, 99, 20, 'pcs', 'CarryWell Laptop Backpack (Bengaluru Hub)');

INSERT OR IGNORE INTO stock_logs (id, timestamp, date_str, time_str, action_type, product_name, delta, new_stock, reference_id, details) VALUES
('log-init', datetime('now'), date('now'), time('now'), 'EXCEL_IMPORT', 'StockSense Catalog', 180, 1399, 'STOCKSENSE-IMPORT', 'Imported 180 inventory snapshots and 15 master products from StockSense Excel file (No server upload)');
