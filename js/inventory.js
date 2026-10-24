/**
 * QuickBill Pro - Inventory & Stock Management Module
 * Handles SQLite Stock Monitoring, Product CRUD, Quick Restocking, and Supplier Purchase Orders.
 */

class InventoryManager {
    constructor() {
        this.store = window.Store;
        this.filterStatus = 'ALL';
        this.searchQuery = '';
        this.activeCategory = 'ALL';
        this.currentOrderBy = 'name ASC';
        this.editingProductId = null;

        this.init();
    }

    init() {
        this.store.subscribe((event) => {
            if (event === 'PRODUCTS_UPDATED' || event === 'STOCK_LOGS_UPDATED' || event === 'SUPPLIER_ORDERS_UPDATED') {
                this.renderInventory();
                this.renderStockStats();
                this.renderStockLogs();
                this.renderSupplierOrders();
            }
        });
    }

    setFilterStatus(status) {
        this.filterStatus = status;
        this.renderInventory();
    }

    setCategoryFilter(category) {
        this.activeCategory = category;
        this.renderInventory();
    }

    setSearchQuery(query) {
        this.searchQuery = (query || '').toLowerCase().trim();
        this.renderInventory();
    }

    setInventoryOrderBy(orderByClause) {
        this.currentOrderBy = orderByClause;
        this.store.setProductOrder(orderByClause);
        this.renderInventory();
    }

    getFilteredInventory() {
        let products = this.store.getProducts();

        if (this.activeCategory && this.activeCategory !== 'ALL') {
            products = products.filter(p => p.category.toLowerCase() === this.activeCategory.toLowerCase());
        }

        if (this.searchQuery) {
            products = products.filter(p =>
                p.name.toLowerCase().includes(this.searchQuery) ||
                p.sku.toLowerCase().includes(this.searchQuery) ||
                p.category.toLowerCase().includes(this.searchQuery)
            );
        }

        if (this.filterStatus === 'LOW_STOCK') {
            products = products.filter(p => p.stock > 0 && p.stock <= p.minStockAlert);
        } else if (this.filterStatus === 'OUT_OF_STOCK') {
            products = products.filter(p => p.stock <= 0);
        } else if (this.filterStatus === 'HEALTHY') {
            products = products.filter(p => p.stock > p.minStockAlert);
        } else if (this.filterStatus === 'NEAR_EXPIRY') {
            const today = new Date();
            products = products.filter(p => {
                if (!p.expiryDate) return false;
                const days = Math.ceil((new Date(p.expiryDate + 'T00:00:00') - today) / (1000 * 60 * 60 * 24));
                return days >= 0 && days <= 30;
            });
        } else if (this.filterStatus === 'EXPIRED') {
            const today = new Date();
            products = products.filter(p => {
                if (!p.expiryDate) return false;
                const days = Math.ceil((new Date(p.expiryDate + 'T00:00:00') - today) / (1000 * 60 * 60 * 24));
                return days < 0;
            });
        }

        return products;
    }

    // --- Statistics Calculation ---
    calculateStats() {
        const products = this.store.getProducts();
        const settings = this.store.getSettings();
        const curr = settings.currencySymbol || '₹';

        let totalItems = 0;
        let totalValuation = 0;
        let totalCostValuation = 0;
        let lowStockCount = 0;
        let outOfStockCount = 0;

        products.forEach(p => {
            totalItems += p.stock;
            totalValuation += (p.price * p.stock);
            totalCostValuation += (p.cost * p.stock);
            if (p.stock <= 0) {
                outOfStockCount++;
            } else if (p.stock <= p.minStockAlert) {
                lowStockCount++;
            }
        });

        return {
            totalProductsCount: products.length,
            totalUnitsInStock: totalItems,
            totalValuation,
            totalCostValuation,
            lowStockCount,
            outOfStockCount,
            currency: curr
        };
    }

    renderStockStats() {
        const stats = this.calculateStats();

        const elTotalUnits = document.getElementById('statTotalUnits');
        const elTotalValuation = document.getElementById('statTotalValuation');
        const elLowStockCount = document.getElementById('statLowStockCount');
        const elOutOfStockCount = document.getElementById('statOutOfStockCount');
        const topLowStockBadge = document.getElementById('topNavLowStockBadge');

        if (elTotalUnits) elTotalUnits.textContent = stats.totalUnitsInStock.toLocaleString();
        if (elTotalValuation) elTotalValuation.textContent = `${stats.currency}${stats.totalValuation.toLocaleString()}`;
        if (elLowStockCount) elLowStockCount.textContent = stats.lowStockCount;
        if (elOutOfStockCount) elOutOfStockCount.textContent = stats.outOfStockCount;

        if (topLowStockBadge) {
            const totalAlerts = stats.lowStockCount + stats.outOfStockCount;
            if (totalAlerts > 0) {
                topLowStockBadge.style.display = 'inline-flex';
                topLowStockBadge.textContent = `${totalAlerts} Alert${totalAlerts > 1 ? 's' : ''}`;
            } else {
                topLowStockBadge.style.display = 'none';
            }
        }
    }

    // --- Supplier Stock Purchase Order Modals & Actions ---
    openSupplierOrderModal(productId = null) {
        const modal = document.getElementById('supplierOrderModal');
        const productSelect = document.getElementById('supplierOrderProductSelect');
        const products = this.store.getProducts();

        if (productSelect) {
            productSelect.innerHTML = products.map(p => `
                <option value="${p.id}" ${p.id === productId ? 'selected' : ''}>
                    ${p.name} (Current Stock: ${p.stock} ${p.unit})
                </option>
            `).join('');
        }

        const selectedProd = productId ? this.store.getProductById(productId) : products[0];
        if (selectedProd) {
            const costInput = document.getElementById('supplierOrderCostInput');
            if (costInput) costInput.value = selectedProd.cost || (selectedProd.price * 0.7);
        }

        if (modal) modal.classList.add('active');
    }

    handleSupplierOrderSubmit(e) {
        e.preventDefault();
        const productId = document.getElementById('supplierOrderProductSelect').value;
        const supplierName = document.getElementById('supplierOrderSupplierName').value.trim();
        const quantity = parseInt(document.getElementById('supplierOrderQuantity').value, 10);
        const costPerUnit = parseFloat(document.getElementById('supplierOrderCostInput').value) || 0;
        const expectedDate = document.getElementById('supplierOrderExpectedDate').value;

        const prod = this.store.getProductById(productId);
        if (!prod || !supplierName || isNaN(quantity) || quantity <= 0) {
            window.App.showToast('Please fill all supplier order fields correctly', 'warning');
            return;
        }

        const po = this.store.orderStockFromSupplier({
            productId: prod.id,
            productName: prod.name,
            supplierName,
            quantity,
            costPerUnit,
            expectedDate
        });

        if (po) {
            window.App.showToast(`📦 Purchase Order #${po.po_number || po.poNumber} created for ${quantity} ${prod.unit} of "${prod.name}"!`, 'success');
        } else {
            window.App.showToast('Failed to create purchase order', 'error');
        }

        window.App.closeModal('supplierOrderModal');
    }

    handleReceiveSupplierOrder(poId) {
        try {
            const success = this.store.receiveSupplierOrder(poId);
            if (success) {
                window.App.showToast('✅ Stock shipment received! SQLite inventory updated automatically.', 'success');
            } else {
                window.App.showToast('Failed to receive order', 'error');
            }
        } catch (err) {
            window.App.showToast(`Error receiving shipment: ${err.message}`, 'error');
        }
    }

    renderSupplierOrders() {
        const tbody = document.getElementById('supplierOrdersTableBody');
        if (!tbody) return;

        const orders = this.store.getSupplierOrders();
        const settings = this.store.getSettings();
        const curr = settings.currencySymbol || '₹';

        if (orders.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center py-6 text-muted">
                        No supplier purchase orders recorded yet. Click "Order Stock from Supplier" to replenish low stock.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = orders.map(po => {
            const isReceived = po.status === 'RECEIVED';
            return `
                <tr class="${isReceived ? 'row-received' : ''}">
                    <td><strong class="invoice-num">#${po.po_number || po.poNumber}</strong></td>
                    <td><strong>${po.product_name || po.productName}</strong></td>
                    <td>${po.supplier_name || po.supplierName}</td>
                    <td><span class="badge-log-positive">+${po.quantity}</span></td>
                    <td><strong class="text-price">${curr}${(po.total_cost || po.totalCost || 0).toLocaleString()}</strong></td>
                    <td>
                        <span class="badge-channel-sent ${isReceived ? 'whatsapp' : 'pending'}">
                            ${isReceived ? '✅ RECEIVED IN STOCK' : '⏳ PENDING SHIPMENT'}
                        </span>
                    </td>
                    <td class="text-right">
                        ${!isReceived ? `
                            <button class="btn btn-sm btn-primary" onclick="window.Inventory.handleReceiveSupplierOrder('${po.id}')" title="Confirm delivery and add stock to SQLite inventory">
                                📥 Mark as Received
                            </button>
                        ` : `
                            <span class="text-muted" style="font-size: 0.78rem;">Stock Added to Inventory</span>
                        `}
                    </td>
                </tr>
            `;
        }).join('');
    }

    // --- Quick Restock & Stock Adjustment Actions ---
    handleQuickRestock(productId, amount) {
        const updated = this.store.quickRestock(productId, amount);
        if (updated) {
            const sign = amount > 0 ? `+${amount}` : `${amount}`;
            window.App.showToast(`Stock updated (${sign} ${updated.unit}) for "${updated.name}"! New stock: ${updated.stock} ${updated.unit}`, 'success');
        }
    }

    promptCustomRestock(productId) {
        const prod = this.store.getProductById(productId);
        if (!prod) return;

        const input = prompt(
            `Adjust Stock for "${prod.name}" (Current stock: ${prod.stock} ${prod.unit}):\n\n` +
            `• Enter positive number (e.g. 10) to add stock.\n` +
            `• Enter negative number (e.g. -5) to deduct damaged/returned stock:`,
            '10'
        );
        if (input !== null) {
            const qty = parseInt(input, 10);
            if (!isNaN(qty) && qty !== 0) {
                if (prod.stock + qty < 0) {
                    window.App.showToast(`Cannot deduct ${Math.abs(qty)} units: Current stock is only ${prod.stock} ${prod.unit}`, 'warning');
                    return;
                }
                this.handleQuickRestock(productId, qty);
            } else {
                window.App.showToast('Invalid quantity entered', 'error');
            }
        }
    }

    orderInPOS(productId) {
        const prod = this.store.getProductById(productId);
        if (!prod) return;
        if (prod.stock <= 0) {
            window.App.showToast(`"${prod.name}" is OUT OF STOCK! Order stock from supplier first.`, 'warning');
            return;
        }
        window.Billing.addToCart(productId, 1);
        window.App.switchView('view-pos');
    }

    // --- Product Edit / Add Modals ---
    openAddProductModal() {
        this.editingProductId = null;
        const modal = document.getElementById('productFormModal');
        const titleEl = document.getElementById('productModalTitle');
        const form = document.getElementById('productForm');

        if (titleEl) titleEl.textContent = 'Add New Product to SQLite Database';
        if (form) form.reset();

        const idInput = document.getElementById('productFormId');
        if (idInput) idInput.value = '';

        if (modal) modal.classList.add('active');
    }

    openEditProductModal(productId) {
        const prod = this.store.getProductById(productId);
        if (!prod) return;

        this.editingProductId = productId;
        const modal = document.getElementById('productFormModal');
        const titleEl = document.getElementById('productModalTitle');

        if (titleEl) titleEl.textContent = `Edit Product: ${prod.name}`;

        document.getElementById('productFormId').value = prod.id;
        document.getElementById('productFormName').value = prod.name;
        document.getElementById('productFormSku').value = prod.sku;
        document.getElementById('productFormCategory').value = prod.category;
        document.getElementById('productFormPrice').value = prod.price;
        document.getElementById('productFormCost').value = prod.cost;
        document.getElementById('productFormStock').value = prod.stock;
        document.getElementById('productFormMinAlert').value = prod.minStockAlert;
        document.getElementById('productFormUnit').value = prod.unit || 'pcs';
        document.getElementById('productFormDesc').value = prod.description || '';
        const batchInput = document.getElementById('productFormBatchNo');
        const expiryInput = document.getElementById('productFormExpiryDate');
        if (batchInput) batchInput.value = prod.batchNo || '';
        if (expiryInput) expiryInput.value = prod.expiryDate || '';

        if (modal) modal.classList.add('active');
    }

    handleProductFormSubmit(e) {
        e.preventDefault();
        const id = document.getElementById('productFormId').value;
        const name = document.getElementById('productFormName').value.trim();
        const sku = document.getElementById('productFormSku').value.trim();
        const category = document.getElementById('productFormCategory').value.trim();
        const price = parseFloat(document.getElementById('productFormPrice').value);
        const cost = parseFloat(document.getElementById('productFormCost').value) || 0;
        const stock = parseInt(document.getElementById('productFormStock').value, 10);
        const minStockAlert = parseInt(document.getElementById('productFormMinAlert').value, 10) || 5;
        const unit = document.getElementById('productFormUnit').value.trim() || 'pcs';
        const description = document.getElementById('productFormDesc').value.trim();
        const batchNo = document.getElementById('productFormBatchNo')?.value.trim() || '';
        const expiryDate = document.getElementById('productFormExpiryDate')?.value || '';

        if (!name || !sku || isNaN(price) || isNaN(stock)) {
            window.App.showToast('Please fill all required product fields correctly.', 'warning');
            return;
        }

        if (id) {
            this.store.updateProduct(id, {
                name, sku, category, price, cost, stock, minStockAlert, unit, description, batchNo, expiryDate
            });
            window.App.showToast(`Updated "${name}" in SQLite database!`, 'success');
        } else {
            this.store.addProduct({
                name, sku, category, price, cost, stock, minStockAlert, unit, description, batchNo, expiryDate
            });
            window.App.showToast(`Added "${name}" with ${stock} ${unit} to SQLite database!`, 'success');
        }

        window.App.closeModal('productFormModal');
    }

    handleDeleteProduct(productId) {
        const prod = this.store.getProductById(productId);
        if (!prod) return;

        const confirmed = confirm(
            `Delete "${prod.name}" from SQLite Database?\n\n` +
            `This will permanently remove SKU: ${prod.sku} (Current stock: ${prod.stock}).`
        );

        if (confirmed) {
            this.store.deleteProduct(productId);
            window.App.showToast(`Product "${prod.name}" deleted from SQLite database`, 'info');
        }
    }

    // --- Rendering Inventory Table ---
    renderInventory() {
        const tbody = document.getElementById('inventoryTableBody');
        if (!tbody) return;

        const products = this.getFilteredInventory();
        const settings = this.store.getSettings();
        const curr = settings.currencySymbol || '₹';

        if (products.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="9" class="text-center py-6 text-muted">
                        <div class="empty-table-state">
                            <span class="empty-table-icon">📦</span>
                            <p>No inventory products found matching current criteria.</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = products.map(prod => {
            let statusBadge = '<span class="stock-badge badge-in-stock">In Stock</span>';
            let rowClass = '';

            if (prod.stock <= 0) {
                statusBadge = '<span class="stock-badge badge-out-of-stock">Out of Stock</span>';
                rowClass = 'row-danger';
            } else if (prod.stock <= prod.minStockAlert) {
                statusBadge = `<span class="stock-badge badge-low-stock">Low Stock (≤${prod.minStockAlert})</span>`;
                rowClass = 'row-warning';
            }

            let margin = 0;
            if (prod.price > 0 && prod.cost > 0) {
                margin = Math.round(((prod.price - prod.cost) / prod.price) * 100);
            }

            let expiryBadge = '';
            if (prod.expiryDate) {
                const today = new Date();
                const days = Math.ceil((new Date(prod.expiryDate + 'T00:00:00') - today) / (1000 * 60 * 60 * 24));
                if (days < 0) {
                    expiryBadge = `<span class="badge-exp badge-exp-danger" title="Expired on ${prod.expiryDate}">🔴 Expired (${Math.abs(days)}d ago)</span>`;
                } else if (days <= 15) {
                    expiryBadge = `<span class="badge-exp badge-exp-critical" title="Expires on ${prod.expiryDate}">🟠 Exp: ${prod.expiryDate} (${days}d left)</span>`;
                } else if (days <= 30) {
                    expiryBadge = `<span class="badge-exp badge-exp-warning" title="Expires on ${prod.expiryDate}">⏳ Exp: ${prod.expiryDate} (${days}d left)</span>`;
                } else {
                    expiryBadge = `<span class="badge-exp badge-exp-safe" title="Expires on ${prod.expiryDate}">Exp: ${prod.expiryDate}</span>`;
                }
            }

            return `
                <tr class="${rowClass}">
                    <td>
                        <div class="prod-cell-main">
                            <strong class="prod-name-title">${prod.name}</strong>
                            <div style="display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; margin-top: 0.2rem;">
                                <span class="prod-cell-sku">${prod.sku}</span>
                                ${prod.batchNo ? `<span class="badge-batch">${prod.batchNo}</span>` : ''}
                                ${expiryBadge}
                            </div>
                        </div>
                    </td>
                    <td>
                        <span class="category-pill">${prod.category}</span>
                    </td>
                    <td>
                        <strong class="text-price">${curr}${prod.price.toLocaleString()}</strong>
                        <div class="text-unit">per ${prod.unit}</div>
                    </td>
                    <td>
                        <span class="text-cost">${curr}${prod.cost.toLocaleString()}</span>
                        ${margin > 0 ? `<span class="badge-margin">+${margin}%</span>` : ''}
                    </td>
                    <td>
                        <div class="stock-count-cell">
                            <strong class="stock-num ${prod.stock <= 0 ? 'text-danger' : prod.stock <= prod.minStockAlert ? 'text-warning' : 'text-success'}">
                                ${prod.stock} ${prod.unit}
                            </strong>
                            ${statusBadge}
                        </div>
                    </td>
                    <td>
                        <span class="text-muted">${prod.minStockAlert} ${prod.unit}</span>
                    </td>
                    <td>
                        <div class="quick-restock-actions">
                            <button class="btn-restock-quick" onclick="window.Inventory.handleQuickRestock('${prod.id}', 10)" title="Quick Restock +10">+10</button>
                            <button class="btn-restock-quick" onclick="window.Inventory.handleQuickRestock('${prod.id}', 50)" title="Quick Restock +50">+50</button>
                            <button class="btn-restock-custom" onclick="window.Inventory.promptCustomRestock('${prod.id}')" title="Custom Restock Qty">➕</button>
                        </div>
                    </td>
                    <td>
                        <div style="display: flex; gap: 0.35rem; align-items: center; flex-wrap: wrap;">
                            <button class="btn btn-sm btn-primary-soft" onclick="window.Inventory.orderInPOS('${prod.id}')" title="Order / Sell this product via POS Billing">
                                🛒 Order (Sell)
                            </button>
                            <button class="btn btn-sm btn-secondary" onclick="window.Inventory.openSupplierOrderModal('${prod.id}')" title="Order stock for this product from supplier">
                                🚚 Supplier PO
                            </button>
                        </div>
                    </td>
                    <td class="text-right">
                        <div class="action-buttons-group">
                            <button class="btn-action-icon edit" onclick="window.Inventory.openEditProductModal('${prod.id}')" title="Edit product details">✏️</button>
                            <button class="btn-action-icon delete" onclick="window.Inventory.handleDeleteProduct('${prod.id}')" title="Delete product">🗑️</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // --- Rendering Stock Movement Audit Logs ---
    renderStockLogs() {
        const tbody = document.getElementById('stockLogsTableBody');
        if (!tbody) return;

        const logs = this.store.getStockLogs();

        if (logs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="6" class="text-center py-6 text-muted">
                        No stock movement logs recorded yet in SQLite database.
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = logs.map(log => {
            let deltaBadge = '';
            if (log.delta !== undefined) {
                if (log.delta > 0) {
                    deltaBadge = `<span class="badge-log-positive">+${log.delta}</span>`;
                } else if (log.delta < 0) {
                    deltaBadge = `<span class="badge-log-negative">${log.delta}</span>`;
                } else {
                    deltaBadge = `<span class="badge-log-neutral">0</span>`;
                }
            }

            let typeIcon = '📦';
            let typeBadgeClass = 'badge-type-misc';
            if (log.type === 'BILL_SALE') {
                typeIcon = '🛒';
                typeBadgeClass = 'badge-type-sale';
            } else if (log.type === 'RESTOCK_MANUAL') {
                typeIcon = '📥';
                typeBadgeClass = 'badge-type-restock';
            } else if (log.type === 'RESTOCK_SUPPLIER') {
                typeIcon = '🚚';
                typeBadgeClass = 'badge-type-restock';
            } else if (log.type === 'BILL_CANCELLED_RESTORE') {
                typeIcon = '🔄';
                typeBadgeClass = 'badge-type-restore';
            } else if (log.type === 'PRODUCT_CREATED') {
                typeIcon = '✨';
                typeBadgeClass = 'badge-type-new';
            }

            return `
                <tr>
                    <td>
                        <span class="log-time">${log.date} <small>${log.time}</small></span>
                    </td>
                    <td>
                        <span class="badge-log-type ${typeBadgeClass}">${typeIcon} ${(log.type || '').replace(/_/g, ' ')}</span>
                    </td>
                    <td>
                        <strong>${log.productName || 'Catalog'}</strong>
                        ${log.referenceId ? `<span class="log-ref">Ref: #${log.referenceId}</span>` : ''}
                    </td>
                    <td>${deltaBadge}</td>
                    <td>
                        <strong>${log.newStock !== undefined ? log.newStock : '-'}</strong>
                    </td>
                    <td>
                        <span class="log-details-text">${log.details || log.title || ''}</span>
                    </td>
                </tr>
            `;
        }).join('');
    }
}

window.Inventory = new InventoryManager();
