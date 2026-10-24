/**
 * QuickBill Pro - Central State Store & SQLite Database Bridge
 * Integrates SQLite 3 Database Engine (sql.js WebAssembly) with reactive UI updates.
 */

const STORAGE_KEYS = {
    PRODUCTS: 'qb_products_v1',
    INVOICES: 'qb_invoices_v1',
    STOCK_LOGS: 'qb_stock_logs_v1',
    SETTINGS: 'qb_settings_v1'
};

const DEFAULT_SETTINGS = {
    storeName: 'Metro HyperStore & Electronics',
    tagline: 'Smart Retail & Instant Digital Billing',
    storePhone: '+91 98765 43210',
    storeAddress: 'Shop #42, Central Galleria, Tech Boulevard',
    currencySymbol: '₹',
    currencyCode: 'INR',
    defaultTaxRate: 18,
    enableTax: true,
    whatsappPrefixCountryCode: '+91',
    messageGreeting: 'Hello {customer_name}! Thank you for shopping with {store_name}.',
    messageFooter: '⭐ Need help or returns? Contact {store_phone}. Have a great day!',
    includeItemDetailsInSMS: true,
    autoOpenWhatsApp: true
};

class StoreManager {
    constructor() {
        this.products = [];
        this.invoices = [];
        this.stockLogs = [];
        this.supplierOrders = [];
        this.settings = { ...DEFAULT_SETTINGS };
        this.listeners = [];
        this.currentOrderBy = 'name ASC';
        this.useSQLite = false;

        this.init();
    }

    async init() {
        // Load Settings
        const savedSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);
        if (savedSettings) {
            try {
                this.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) };
            } catch (e) {
                console.error('Failed to parse settings:', e);
            }
        } else {
            this.saveSettings(DEFAULT_SETTINGS);
        }

        // Initialize SQLite Engine
        if (window.SQLiteDB) {
            try {
                const sqliteReady = await window.SQLiteDB.init();
                if (sqliteReady) {
                    this.useSQLite = true;
                    console.log('✅ StoreManager connected to SQLite Database Engine.');
                    this.refreshFromSQLite();
                    return;
                }
            } catch (err) {
                console.warn('SQLite init warning, using local fallback:', err);
            }
        }

        // Fallback to LocalStorage if SQLite not loaded yet
        this.loadFallbackStorage();
    }

    loadFallbackStorage() {
        const savedProducts = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
        if (savedProducts) {
            try { this.products = JSON.parse(savedProducts); } catch (e) { this.products = []; }
        }
        const savedInvoices = localStorage.getItem(STORAGE_KEYS.INVOICES);
        if (savedInvoices) {
            try { this.invoices = JSON.parse(savedInvoices); } catch (e) { this.invoices = []; }
        }
        const savedLogs = localStorage.getItem(STORAGE_KEYS.STOCK_LOGS);
        if (savedLogs) {
            try { this.stockLogs = JSON.parse(savedLogs); } catch (e) { this.stockLogs = []; }
        }
    }

    refreshFromSQLite() {
        if (!this.useSQLite || !window.SQLiteDB) return;
        this.products = window.SQLiteDB.getAllProducts(this.currentOrderBy);
        this.invoices = window.SQLiteDB.getAllOrders();
        this.stockLogs = window.SQLiteDB.getAllStockLogs();
        this.supplierOrders = window.SQLiteDB.getAllSupplierPurchaseOrders();

        this.notify('PRODUCTS_UPDATED', this.products);
        this.notify('INVOICES_UPDATED', this.invoices);
        this.notify('STOCK_LOGS_UPDATED', this.stockLogs);
        this.notify('SUPPLIER_ORDERS_UPDATED', this.supplierOrders);
    }

    subscribe(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    notify(event, data) {
        this.listeners.forEach(fn => {
            try { fn(event, data); } catch (err) { console.error('Store listener error:', err); }
        });
    }

    // --- Order / Sorting of Products ---
    setProductOrder(orderByClause) {
        this.currentOrderBy = orderByClause;
        if (this.useSQLite && window.SQLiteDB) {
            this.products = window.SQLiteDB.getAllProducts(orderByClause);
        } else {
            // Memory sort
            this.products.sort((a, b) => {
                if (orderByClause === 'name ASC') return a.name.localeCompare(b.name);
                if (orderByClause === 'name DESC') return b.name.localeCompare(a.name);
                if (orderByClause === 'price ASC') return a.price - b.price;
                if (orderByClause === 'price DESC') return b.price - a.price;
                if (orderByClause === 'stock ASC') return a.stock - b.stock;
                if (orderByClause === 'stock DESC') return b.stock - a.stock;
                if (orderByClause === 'category ASC') return a.category.localeCompare(b.category);
                return 0;
            });
        }
        this.notify('PRODUCTS_UPDATED', this.products);
    }

    // --- Product Management (SQLite backed) ---
    getProducts() {
        return this.products;
    }

    getProductById(id) {
        if (this.useSQLite && window.SQLiteDB) {
            return window.SQLiteDB.getProductById(id);
        }
        return this.products.find(p => p.id === id);
    }

    addProduct(productData) {
        if (this.useSQLite && window.SQLiteDB) {
            const newProd = window.SQLiteDB.addProduct(productData);
            this.refreshFromSQLite();
            return newProd;
        }

        const id = 'prod-' + Date.now().toString().slice(-6);
        const newProd = {
            id,
            name: productData.name.trim(),
            sku: productData.sku.trim().toUpperCase(),
            category: productData.category.trim() || 'General',
            price: Number(productData.price) || 0,
            cost: Number(productData.cost) || 0,
            stock: parseInt(productData.stock, 10) || 0,
            minStockAlert: parseInt(productData.minStockAlert, 10) || 5,
            unit: productData.unit?.trim() || 'pcs',
            description: productData.description?.trim() || ''
        };
        this.products.unshift(newProd);
        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(this.products));
        this.notify('PRODUCTS_UPDATED', this.products);
        return newProd;
    }

    updateProduct(id, updates) {
        if (this.useSQLite && window.SQLiteDB) {
            const updated = window.SQLiteDB.updateProduct(id, updates);
            this.refreshFromSQLite();
            return updated;
        }

        const index = this.products.findIndex(p => p.id === id);
        if (index === -1) return null;
        this.products[index] = { ...this.products[index], ...updates };
        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(this.products));
        this.notify('PRODUCTS_UPDATED', this.products);
        return this.products[index];
    }

    quickRestock(productId, addedQty) {
        const prod = this.getProductById(productId);
        if (!prod) return false;
        const newStock = Math.max(0, prod.stock + parseInt(addedQty, 10));
        return this.updateProduct(productId, { stock: newStock });
    }

    deleteProduct(id) {
        if (this.useSQLite && window.SQLiteDB) {
            const ok = window.SQLiteDB.deleteProduct(id);
            this.refreshFromSQLite();
            return ok;
        }

        this.products = this.products.filter(p => p.id !== id);
        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(this.products));
        this.notify('PRODUCTS_UPDATED', this.products);
        return true;
    }

    // --- Customer Order / Sale Execution (SQLite Transaction) ---
    executeCustomerOrder(orderData) {
        if (this.useSQLite && window.SQLiteDB) {
            const order = window.SQLiteDB.executeCustomerOrder(orderData);
            this.refreshFromSQLite();
            return order;
        }

        // Fallback deduction
        for (const item of orderData.items) {
            const prod = this.getProductById(item.id);
            const qty = parseInt(item.quantity, 10) || 1;
            if (!prod || prod.stock < qty) {
                throw new Error(`Insufficient stock for "${item.name}"`);
            }
            prod.stock = Math.max(0, prod.stock - qty);
        }

        const newInvoice = {
            id: 'inv-' + Date.now(),
            billNumber: orderData.billNumber,
            date: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
            time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
            customer: orderData.customer,
            items: orderData.items,
            pricing: {
                subtotal: orderData.subtotal,
                discountPercent: orderData.discountPercent,
                discountAmount: orderData.discountAmount,
                taxRate: orderData.taxRate,
                taxAmount: orderData.taxAmount,
                grandTotal: orderData.grandTotal
            },
            paymentMethod: orderData.paymentMethod,
            status: 'COMPLETED',
            messageDispatched: { whatsapp: false, sms: false }
        };

        this.invoices.unshift(newInvoice);
        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(this.products));
        localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(this.invoices));
        this.notify('PRODUCTS_UPDATED', this.products);
        this.notify('INVOICES_UPDATED', this.invoices);
        return newInvoice;
    }

    // --- Supplier Stock Purchase Order ---
    orderStockFromSupplier(poData) {
        if (this.useSQLite && window.SQLiteDB) {
            const po = window.SQLiteDB.createSupplierPurchaseOrder(poData);
            this.refreshFromSQLite();
            return po;
        }
        return null;
    }

    receiveSupplierOrder(poId) {
        if (this.useSQLite && window.SQLiteDB) {
            const ok = window.SQLiteDB.receiveSupplierPurchaseOrder(poId);
            this.refreshFromSQLite();
            return ok;
        }
        return false;
    }

    getSupplierOrders() {
        if (this.useSQLite && window.SQLiteDB) {
            return window.SQLiteDB.getAllSupplierPurchaseOrders();
        }
        return this.supplierOrders || [];
    }

    // --- Invoices & Messages ---
    getInvoices() {
        return this.invoices;
    }

    getInvoiceById(id) {
        if (this.useSQLite && window.SQLiteDB) {
            return window.SQLiteDB.getOrderById(id);
        }
        return this.invoices.find(inv => inv.id === id || inv.billNumber === id);
    }

    markMessageSent(invoiceId, channel) {
        if (this.useSQLite && window.SQLiteDB) {
            window.SQLiteDB.markMessageSent(invoiceId, channel);
            this.refreshFromSQLite();
            return;
        }
        const inv = this.getInvoiceById(invoiceId);
        if (inv) {
            if (channel === 'whatsapp') inv.messageDispatched.whatsapp = true;
            if (channel === 'sms') inv.messageDispatched.sms = true;
            localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(this.invoices));
            this.notify('INVOICES_UPDATED', this.invoices);
        }
    }

    voidInvoice(invoiceId, reason = 'Customer Return') {
        if (this.useSQLite && window.SQLiteDB) {
            const ok = window.SQLiteDB.voidOrder(invoiceId, reason);
            this.refreshFromSQLite();
            return ok;
        }
        return false;
    }

    // --- Stock Movement Audit Logs ---
    getStockLogs() {
        return this.stockLogs;
    }

    // --- Demand Forecasting & Expiry Shelf-Life Radar ---
    getDemandAnalysis(period = 'PREV_MONTH') {
        if (this.useSQLite && window.SQLiteDB) {
            return window.SQLiteDB.analyzePreviousMonthDemand(period);
        }
        return [];
    }

    getExpiryAnalysis() {
        if (this.useSQLite && window.SQLiteDB) {
            return window.SQLiteDB.analyzeProductExpiry();
        }
        return [];
    }

    applyClearanceDiscount(productId, discountPercent) {
        if (this.useSQLite && window.SQLiteDB) {
            const res = window.SQLiteDB.applyClearanceDiscount(productId, discountPercent);
            this.refreshFromSQLite();
            return res;
        }
        return null;
    }

    disposeExpiredStock(productId, quantity = null, reason = 'Expired / Past Shelf-Life') {
        if (this.useSQLite && window.SQLiteDB) {
            const ok = window.SQLiteDB.disposeExpiredStock(productId, quantity, reason);
            this.refreshFromSQLite();
            return ok;
        }
        return false;
    }

    // --- Settings ---
    saveSettings(newSettings) {
        this.settings = { ...this.settings, ...newSettings };
        localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(this.settings));
        this.notify('SETTINGS_UPDATED', this.settings);
    }

    getSettings() {
        return this.settings;
    }

    async ensureSQLiteReady() {
        if (this.useSQLite && window.SQLiteDB && window.SQLiteDB.isInitialized) {
            return true;
        }
        if (window.SQLiteDB) {
            try {
                const ok = await window.SQLiteDB.init();
                if (ok) {
                    this.useSQLite = true;
                    this.refreshFromSQLite();
                    return true;
                }
            } catch (e) {
                console.warn('ensureSQLiteReady error:', e);
            }
        }
        return false;
    }

    // --- SQLite Database File Management ---
    exportSQLiteFile() {
        if (this.useSQLite && window.SQLiteDB) {
            window.SQLiteDB.downloadSQLiteFile();
            return true;
        }
        return false;
    }

    // --- Client-Side Excel / CSV File Import (Zero Server Upload) ---
    async importStockSenseDataset() {
        await this.ensureSQLiteReady();
        if (this.useSQLite && window.SQLiteDB) {
            const result = window.SQLiteDB.importStockSenseDataset();
            this.refreshFromSQLite();
            return result;
        }
        if (window.STOCKSENSE_RAW_DATA) {
            return this.importStockSenseFallback();
        }
        return null;
    }

    importStockSenseFallback() {
        const records = window.STOCKSENSE_RAW_DATA || [];
        const grouped = {};
        for (const r of records) {
            if (!grouped[r.SKU] || r.Date > grouped[r.SKU].Date) {
                grouped[r.SKU] = r;
            }
        }
        this.products = Object.values(grouped).map(item => ({
            id: 'prod-' + item.SKU.toLowerCase().replace(/[^a-z0-9]/g, ''),
            name: item.Name,
            sku: item.SKU,
            category: item.Category,
            price: item.Price,
            cost: Math.round(item.Price * 0.7 * 100) / 100,
            stock: item.CurrentStock,
            minStockAlert: item.ReorderLevel,
            unit: 'pcs',
            description: `${item.Brand} ${item.Name} (${item.Warehouse})`
        }));
        localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(this.products));
        this.notify('PRODUCTS_UPDATED', this.products);
        return { totalRecords: records.length, masterProductsCount: this.products.length };
    }

    async importExcelOrCSVFile(file) {
        await this.ensureSQLiteReady();
        if (this.useSQLite && window.SQLiteDB) {
            const res = await window.SQLiteDB.importExcelOrCSVFile(file);
            this.refreshFromSQLite();
            return res;
        }
        // Fallback: Parse locally using SheetJS without SQLite
        return this.importExcelFallback(file);
    }

    async importExcelFallback(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    if (typeof XLSX === 'undefined') throw new Error("XLSX parser library not loaded.");
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    const rows = XLSX.utils.sheet_to_json(sheet);
                    if (!rows || rows.length === 0) throw new Error("Excel file contains no rows.");

                    const imported = [];
                    for (const r of rows) {
                        const sku = (r.SKU || r.sku || `SKU-${Date.now().toString().slice(-4)}`).toString().trim();
                        const name = (r.Product_Name || r['Product Name'] || r.Name || 'Product').toString().trim();
                        const category = (r.Category || 'General').toString().trim();
                        const price = parseFloat(r.Unit_Price || r.Price || 0) || 0;
                        const stock = parseInt(r.Current_Stock || r.Stock || 0, 10) || 0;
                        const reorder = parseInt(r.Reorder_Level || 5, 10) || 5;

                        imported.push({
                            id: 'prod-' + sku.toLowerCase().replace(/[^a-z0-9]/g, ''),
                            name,
                            sku,
                            category,
                            price,
                            cost: Math.round(price * 0.7 * 100) / 100,
                            stock,
                            minStockAlert: reorder,
                            unit: 'pcs',
                            description: `${r.Brand || ''} ${name}`.trim()
                        });
                    }

                    this.products = imported;
                    localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(this.products));
                    this.notify('PRODUCTS_UPDATED', this.products);
                    resolve({ count: rows.length, fileName: file.name });
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
    }
}

window.Store = new StoreManager();
