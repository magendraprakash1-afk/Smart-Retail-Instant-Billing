# Smart-Retail-Instant-Billing (QuickBill Pro)

A high-speed retail Point-of-Sale (POS) and inventory management web application with **built-in SQLite 3 database engine**, **customer product ordering**, **message-first digital billing (WhatsApp & SMS)**, and **real-time stock synchronization**.

---

## 🗄️ 1. SQLite 3 Database Architecture

The software is powered by a real **SQLite 3 WebAssembly engine** (`lib/sql-wasm.js` and `lib/sql-wasm.wasm`), requiring zero server setup:

### Database Tables:
1. **`products`**:
   `id`, `name`, `sku` (UNIQUE), `category`, `price`, `cost`, `stock`, `min_stock_alert`, `unit`, `description`
2. **`orders`**:
   `id`, `bill_number` (UNIQUE), `customer_name`, `customer_phone`, `notes`, `subtotal`, `discount_percent`, `discount_amount`, `tax_rate`, `tax_amount`, `grand_total`, `payment_method`, `order_date`, `order_time`, `status`, `whatsapp_dispatched`, `sms_dispatched`, `created_at`
3. **`order_items`**:
   `id` (AUTOINCREMENT), `order_id` (FK), `product_id` (FK), `name`, `sku`, `unit`, `price`, `quantity`, `total`
4. **`supplier_purchase_orders`**:
   `id`, `po_number` (UNIQUE), `supplier_name`, `product_id`, `product_name`, `quantity`, `cost_per_unit`, `total_cost`, `status`, `created_at`, `expected_date`, `received_at`
5. **`stock_logs`**:
   `id`, `timestamp`, `date_str`, `time_str`, `action_type`, `product_id`, `product_name`, `delta`, `new_stock`, `reference_id`, `details`

### SQLite Database Features:
- **ACID Transactions**: Orders and stock decrements are processed in atomic SQLite transactions (`BEGIN TRANSACTION`, `COMMIT`, `ROLLBACK`).
- **Interactive SQL Console**: Run queries like `SELECT * FROM products ORDER BY stock ASC;` directly in the new **🗄️ SQLite Database** tab.
- **Export `.sqlite` Database**: Download the real binary SQLite database file (`billing_database.sqlite`) to inspect in DB Browser for SQLite, DBeaver, or SQLite CLI.
- **Import `.sqlite` File**: Upload any existing `.sqlite` or `.db` database.
- **Offline Ready**: The SQLite WebAssembly binaries are stored locally in [`lib/`](file:///d:/billing/lib/).
- **SQL Schema File**: See [schema.sql](file:///d:/billing/schema.sql) for pure SQL schema statements.
- **Python Backend**: See [database.py](file:///d:/billing/database.py) for a standalone Python SQLite 3 CLI.

---

## 🛒 2. How to Order Products

The software supports product ordering in three distinct ways:

### A. Ordering Products for a Customer (Sales Order):
1. Navigate to the **Order & POS** tab (`F1`).
2. Click **"🛒 Order"** on any product in the catalog to add it to the active order cart.
3. Adjust the quantity stepper (stock validation ensures you cannot exceed available SQLite stock).
4. Enter the customer's mobile number and name.
5. Click **"⚡ Place Order & Send Bill via Message"** (or press `F8`).
6. The system executes an atomic SQLite transaction:
   - Inserts order record into `orders`
   - Inserts item records into `order_items`
   - Deducts quantities from `products.stock`
   - Logs entry in `stock_logs`
7. The **Message Dispatch Modal** opens immediately with:
   - **WhatsApp Message**: Formatted with store branding, emoji headers, itemized totals, and one-click chat link (`https://api.whatsapp.com/send?phone=...&text=...`).
   - **SMS Message**: Compact SMS layout with quick delivery protocol (`sms:...`).
   - **Digital E-Receipt Card**: Electronic receipt card with barcode and verified stamp.

### B. Ordering Stock from Suppliers (Replenishing Low Stock):
1. In the **Inventory & Stocks** tab, click **"📦 Order Stock from Supplier"** (or click **"Order Stock"** next to any low-stock product in the table).
2. Choose the product, specify the supplier name (e.g. *Central Wholesale Logistics*), order quantity, cost price, and expected delivery date.
3. Click **Create Supplier Purchase Order**.
4. The purchase order is saved in the SQLite `supplier_purchase_orders` table.
5. When the supplier delivers the items, click **"📥 Mark as Received"**. The system automatically increments `products.stock` in the SQLite database and records the restock in the audit log!

### C. Sorting / Ordering the Product Catalog:
Use the **"Sort By"** dropdown in the POS catalog or Inventory tab:
- **Product Name (A-Z)**: `SELECT * FROM products ORDER BY name ASC;`
- **Product Name (Z-A)**: `SELECT * FROM products ORDER BY name DESC;`
- **Price (Low to High)**: `SELECT * FROM products ORDER BY price ASC;`
- **Price (High to Low)**: `SELECT * FROM products ORDER BY price DESC;`
- **Stock (Lowest First)**: Quickly find items running out of stock.
- **Stock (Highest First)**: See best-stocked items.
- **Category**: Group by Electronics, Groceries, Apparel, Lifestyle.

---

## 🚀 How to Run

1. Open File Explorer to `d:\billing`.
2. Double-click [index.html](file:///d:/billing/index.html) to open in your browser.
3. Everything is loaded and ready!
