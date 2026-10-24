/**
 * QuickBill Pro - Real SQLite WebAssembly Database Engine
 * Powered by official SQLite 3 compiled to WebAssembly (sql.js).
 * Includes Client-Side Excel / CSV Importer (SheetJS) with Zero Server Upload.
 */

class SQLiteDatabase {
    constructor() {
        this.db = null;
        this.isInitialized = false;
        this.storageKey = 'qb_sqlite_db_binary_v1';
    }

    async init() {
        if (this.isInitialized && this.db) return true;
        try {
            console.log('Initializing SQLite 3 WebAssembly Engine...');
            const config = {};
            if (window.SQL_WASM_BASE64) {
                config.wasmBinary = this.base64ToUint8Array(window.SQL_WASM_BASE64);
            } else {
                config.locateFile = filename => `./lib/${filename}`;
            }

            let SQL;
            if (typeof initSqlJs === 'function') {
                SQL = await initSqlJs(config);
            } else if (window.initSqlJs) {
                SQL = await window.initSqlJs(config);
            } else {
                throw new Error('initSqlJs function not found');
            }

            // Check if saved SQLite database binary exists in localStorage
            const savedBinary = localStorage.getItem(this.storageKey);
            if (savedBinary) {
                try {
                    const u8arr = this.base64ToUint8Array(savedBinary);
                    this.db = new SQL.Database(u8arr);
                    this.createSchema();
                    console.log('Loaded existing SQLite database from local binary storage.');
                } catch (e) {
                    console.warn('Failed to load binary SQLite storage, creating fresh database:', e);
                    this.db = new SQL.Database();
                    this.createSchema();
                    this.seedInitialData();
                }
            } else {
                this.db = new SQL.Database();
                this.createSchema();
                this.seedInitialData();
            }

            // Automatically check and import StockSense data if not already present
            this.ensureStockSenseDataLoaded();

            this.isInitialized = true;
            this.persist();
            console.log('SQLite 3 Database successfully initialized!');
            return true;
        } catch (error) {
            console.error('SQLite initialization failed:', error);
            return false;
        }
    }

    // --- Schema Definition ---
    createSchema() {
        if (!this.db) return;

        const schemaSQL = `
            -- Products & Inventory Table
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

            -- Customer Orders / Sales Invoices
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

            -- Order Line Items
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

            -- Supplier Purchase Orders (Re-ordering stock from vendors)
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

            -- Stock Movement Audit Ledger
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

            -- StockSense Historical Records (from Excel file)
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
        `;

        this.db.run(schemaSQL);

        // Safe table migrations for existing databases
        try { this.db.run("ALTER TABLE products ADD COLUMN expiry_date TEXT;"); } catch(e) {}
        try { this.db.run("ALTER TABLE products ADD COLUMN batch_no TEXT;"); } catch(e) {}
    }

    // --- Ensure StockSense Data Loaded into SQLite ---
    ensureStockSenseDataLoaded() {
        if (!this.db || !window.STOCKSENSE_RAW_DATA) return;
        try {
            const check = this.db.exec("SELECT COUNT(*) FROM stock_history_records");
            const count = check[0]?.values[0][0] || 0;
            if (count === 0) {
                console.log('Importing StockSense Excel dataset into SQLite...');
                this.importStockSenseDataset();
            }

            // Ensure realistic expiry dates and batch numbers exist for demonstration and analytics
            this.ensureProductExpiryAndBatches();
        } catch (e) {
            console.warn('Error checking stock_history_records:', e);
        }
    }

    ensureProductExpiryAndBatches() {
        if (!this.db) return;
        try {
            const EXPIRY_SEEDS = {
                'SKU-1013': { expiry: '2026-10-18', batch: 'LOT-2026-08A' }, // Expired 6 days ago (🔴 EXPIRED)
                'SKU-1012': { expiry: '2026-10-31', batch: 'LOT-2026-09B' }, // 7 days left (🟠 CRITICAL)
                'SKU-1001': { expiry: '2026-11-08', batch: 'LOT-2026-09K' }, // 15 days left (🟠 CRITICAL)
                'SKU-1002': { expiry: '2026-11-20', batch: 'LOT-2026-09M' }, // 27 days left (🟡 EXPIRING SOON)
                'SKU-1005': { expiry: '2026-11-14', batch: 'LOT-2026-09E' }, // 21 days left (🟡 EXPIRING SOON)
                'SKU-1007': { expiry: '2026-12-05', batch: 'LOT-2026-10A' }, // 42 days left (🔵 WATCH)
                'SKU-1008': { expiry: '2026-10-21', batch: 'LOT-2026-07H' }, // Expired 3 days ago (🔴 EXPIRED)
                'SKU-1003': { expiry: '2026-12-25', batch: 'LOT-2026-10C' }, // 62 days left
                'SKU-1009': { expiry: '2026-11-28', batch: 'LOT-2026-09J' }, // 35 days left
                'SKU-1015': { expiry: '2027-02-14', batch: 'LOT-2027-01D' }, // Safe
                'SKU-1004': { expiry: '2027-09-10', batch: 'LOT-2027-03F' }, // Safe
                'SKU-1006': { expiry: '2027-04-18', batch: 'LOT-2027-02B' }, // Safe
                'SKU-1010': { expiry: '2027-06-30', batch: 'LOT-2027-04A' }, // Safe
                'SKU-1011': { expiry: '2027-11-15', batch: 'LOT-2027-05G' }  // Safe
            };

            for (const sku in EXPIRY_SEEDS) {
                const s = EXPIRY_SEEDS[sku];
                this.db.run(
                    "UPDATE products SET expiry_date = ?, batch_no = ? WHERE (sku = ? OR id LIKE ?) AND (expiry_date IS NULL OR expiry_date = '')",
                    [s.expiry, s.batch, sku, `%${sku.toLowerCase().replace(/[^a-z0-9]/g, '')}%`]
                );
            }

            // Provide default healthy expiry for any remaining products without date
            this.db.run("UPDATE products SET expiry_date = '2027-05-20', batch_no = 'LOT-2027-STD' WHERE expiry_date IS NULL OR expiry_date = ''");
        } catch (e) {
            console.warn('Error seeding product expiry dates:', e);
        }
    }

    /**
     * Imports all 180 records from StockSense_Dashboard_Sample_Data.xlsx directly into SQLite
     * 100% in browser memory - ZERO SERVER UPLOAD.
     */
    importStockSenseDataset() {
        if (!this.db || !window.STOCKSENSE_RAW_DATA) return null;

        const records = window.STOCKSENSE_RAW_DATA;
        this.db.run("BEGIN TRANSACTION;");

        try {
            // 1. Insert history records
            const histStmt = this.db.prepare(`
                INSERT INTO stock_history_records (
                    record_date, sku, product_name, category, brand, warehouse,
                    opening_stock, stock_received, units_sold, current_stock,
                    reorder_level, unit_price, stock_value, sales_value, stock_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const r of records) {
                histStmt.run([
                    r.Date, r.SKU, r.Name, r.Category, r.Brand, r.Warehouse,
                    r.OpeningStock, r.StockReceived, r.UnitsSold, r.CurrentStock,
                    r.ReorderLevel, r.Price, r.StockValue, r.SalesValue, r.Status
                ]);
            }
            histStmt.free();

            // 2. Extract and upsert master products (using latest snapshot per SKU)
            const grouped = {};
            for (const r of records) {
                if (!grouped[r.SKU] || r.Date > grouped[r.SKU].Date) {
                    grouped[r.SKU] = r;
                }
            }

            const prodStmt = this.db.prepare(`
                INSERT OR REPLACE INTO products (
                    id, name, sku, category, price, cost, stock, min_stock_alert, unit, description
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            for (const sku in grouped) {
                const item = grouped[sku];
                const id = 'prod-' + item.SKU.toLowerCase().replace(/[^a-z0-9]/g, '');
                const cost = Math.round(item.Price * 0.7 * 100) / 100;
                prodStmt.run([
                    id,
                    item.Name,
                    item.SKU,
                    item.Category,
                    item.Price,
                    cost,
                    item.CurrentStock,
                    item.ReorderLevel,
                    'pcs',
                    `${item.Brand} ${item.Name} (${item.Warehouse})`
                ]);
            }
            prodStmt.free();

            // 3. Log stock update
            this.addStockLog({
                actionType: 'EXCEL_IMPORT',
                productName: 'StockSense Excel File',
                delta: 0,
                newStock: records.length,
                referenceId: 'STOCKSENSE-XLSX',
                details: `Imported ${records.length} inventory snapshots and ${Object.keys(grouped).length} master products from StockSense Excel file (No server upload)`
            });

            this.db.run("COMMIT;");
            this.persist();
            return {
                totalRecords: records.length,
                masterProductsCount: Object.keys(grouped).length
            };
        } catch (err) {
            this.db.run("ROLLBACK;");
            console.error('Failed to import StockSense dataset:', err);
            throw err;
        }
    }

    /**
     * Universal Client-Side Excel / CSV File Importer (SheetJS)
     * Reads and parses .xlsx, .xls, .csv files entirely in the user's browser.
     * ZERO SERVER UPLOAD.
     */
    async importExcelOrCSVFile(file) {
        if (!file) throw new Error("No file provided");

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    if (typeof XLSX === 'undefined') {
                        throw new Error("SheetJS (XLSX) library not loaded.");
                    }

                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];
                    const rows = XLSX.utils.sheet_to_json(worksheet);

                    if (!rows || rows.length === 0) {
                        throw new Error("Excel worksheet contains no data rows.");
                    }

                    console.log(`Parsed ${rows.length} rows from Excel file locally. Importing to SQLite...`);

                    this.db.run("BEGIN TRANSACTION;");

                    let importedCount = 0;
                    const histStmt = this.db.prepare(`
                        INSERT INTO stock_history_records (
                            record_date, sku, product_name, category, brand, warehouse,
                            opening_stock, stock_received, units_sold, current_stock,
                            reorder_level, unit_price, stock_value, sales_value, stock_status
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);

                    const prodStmt = this.db.prepare(`
                        INSERT OR REPLACE INTO products (
                            id, name, sku, category, price, cost, stock, min_stock_alert, unit, description
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `);

                    for (const r of rows) {
                        const sku = (r.SKU || r.sku || r.Sku || r['Product Code'] || `SKU-${Date.now().toString().slice(-4)}-${importedCount}`).toString().trim();
                        const name = (r.Product_Name || r['Product Name'] || r.Name || r.name || r.Title || 'Imported Product').toString().trim();
                        const category = (r.Category || r.category || 'General').toString().trim();
                        const brand = (r.Brand || r.brand || '').toString().trim();
                        const warehouse = (r.Warehouse || r.warehouse || 'Main').toString().trim();
                        const date = (r.Date || r.date || new Date().toISOString().slice(0, 10)).toString();
                        
                        const price = parseFloat(r.Unit_Price || r['Unit Price'] || r.Price || r.price || 0) || 0;
                        const stock = parseInt(r.Current_Stock || r['Current Stock'] || r.Stock || r.stock || r.Quantity || r.Qty || 0, 10) || 0;
                        const reorder = parseInt(r.Reorder_Level || r['Reorder Level'] || r.Min_Stock || r.minStockAlert || 5, 10) || 5;
                        const cost = parseFloat(r.Cost || r.cost || (price * 0.7)) || (price * 0.7);

                        // Save to history
                        histStmt.run([
                            date, sku, name, category, brand, warehouse,
                            parseInt(r.Opening_Stock || r.OpeningStock || 0, 10),
                            parseInt(r.Stock_Received || r.StockReceived || 0, 10),
                            parseInt(r.Units_Sold || r.UnitsSold || 0, 10),
                            stock, reorder, price,
                            parseFloat(r.Stock_Value || r.StockValue || (stock * price)),
                            parseFloat(r.Sales_Value || r.SalesValue || 0),
                            (r.Stock_Status || r.Status || (stock > 0 ? 'In Stock' : 'Out of Stock')).toString()
                        ]);

                        // Save / Update Master Product
                        const id = 'prod-' + sku.toLowerCase().replace(/[^a-z0-9]/g, '');
                        prodStmt.run([
                            id,
                            name,
                            sku,
                            category,
                            price,
                            Math.round(cost * 100) / 100,
                            stock,
                            reorder,
                            'pcs',
                            `${brand} ${name} (${warehouse})`
                        ]);

                        importedCount++;
                    }

                    histStmt.free();
                    prodStmt.free();

                    this.addStockLog({
                        actionType: 'EXCEL_IMPORT',
                        productName: file.name,
                        delta: importedCount,
                        newStock: importedCount,
                        referenceId: 'LOCAL-EXCEL',
                        details: `Client-side imported ${importedCount} rows from ${file.name} (Zero server upload)`
                    });

                    this.db.run("COMMIT;");
                    this.persist();

                    resolve({ count: importedCount, fileName: file.name });
                } catch (err) {
                    this.db.run("ROLLBACK;");
                    reject(err);
                }
            };

            reader.onerror = (err) => reject(new Error("File reading error: " + err));
            reader.readAsArrayBuffer(file);
        });
    }

    // --- Seed Initial Products (Fallback) ---
    seedInitialData() {
        const countRes = this.db.exec("SELECT COUNT(*) as count FROM products");
        const count = countRes[0]?.values[0][0] || 0;
        if (count > 0) return;

        if (window.STOCKSENSE_RAW_DATA) {
            this.importStockSenseDataset();
            return;
        }

        const initialProducts = [
            ['prod-sku1001', 'Wireless Mouse (TechPro)', 'SKU-1001', 'Accessories', 18.5, 12.95, 47, 17, 'pcs', 'TechPro Wireless Mouse'],
            ['prod-sku1012', 'HDMI Cable 2m (ConnectX)', 'SKU-1012', 'Cables', 8.99, 6.29, 14, 33, 'pcs', 'ConnectX HDMI Cable 2m'],
            ['prod-sku1002', 'Mechanical Keyboard (KeyWorks)', 'SKU-1002', 'Accessories', 64, 44.8, 137, 33, 'pcs', 'KeyWorks Mechanical Keyboard'],
            ['prod-sku1013', 'Desk Lamp (BrightSpace)', 'SKU-1013', 'Office', 22, 15.4, 57, 23, 'pcs', 'BrightSpace Desk Lamp'],
            ['prod-sku1003', 'USB-C Hub (ConnectX)', 'SKU-1003', 'Accessories', 32.75, 22.92, 70, 34, 'pcs', 'ConnectX USB-C Hub'],
            ['prod-sku1004', '27-inch Monitor (ViewMax)', 'SKU-1004', 'Displays', 219, 153.3, 80, 13, 'pcs', 'ViewMax 27-inch Monitor'],
            ['prod-sku1015', 'Bluetooth Speaker (SoundWave)', 'SKU-1015', 'Audio', 55, 38.5, 97, 17, 'pcs', 'SoundWave Bluetooth Speaker']
        ];

        const stmt = this.db.prepare(`
            INSERT INTO products (id, name, sku, category, price, cost, stock, min_stock_alert, unit, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        initialProducts.forEach(p => stmt.run(p));
        stmt.free();
    }

    // --- Persistence ---
    persist() {
        if (!this.db) return;
        try {
            const binary = this.db.export();
            const base64 = this.uint8ArrayToBase64(binary);
            localStorage.setItem(this.storageKey, base64);
        } catch (e) {
            console.error('Failed to persist SQLite database binary:', e);
        }
    }

    // --- Products CRUD (SQL) ---
    getAllProducts(orderBy = 'name ASC') {
        if (!this.db) return [];
        try {
            const allowed = ['name ASC', 'name DESC', 'price ASC', 'price DESC', 'stock ASC', 'stock DESC', 'category ASC'];
            const sortClause = allowed.includes(orderBy) ? orderBy : 'name ASC';
            
            const stmt = this.db.prepare(`SELECT * FROM products ORDER BY ${sortClause}`);
            const results = [];
            while (stmt.step()) {
                const row = stmt.getAsObject();
                results.push({
                    id: row.id,
                    name: row.name,
                    sku: row.sku,
                    category: row.category,
                    price: row.price,
                    cost: row.cost,
                    stock: row.stock,
                    minStockAlert: row.min_stock_alert,
                    unit: row.unit,
                    description: row.description,
                    expiryDate: row.expiry_date || '',
                    batchNo: row.batch_no || ''
                });
            }
            stmt.free();
            return results;
        } catch (err) {
            console.error('SQL query error getAllProducts:', err);
            return [];
        }
    }

    getProductById(id) {
        if (!this.db) return null;
        const stmt = this.db.prepare("SELECT * FROM products WHERE id = ? OR sku = ?");
        stmt.bind([id, id]);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return {
                id: row.id,
                name: row.name,
                sku: row.sku,
                category: row.category,
                price: row.price,
                cost: row.cost,
                stock: row.stock,
                minStockAlert: row.min_stock_alert,
                unit: row.unit,
                description: row.description,
                expiryDate: row.expiry_date || '',
                batchNo: row.batch_no || ''
            };
        }
        stmt.free();
        return null;
    }

    addProduct(prod) {
        if (!this.db) return null;
        const id = 'prod-' + Date.now().toString().slice(-6);
        const stmt = this.db.prepare(`
            INSERT INTO products (id, name, sku, category, price, cost, stock, min_stock_alert, unit, description, expiry_date, batch_no)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        stmt.run([
            id,
            prod.name.trim(),
            prod.sku.trim().toUpperCase(),
            prod.category.trim() || 'General',
            Number(prod.price) || 0,
            Number(prod.cost) || 0,
            parseInt(prod.stock, 10) || 0,
            parseInt(prod.minStockAlert, 10) || 5,
            prod.unit?.trim() || 'pcs',
            prod.description?.trim() || '',
            prod.expiryDate || '',
            prod.batchNo || ''
        ]);
        stmt.free();

        this.addStockLog({
            actionType: 'PRODUCT_CREATED',
            productId: id,
            productName: prod.name,
            delta: prod.stock,
            newStock: prod.stock,
            referenceId: prod.sku,
            details: `Created product with ${prod.stock} ${prod.unit} initial stock (Exp: ${prod.expiryDate || 'N/A'})`
        });

        this.persist();
        return this.getProductById(id);
    }

    updateProduct(id, updates) {
        if (!this.db) return null;
        const current = this.getProductById(id);
        if (!current) return null;

        const updated = {
            ...current,
            ...updates,
            price: Number(updates.price !== undefined ? updates.price : current.price),
            cost: Number(updates.cost !== undefined ? updates.cost : current.cost),
            stock: parseInt(updates.stock !== undefined ? updates.stock : current.stock, 10),
            minStockAlert: parseInt(updates.minStockAlert !== undefined ? updates.minStockAlert : current.minStockAlert, 10),
            expiryDate: updates.expiryDate !== undefined ? updates.expiryDate : current.expiryDate,
            batchNo: updates.batchNo !== undefined ? updates.batchNo : current.batchNo
        };

        const stockDiff = updated.stock - current.stock;

        const stmt = this.db.prepare(`
            UPDATE products 
            SET name = ?, sku = ?, category = ?, price = ?, cost = ?, stock = ?, min_stock_alert = ?, unit = ?, description = ?, expiry_date = ?, batch_no = ?
            WHERE id = ?
        `);
        stmt.run([
            updated.name,
            updated.sku,
            updated.category,
            updated.price,
            updated.cost,
            updated.stock,
            updated.minStockAlert,
            updated.unit,
            updated.description,
            updated.expiryDate || '',
            updated.batchNo || '',
            id
        ]);
        stmt.free();

        if (stockDiff !== 0) {
            this.addStockLog({
                actionType: stockDiff > 0 ? 'RESTOCK_MANUAL' : 'STOCK_ADJUSTMENT',
                productId: id,
                productName: updated.name,
                delta: stockDiff,
                newStock: updated.stock,
                referenceId: updated.sku,
                details: `Stock changed by ${stockDiff > 0 ? '+' : ''}${stockDiff} (New stock: ${updated.stock} ${updated.unit})`
            });
        }

        this.persist();
        return updated;
    }

    deleteProduct(id) {
        if (!this.db) return false;
        const prod = this.getProductById(id);
        if (!prod) return false;

        const stmt = this.db.prepare("DELETE FROM products WHERE id = ?");
        stmt.run([id]);
        stmt.free();

        this.addStockLog({
            actionType: 'PRODUCT_DELETED',
            productId: id,
            productName: prod.name,
            delta: -prod.stock,
            newStock: 0,
            referenceId: prod.sku,
            details: `Product removed from SQLite database`
        });

        this.persist();
        return true;
    }

    // --- Customer Order / Sale Execution (Atomic SQLite Transaction) ---
    executeCustomerOrder(orderData) {
        if (!this.db) throw new Error("SQLite database not initialized");

        for (const item of orderData.items) {
            const prod = this.getProductById(item.id);
            if (!prod) throw new Error(`Product "${item.name}" not found in SQLite database`);
            if (prod.stock < item.quantity) {
                throw new Error(`Insufficient stock for "${prod.name}". Available: ${prod.stock}, Requested: ${item.quantity}`);
            }
        }

        this.db.run("BEGIN TRANSACTION;");

        try {
            const orderId = 'ord-' + Date.now();
            const dateNow = new Date();
            const formattedDate = dateNow.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
            const formattedTime = dateNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            const orderStmt = this.db.prepare(`
                INSERT INTO orders (
                    id, bill_number, customer_name, customer_phone, notes,
                    subtotal, discount_percent, discount_amount, tax_rate, tax_amount, grand_total,
                    payment_method, order_date, order_time, status, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            orderStmt.run([
                orderId,
                orderData.billNumber,
                orderData.customer.name.trim() || 'Valued Customer',
                orderData.customer.phone.trim() || '',
                orderData.customer.notes || '',
                orderData.subtotal,
                orderData.discountPercent || 0,
                orderData.discountAmount || 0,
                orderData.taxRate || 0,
                orderData.taxAmount || 0,
                orderData.grandTotal,
                orderData.paymentMethod || 'Cash',
                formattedDate,
                formattedTime,
                'COMPLETED',
                dateNow.toISOString()
            ]);
            orderStmt.free();

            const itemStmt = this.db.prepare(`
                INSERT INTO order_items (order_id, product_id, name, sku, unit, price, quantity, total)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const updateStockStmt = this.db.prepare(`
                UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ? OR sku = ?
            `);

            for (const item of orderData.items) {
                const qtyToDeduct = parseInt(item.quantity, 10) || 1;
                itemStmt.run([
                    orderId,
                    item.id,
                    item.name,
                    item.sku,
                    item.unit || 'pcs',
                    item.price,
                    qtyToDeduct,
                    item.price * qtyToDeduct
                ]);

                updateStockStmt.run([qtyToDeduct, item.id, item.sku || item.id]);

                const updatedProd = this.getProductById(item.id);

                this.addStockLog({
                    actionType: 'BILL_SALE',
                    productId: item.id,
                    productName: item.name,
                    delta: -qtyToDeduct,
                    newStock: updatedProd ? updatedProd.stock : 0,
                    referenceId: orderData.billNumber,
                    details: `Sold ${qtyToDeduct} ${item.unit || 'pcs'} in Order #${orderData.billNumber}`
                });
            }

            itemStmt.free();
            updateStockStmt.free();

            this.db.run("COMMIT;");
            this.persist();

            return this.getOrderById(orderId);
        } catch (err) {
            this.db.run("ROLLBACK;");
            throw err;
        }
    }

    // --- Supplier Stock Purchase Orders ---
    createSupplierPurchaseOrder(poData) {
        if (!this.db) return null;
        const id = 'po-' + Date.now();
        const poNumber = 'PO-' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + Math.floor(100 + Math.random() * 900);
        const now = new Date().toISOString();

        const stmt = this.db.prepare(`
            INSERT INTO supplier_purchase_orders (
                id, po_number, supplier_name, product_id, product_name, quantity, cost_per_unit, total_cost, status, created_at, expected_date
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run([
            id,
            poNumber,
            poData.supplierName.trim(),
            poData.productId,
            poData.productName,
            parseInt(poData.quantity, 10),
            Number(poData.costPerUnit),
            Number(poData.costPerUnit) * parseInt(poData.quantity, 10),
            'PENDING',
            now,
            poData.expectedDate || 'Within 3 days'
        ]);
        stmt.free();
        this.persist();

        return this.getSupplierPurchaseOrderById(id);
    }

    receiveSupplierPurchaseOrder(poId) {
        if (!this.db) return false;
        const po = this.getSupplierPurchaseOrderById(poId);
        if (!po || po.status === 'RECEIVED') return false;

        this.db.run("BEGIN TRANSACTION;");
        try {
            const updatePo = this.db.prepare(`
                UPDATE supplier_purchase_orders 
                SET status = 'RECEIVED', received_at = ? 
                WHERE id = ?
            `);
            updatePo.run([new Date().toISOString(), poId]);
            updatePo.free();

            const updateStock = this.db.prepare(`
                UPDATE products SET stock = stock + ? WHERE id = ?
            `);
            updateStock.run([po.quantity, po.product_id || po.productId]);
            updateStock.free();

            const updatedProd = this.getProductById(po.product_id || po.productId);

            this.addStockLog({
                actionType: 'RESTOCK_SUPPLIER',
                productId: po.product_id || po.productId,
                productName: po.product_name || po.productName,
                delta: +po.quantity,
                newStock: updatedProd ? updatedProd.stock : 0,
                referenceId: po.po_number || po.poNumber,
                details: `Received supplier shipment for ${po.quantity} units from ${po.supplier_name || po.supplierName}`
            });

            this.db.run("COMMIT;");
            this.persist();
            return true;
        } catch (e) {
            this.db.run("ROLLBACK;");
            throw e;
        }
    }

    getAllSupplierPurchaseOrders() {
        if (!this.db) return [];
        const stmt = this.db.prepare("SELECT * FROM supplier_purchase_orders ORDER BY created_at DESC");
        const list = [];
        while (stmt.step()) {
            list.push(stmt.getAsObject());
        }
        stmt.free();
        return list;
    }

    getSupplierPurchaseOrderById(id) {
        if (!this.db) return null;
        const stmt = this.db.prepare("SELECT * FROM supplier_purchase_orders WHERE id = ?");
        stmt.bind([id]);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
        }
        stmt.free();
        return null;
    }

    // --- Orders Retrieval ---
    getAllOrders() {
        if (!this.db) return [];
        const stmt = this.db.prepare("SELECT * FROM orders ORDER BY created_at DESC");
        const orders = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const items = this.getOrderItems(row.id);
            orders.push({
                id: row.id,
                billNumber: row.bill_number,
                date: row.order_date,
                time: row.order_time,
                customer: {
                    name: row.customer_name,
                    phone: row.customer_phone,
                    notes: row.notes
                },
                pricing: {
                    subtotal: row.subtotal,
                    discountPercent: row.discount_percent,
                    discountAmount: row.discount_amount,
                    taxRate: row.tax_rate,
                    taxAmount: row.tax_amount,
                    grandTotal: row.grand_total
                },
                paymentMethod: row.payment_method,
                status: row.status,
                messageDispatched: {
                    whatsapp: !!row.whatsapp_dispatched,
                    sms: !!row.sms_dispatched
                },
                items
            });
        }
        stmt.free();
        return orders;
    }

    getOrderById(id) {
        if (!this.db) return null;
        const stmt = this.db.prepare("SELECT * FROM orders WHERE id = ? OR bill_number = ?");
        stmt.bind([id, id]);
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            const items = this.getOrderItems(row.id);
            return {
                id: row.id,
                billNumber: row.bill_number,
                date: row.order_date,
                time: row.order_time,
                customer: {
                    name: row.customer_name,
                    phone: row.customer_phone,
                    notes: row.notes
                },
                pricing: {
                    subtotal: row.subtotal,
                    discountPercent: row.discount_percent,
                    discountAmount: row.discount_amount,
                    taxRate: row.tax_rate,
                    taxAmount: row.tax_amount,
                    grandTotal: row.grand_total
                },
                paymentMethod: row.payment_method,
                status: row.status,
                messageDispatched: {
                    whatsapp: !!row.whatsapp_dispatched,
                    sms: !!row.sms_dispatched
                },
                items
            };
        }
        stmt.free();
        return null;
    }

    getOrderItems(orderId) {
        const stmt = this.db.prepare("SELECT * FROM order_items WHERE order_id = ?");
        stmt.bind([orderId]);
        const items = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            items.push({
                id: row.product_id,
                name: row.name,
                sku: row.sku,
                unit: row.unit,
                price: row.price,
                quantity: row.quantity,
                total: row.total
            });
        }
        stmt.free();
        return items;
    }

    markMessageSent(orderId, channel) {
        if (!this.db) return;
        const col = channel === 'whatsapp' ? 'whatsapp_dispatched' : 'sms_dispatched';
        const stmt = this.db.prepare(`UPDATE orders SET ${col} = 1 WHERE id = ? OR bill_number = ?`);
        stmt.run([orderId, orderId]);
        stmt.free();
        this.persist();
    }

    voidOrder(orderId, reason = 'Customer Return') {
        if (!this.db) return false;
        const order = this.getOrderById(orderId);
        if (!order || order.status === 'VOIDED') return false;

        this.db.run("BEGIN TRANSACTION;");
        try {
            const restoreStmt = this.db.prepare("UPDATE products SET stock = stock + ? WHERE id = ?");
            for (const item of order.items) {
                restoreStmt.run([item.quantity, item.id]);
                const prod = this.getProductById(item.id);
                this.addStockLog({
                    actionType: 'BILL_CANCELLED_RESTORE',
                    productId: item.id,
                    productName: item.name,
                    delta: +item.quantity,
                    newStock: prod ? prod.stock : 0,
                    referenceId: order.billNumber,
                    details: `Restored ${item.quantity} ${item.unit} to inventory from voided Order #${order.billNumber}`
                });
            }
            restoreStmt.free();

            const updateStmt = this.db.prepare("UPDATE orders SET status = 'VOIDED', notes = notes || ' [VOIDED: ' || ? || ']' WHERE id = ?");
            updateStmt.run([reason, order.id]);
            updateStmt.free();

            this.db.run("COMMIT;");
            this.persist();
            return true;
        } catch (e) {
            this.db.run("ROLLBACK;");
            throw e;
        }
    }

    // --- Stock Movement Audit Logs ---
    addStockLog(entry) {
        if (!this.db) return;
        const id = 'log-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        const dateNow = new Date();
        const dateStr = dateNow.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const timeStr = dateNow.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        const stmt = this.db.prepare(`
            INSERT INTO stock_logs (id, timestamp, date_str, time_str, action_type, product_id, product_name, delta, new_stock, reference_id, details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run([
            id,
            dateNow.toISOString(),
            dateStr,
            timeStr,
            entry.actionType,
            entry.productId || null,
            entry.productName || 'Catalog',
            entry.delta !== undefined ? entry.delta : 0,
            entry.newStock !== undefined ? entry.newStock : 0,
            entry.referenceId || '',
            entry.details || ''
        ]);
        stmt.free();
    }

    getAllStockLogs() {
        if (!this.db) return [];
        const stmt = this.db.prepare("SELECT * FROM stock_logs ORDER BY timestamp DESC LIMIT 300");
        const logs = [];
        while (stmt.step()) {
            const r = stmt.getAsObject();
            logs.push({
                id: r.id,
                timestamp: r.timestamp,
                date: r.date_str,
                time: r.time_str,
                type: r.action_type,
                productId: r.product_id,
                productName: r.product_name,
                delta: r.delta,
                newStock: r.new_stock,
                referenceId: r.reference_id,
                details: r.details
            });
        }
        stmt.free();
        return logs;
    }

    // --- Live SQL Query Console ---
    executeCustomSQL(sql) {
        if (!this.db) return { error: "SQLite not ready" };
        try {
            const trimmed = sql.trim();
            const results = this.db.exec(trimmed);
            if (trimmed.toUpperCase().startsWith('INSERT') || 
                trimmed.toUpperCase().startsWith('UPDATE') || 
                trimmed.toUpperCase().startsWith('DELETE') ||
                trimmed.toUpperCase().startsWith('DROP') ||
                trimmed.toUpperCase().startsWith('CREATE')) {
                this.persist();
            }
            return { success: true, results };
        } catch (err) {
            return { error: err.message };
        }
    }

    // --- Export SQLite Database as Binary .sqlite File ---
    downloadSQLiteFile(filename = 'billing_database.sqlite') {
        if (!this.db) return;
        const binary = this.db.export();
        const blob = new Blob([binary], { type: 'application/x-sqlite3' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    // --- Import Existing .sqlite File ---
    async importSQLiteFile(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const u8arr = new Uint8Array(reader.result);
                    const SQL = window.SQL || window.sqlModule;
                    if (this.db) this.db.close();
                    this.db = new SQL.Database(u8arr);
                    this.createSchema();
                    this.persist();
                    resolve(true);
                } catch (e) {
                    reject(e);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }

    // --- Previous Month Demand Forecasting & Reorder Recommendations ---
    analyzePreviousMonthDemand(period = 'PREV_MONTH') {
        if (!this.db) return [];

        try {
            const products = this.getAllProducts();
            const results = [];

            // Previous month is September 2026 ('2026-09-01' to '2026-09-30')
            let dateCondition = "record_date >= '2026-09-01' AND record_date <= '2026-09-30'";
            let periodDays = 30;
            let periodLabel = "Previous Month (Sep 2026)";

            if (period === 'LAST_30_DAYS') {
                dateCondition = "record_date >= '2026-08-27' AND record_date <= '2026-09-26'";
                periodLabel = "Last 30 Days";
            } else if (period === 'ALL_HISTORY') {
                dateCondition = "1=1";
                periodDays = 180;
                periodLabel = "Historical Run Rate";
            }

            // Query sales from stock_history_records
            const histMap = {};
            try {
                const histStmt = this.db.prepare(`
                    SELECT sku, SUM(units_sold) as total_sold, COUNT(DISTINCT record_date) as days_count
                    FROM stock_history_records
                    WHERE ${dateCondition}
                    GROUP BY sku
                `);
                while (histStmt.step()) {
                    const row = histStmt.getAsObject();
                    histMap[row.sku] = {
                        totalSold: row.total_sold || 0,
                        daysCount: row.days_count || periodDays
                    };
                }
                histStmt.free();
            } catch (e) {
                console.warn('Error querying stock_history_records for demand:', e);
            }

            // Also query live customer orders from orders & order_items
            const ordersMap = {};
            try {
                const orderStmt = this.db.prepare(`
                    SELECT oi.sku, SUM(oi.quantity) as live_sold
                    FROM order_items oi
                    JOIN orders o ON oi.order_id = o.id
                    WHERE o.status != 'VOIDED'
                    GROUP BY oi.sku
                `);
                while (orderStmt.step()) {
                    const row = orderStmt.getAsObject();
                    ordersMap[row.sku] = row.live_sold || 0;
                }
                orderStmt.free();
            } catch (e) {
                console.warn('Error querying order_items for demand:', e);
            }

            for (const prod of products) {
                const histData = histMap[prod.sku] || { totalSold: 0, daysCount: periodDays };
                const liveSold = ordersMap[prod.sku] || 0;
                let unitsSold = histData.totalSold + liveSold;

                // Fallback baseline: if unitsSold is 0 for this SKU, look up average from entire history
                if (unitsSold === 0) {
                    try {
                        const fallbackStmt = this.db.prepare("SELECT SUM(units_sold) as s, COUNT(DISTINCT SUBSTR(record_date, 1, 7)) as m FROM stock_history_records WHERE sku = ?");
                        fallbackStmt.bind([prod.sku]);
                        if (fallbackStmt.step()) {
                            const fRow = fallbackStmt.getAsObject();
                            const months = Math.max(1, fRow.m || 1);
                            unitsSold = Math.round((fRow.s || 0) / months);
                        }
                        fallbackStmt.free();
                    } catch (e) {}
                }

                // If still 0, provide realistic minimum activity based on minStockAlert
                if (unitsSold === 0) {
                    unitsSold = Math.max(3, Math.round(prod.stock * 0.25));
                }

                const dailyVelocity = parseFloat((unitsSold / periodDays).toFixed(2));
                const currentStock = prod.stock;
                
                // Days of stock runway remaining
                let daysOfStockLeft = 999;
                if (currentStock <= 0) {
                    daysOfStockLeft = 0;
                } else if (dailyVelocity > 0) {
                    daysOfStockLeft = Math.round(currentStock / dailyVelocity);
                }

                // Reorder Urgency Classification
                let urgency = 'HEALTHY';
                let urgencyScore = 5;
                let urgencyLabel = 'Healthy Stock';
                let urgencyBadgeClass = 'badge-healthy';

                if (currentStock <= 0) {
                    urgency = 'OUT_OF_STOCK';
                    urgencyScore = 1;
                    urgencyLabel = 'Out of Stock (Zero Units)';
                    urgencyBadgeClass = 'badge-out-of-stock';
                } else if (daysOfStockLeft <= 7 || currentStock <= prod.minStockAlert) {
                    urgency = 'CRITICAL';
                    urgencyScore = 2;
                    urgencyLabel = `Critical Risk (≤ ${daysOfStockLeft}d left)`;
                    urgencyBadgeClass = 'badge-critical';
                } else if (daysOfStockLeft <= 15 || dailyVelocity >= 1.0) {
                    urgency = 'HIGH_DEMAND';
                    urgencyScore = 3;
                    urgencyLabel = `High Demand (${daysOfStockLeft}d buffer)`;
                    urgencyBadgeClass = 'badge-high-demand';
                } else if (daysOfStockLeft <= 30) {
                    urgency = 'MODERATE';
                    urgencyScore = 4;
                    urgencyLabel = `Moderate Demand (${daysOfStockLeft}d)`;
                    urgencyBadgeClass = 'badge-moderate';
                }

                // Recommended Reorder Qty (aims for 30 days buffer stock + minStockAlert)
                const targetStock = Math.ceil(dailyVelocity * 30) + prod.minStockAlert;
                let recommendedReorder = 0;
                if (currentStock < targetStock) {
                    const deficit = targetStock - currentStock;
                    recommendedReorder = Math.max(10, Math.ceil(deficit / 5) * 5);
                }

                const estimatedCost = Math.round(recommendedReorder * prod.cost * 100) / 100;
                const estimatedRevenue = Math.round(recommendedReorder * prod.price * 100) / 100;

                results.push({
                    productId: prod.id,
                    name: prod.name,
                    sku: prod.sku,
                    category: prod.category,
                    price: prod.price,
                    cost: prod.cost,
                    unit: prod.unit,
                    currentStock,
                    minStockAlert: prod.minStockAlert,
                    expiryDate: prod.expiryDate,
                    batchNo: prod.batchNo,
                    periodLabel,
                    unitsSoldLastMonth: unitsSold,
                    salesRevenueLastMonth: Math.round(unitsSold * prod.price),
                    dailyVelocity,
                    daysOfStockLeft,
                    urgency,
                    urgencyScore,
                    urgencyLabel,
                    urgencyBadgeClass,
                    recommendedReorder,
                    estimatedCost,
                    estimatedRevenue
                });
            }

            // Sort: most urgent reorders first, then highest units sold
            results.sort((a, b) => {
                if (a.urgencyScore !== b.urgencyScore) {
                    return a.urgencyScore - b.urgencyScore;
                }
                return b.unitsSoldLastMonth - a.unitsSoldLastMonth;
            });

            return results;
        } catch (err) {
            console.error('Demand analysis error:', err);
            return [];
        }
    }

    // --- Near Expiry Shelf-Life Radar ---
    analyzeProductExpiry() {
        if (!this.db) return [];
        try {
            const products = this.getAllProducts();
            const today = new Date();
            const results = [];

            for (const prod of products) {
                if (!prod.expiryDate) continue;

                const expDate = new Date(prod.expiryDate + 'T00:00:00');
                const diffTime = expDate.getTime() - today.getTime();
                const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                let status = 'SAFE';
                let statusBadgeClass = 'badge-expiry-safe';
                let statusLabel = `Healthy (${daysLeft}d left)`;
                let severity = 5;
                let recommendedAction = 'Normal Sales Circulation';
                let clearanceDiscountPercent = 0;

                if (daysLeft < 0) {
                    status = 'EXPIRED';
                    statusBadgeClass = 'badge-expiry-expired';
                    statusLabel = `Expired (${Math.abs(daysLeft)}d ago)`;
                    severity = 1;
                    recommendedAction = 'Immediate Disposal / Vendor Return';
                    clearanceDiscountPercent = 100;
                } else if (daysLeft <= 15) {
                    status = 'CRITICAL';
                    statusBadgeClass = 'badge-expiry-critical';
                    statusLabel = `Critical: ${daysLeft} days left!`;
                    severity = 2;
                    recommendedAction = '40% Clearance Sale in POS';
                    clearanceDiscountPercent = 40;
                } else if (daysLeft <= 30) {
                    status = 'EXPIRING_SOON';
                    statusBadgeClass = 'badge-expiry-warning';
                    statusLabel = `Expiring Soon (${daysLeft} days)`;
                    severity = 3;
                    recommendedAction = '20% Promotional Bundle';
                    clearanceDiscountPercent = 20;
                } else if (daysLeft <= 60) {
                    status = 'WATCH';
                    statusBadgeClass = 'badge-expiry-watch';
                    statusLabel = `${daysLeft} days left (Watch)`;
                    severity = 4;
                    recommendedAction = 'Front-Shelf Merchandising';
                    clearanceDiscountPercent = 10;
                }

                const capitalAtRisk = Math.round(prod.stock * prod.cost * 100) / 100;
                const retailAtRisk = Math.round(prod.stock * prod.price * 100) / 100;

                results.push({
                    productId: prod.id,
                    name: prod.name,
                    sku: prod.sku,
                    category: prod.category,
                    price: prod.price,
                    cost: prod.cost,
                    stock: prod.stock,
                    unit: prod.unit,
                    expiryDate: prod.expiryDate,
                    batchNo: prod.batchNo || 'N/A',
                    daysLeft,
                    status,
                    statusBadgeClass,
                    statusLabel,
                    severity,
                    capitalAtRisk,
                    retailAtRisk,
                    recommendedAction,
                    clearanceDiscountPercent
                });
            }

            // Sort: most critical / expired first
            results.sort((a, b) => a.severity - b.severity || a.daysLeft - b.daysLeft);
            return results;
        } catch (err) {
            console.error('Expiry analysis error:', err);
            return [];
        }
    }

    applyClearanceDiscount(productId, discountPercent) {
        if (!this.db) return null;
        const prod = this.getProductById(productId);
        if (!prod) return null;

        const originalPrice = prod.price;
        const discountFactor = (100 - discountPercent) / 100;
        const newPrice = Math.max(1, Math.round(originalPrice * discountFactor * 10) / 10);

        this.updateProduct(productId, { price: newPrice });

        this.addStockLog({
            actionType: 'CLEARANCE_DISCOUNT',
            productId: prod.id,
            productName: prod.name,
            delta: 0,
            newStock: prod.stock,
            referenceId: prod.sku,
            details: `Applied ${discountPercent}% clearance discount to accelerate sale before expiry (${prod.expiryDate}). Old: ₹${originalPrice}, New: ₹${newPrice}`
        });

        this.persist();
        return { prod, oldPrice: originalPrice, newPrice };
    }

    disposeExpiredStock(productId, quantity = null, reason = 'Expired / Past Shelf-Life') {
        if (!this.db) return false;
        const prod = this.getProductById(productId);
        if (!prod || prod.stock <= 0) return false;

        const qtyToDispose = quantity ? Math.min(prod.stock, parseInt(quantity, 10)) : prod.stock;
        const newStock = prod.stock - qtyToDispose;

        this.updateProduct(productId, { stock: newStock });

        this.addStockLog({
            actionType: 'EXPIRED_DISPOSAL',
            productId: prod.id,
            productName: prod.name,
            delta: -qtyToDispose,
            newStock,
            referenceId: prod.sku,
            details: `Disposed ${qtyToDispose} ${prod.unit} of expired stock (${prod.expiryDate}, Batch: ${prod.batchNo}). Reason: ${reason}`
        });

        this.persist();
        return true;
    }

    // --- Binary Base64 Helpers ---
    uint8ArrayToBase64(u8arr) {
        let binary = '';
        const len = u8arr.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(u8arr[i]);
        }
        return btoa(binary);
    }

    base64ToUint8Array(base64) {
        const binary = atob(base64);
        const len = binary.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
}

window.SQLiteDB = new SQLiteDatabase();
