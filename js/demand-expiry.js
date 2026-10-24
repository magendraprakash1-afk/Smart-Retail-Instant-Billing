/**
 * QuickBill Pro - AI Demand Forecasting & Expiry Shelf-Life Radar Module
 * Analyzes previous month sales velocity, predicts stockouts, suggests supplier reorders,
 * and tracks batches nearing expiration to prevent inventory loss.
 */

class DemandExpiryManager {
    constructor() {
        this.store = window.Store;
        this.currentPeriod = 'PREV_MONTH';
        this.activeSubtab = 'demand';
        this.searchQuery = '';
        this.categoryFilter = 'ALL';
        this.urgencyFilter = 'ALL';

        this.init();
    }

    init() {
        this.store.subscribe((event) => {
            if (event === 'PRODUCTS_UPDATED' || event === 'INVOICES_UPDATED' || event === 'STOCK_LOGS_UPDATED') {
                this.updateNavBadge();
                const view = document.getElementById('view-demand-expiry');
                if (view && view.classList.contains('active')) {
                    this.renderAll();
                }
            }
        });
    }

    setPeriod(period) {
        this.currentPeriod = period;
        this.renderAll();
    }

    setSubtab(tab) {
        this.activeSubtab = tab;
        document.querySelectorAll('.ai-subtab-btn').forEach(btn => {
            if (btn.getAttribute('data-subtab') === tab) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        const demandPanel = document.getElementById('panelDemandForecast');
        const expiryPanel = document.getElementById('panelExpiryRadar');

        if (demandPanel) demandPanel.style.display = tab === 'demand' ? 'block' : 'none';
        if (expiryPanel) expiryPanel.style.display = tab === 'expiry' ? 'block' : 'none';

        this.renderAll();
    }

    setSearchQuery(query) {
        this.searchQuery = (query || '').toLowerCase().trim();
        this.renderTablesOnly();
    }

    setCategoryFilter(category) {
        this.categoryFilter = category;
        this.renderTablesOnly();
    }

    setUrgencyFilter(urgency) {
        this.urgencyFilter = urgency;
        this.renderTablesOnly();
    }

    renderAll() {
        this.renderStats();
        this.renderTablesOnly();
        this.updateNavBadge();
    }

    renderStats() {
        const demandList = this.store.getDemandAnalysis(this.currentPeriod);
        const expiryList = this.store.getExpiryAnalysis();
        const settings = this.store.getSettings();
        const curr = settings.currencySymbol || '₹';

        const highDemandCount = demandList.filter(d => d.urgencyScore <= 3 && d.recommendedReorder > 0).length;
        const totalReorderCapital = demandList.reduce((sum, d) => sum + (d.estimatedCost || 0), 0);

        const nearExpiryCount = expiryList.filter(e => e.daysLeft <= 30).length;
        const totalAtRiskCapital = expiryList.filter(e => e.daysLeft <= 30).reduce((sum, e) => sum + (e.capitalAtRisk || 0), 0);

        const elHighDemand = document.getElementById('statDemandReordersCount');
        const elReorderCost = document.getElementById('statTotalReorderCapital');
        const elNearExpiry = document.getElementById('statNearExpiryCount');
        const elAtRisk = document.getElementById('statAtRiskCapital');

        if (elHighDemand) elHighDemand.textContent = highDemandCount;
        if (elReorderCost) elReorderCost.textContent = `${curr}${Math.round(totalReorderCapital).toLocaleString()}`;
        if (elNearExpiry) elNearExpiry.textContent = nearExpiryCount;
        if (elAtRisk) elAtRisk.textContent = `${curr}${Math.round(totalAtRiskCapital).toLocaleString()}`;
    }

    renderTablesOnly() {
        if (this.activeSubtab === 'demand') {
            this.renderDemandTable();
        } else {
            this.renderExpiryTable();
        }
    }

    renderDemandTable() {
        const tbody = document.getElementById('demandForecastTableBody');
        if (!tbody) return;

        let list = this.store.getDemandAnalysis(this.currentPeriod);
        const settings = this.store.getSettings();
        const curr = settings.currencySymbol || '₹';

        // Filtering
        if (this.categoryFilter && this.categoryFilter !== 'ALL') {
            list = list.filter(i => (i.category || '').toLowerCase() === this.categoryFilter.toLowerCase());
        }

        if (this.searchQuery) {
            list = list.filter(i =>
                i.name.toLowerCase().includes(this.searchQuery) ||
                i.sku.toLowerCase().includes(this.searchQuery) ||
                (i.category || '').toLowerCase().includes(this.searchQuery)
            );
        }

        if (this.urgencyFilter && this.urgencyFilter !== 'ALL') {
            if (this.urgencyFilter === 'REORDER_ONLY') {
                list = list.filter(i => i.recommendedReorder > 0);
            } else if (this.urgencyFilter === 'CRITICAL') {
                list = list.filter(i => i.urgencyScore <= 2);
            } else if (this.urgencyFilter === 'HIGH') {
                list = list.filter(i => i.urgencyScore <= 3);
            }
        }

        if (list.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" class="text-center py-6 text-muted">
                        <div class="empty-table-state">
                            <span class="empty-table-icon">📈</span>
                            <p>No products match current demand criteria.</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = list.map(item => {
            const runwayPercent = Math.min(100, Math.round((item.daysOfStockLeft / 30) * 100));
            let runwayBarColor = '#10b981';
            if (item.daysOfStockLeft <= 7) runwayBarColor = '#f43f5e';
            else if (item.daysOfStockLeft <= 15) runwayBarColor = '#f59e0b';
            else if (item.daysOfStockLeft <= 30) runwayBarColor = '#38bdf8';

            let urgencyBadge = `<span class="badge-demand ${item.urgencyBadgeClass}">${item.urgencyLabel}</span>`;

            return `
                <tr class="${item.urgencyScore <= 2 ? 'row-danger' : item.urgencyScore === 3 ? 'row-warning' : ''}">
                    <td>
                        <div class="prod-cell-main">
                            <strong class="prod-name-title">${item.name}</strong>
                            <div style="display: flex; gap: 0.4rem; align-items: center; margin-top: 0.2rem;">
                                <span class="prod-cell-sku">${item.sku}</span>
                                <span class="category-pill" style="font-size: 0.68rem; padding: 0.1rem 0.45rem;">${item.category}</span>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div style="display: flex; flex-direction: column;">
                            <strong style="color: #fff; font-size: 0.95rem;">${item.unitsSoldLastMonth} ${item.unit}</strong>
                            <span class="text-muted" style="font-size: 0.75rem;">⚡ ${item.dailyVelocity} ${item.unit}/day velocity</span>
                        </div>
                    </td>
                    <td>
                        <strong class="stock-num ${item.currentStock <= 0 ? 'text-danger' : item.currentStock <= item.minStockAlert ? 'text-warning' : 'text-success'}">
                            ${item.currentStock} ${item.unit}
                        </strong>
                        <div class="text-muted" style="font-size: 0.72rem;">Min Alert: ${item.minStockAlert} ${item.unit}</div>
                    </td>
                    <td>
                        <div style="min-width: 110px;">
                            <div style="display: flex; justify-content: space-between; font-size: 0.78rem; font-weight: 600; margin-bottom: 0.2rem;">
                                <span style="color: ${runwayBarColor};">${item.daysOfStockLeft < 999 ? item.daysOfStockLeft + ' days' : 'Abundant'}</span>
                                <span class="text-muted">${runwayPercent}%</span>
                            </div>
                            <div style="background: rgba(255,255,255,0.08); height: 6px; border-radius: 3px; overflow: hidden;">
                                <div style="background: ${runwayBarColor}; width: ${runwayPercent}%; height: 100%; border-radius: 3px;"></div>
                            </div>
                        </div>
                    </td>
                    <td>${urgencyBadge}</td>
                    <td>
                        ${item.recommendedReorder > 0 ? `
                            <div style="display: flex; flex-direction: column;">
                                <strong style="color: var(--primary); font-size: 1.05rem;">+${item.recommendedReorder} ${item.unit}</strong>
                                <span class="text-muted" style="font-size: 0.72rem;">Est. Cost: ${curr}${item.estimatedCost.toLocaleString()}</span>
                            </div>
                        ` : `
                            <span class="text-muted" style="font-size: 0.8rem;">Adequate Stock</span>
                        `}
                    </td>
                    <td class="text-right">
                        <div style="display: flex; gap: 0.4rem; justify-content: flex-end; align-items: center; flex-wrap: wrap;">
                            ${item.recommendedReorder > 0 ? `
                                <button class="btn btn-sm btn-primary" onclick="window.DemandExpiry.handleReorderClick('${item.productId}', ${item.recommendedReorder})" title="Create Supplier Purchase Order pre-filled with ${item.recommendedReorder} units">
                                    📦 1-Click Reorder
                                </button>
                            ` : `
                                <button class="btn btn-sm btn-secondary" onclick="window.DemandExpiry.handleReorderClick('${item.productId}', 20)" title="Re-order stock from vendor">
                                    🚚 Reorder
                                </button>
                            `}
                            <button class="btn btn-sm btn-secondary" onclick="window.Inventory.orderInPOS('${item.productId}')" title="Order this product in POS">
                                🛒 POS
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    renderExpiryTable() {
        const tbody = document.getElementById('expiryRadarTableBody');
        if (!tbody) return;

        let list = this.store.getExpiryAnalysis();
        const settings = this.store.getSettings();
        const curr = settings.currencySymbol || '₹';

        if (this.categoryFilter && this.categoryFilter !== 'ALL') {
            list = list.filter(i => (i.category || '').toLowerCase() === this.categoryFilter.toLowerCase());
        }

        if (this.searchQuery) {
            list = list.filter(i =>
                i.name.toLowerCase().includes(this.searchQuery) ||
                i.sku.toLowerCase().includes(this.searchQuery) ||
                (i.batchNo || '').toLowerCase().includes(this.searchQuery)
            );
        }

        if (list.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center py-6 text-muted">
                        <div class="empty-table-state">
                            <span class="empty-table-icon">⏳</span>
                            <p>No products found with tracked expiration dates.</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = list.map(item => {
            let rowClass = '';
            if (item.status === 'EXPIRED') rowClass = 'row-danger';
            else if (item.status === 'CRITICAL') rowClass = 'row-warning';

            return `
                <tr class="${rowClass}">
                    <td>
                        <div class="prod-cell-main">
                            <strong class="prod-name-title">${item.name}</strong>
                            <div style="display: flex; gap: 0.4rem; align-items: center; margin-top: 0.2rem;">
                                <span class="prod-cell-sku">${item.sku}</span>
                                <span class="badge-batch">${item.batchNo}</span>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div style="font-weight: 600; color: #fff;">${item.expiryDate}</div>
                    </td>
                    <td>
                        <span class="badge-exp ${item.statusBadgeClass}">${item.statusLabel}</span>
                    </td>
                    <td>
                        <strong>${item.stock} ${item.unit}</strong>
                    </td>
                    <td>
                        <div>
                            <strong class="text-price" style="color: #f43f5e;">${curr}${item.capitalAtRisk.toLocaleString()}</strong>
                            <div class="text-muted" style="font-size: 0.72rem;">Retail: ${curr}${item.retailAtRisk.toLocaleString()}</div>
                        </div>
                    </td>
                    <td>
                        <span class="badge-channel-sent ${item.status === 'EXPIRED' ? 'pending' : 'whatsapp'}" style="font-size: 0.75rem;">
                            ${item.recommendedAction}
                        </span>
                    </td>
                    <td class="text-right">
                        <div style="display: flex; gap: 0.4rem; justify-content: flex-end; align-items: center; flex-wrap: wrap;">
                            ${item.status !== 'EXPIRED' ? `
                                <button class="btn btn-sm btn-whatsapp" onclick="window.DemandExpiry.openClearanceDiscount('${item.productId}', ${item.clearanceDiscountPercent})" title="Apply discounted clearance pricing in SQLite to liquidate fast">
                                    🏷️ Set Clearance (${item.clearanceDiscountPercent}%)
                                </button>
                                <button class="btn btn-sm btn-secondary" onclick="window.Inventory.orderInPOS('${item.productId}')" title="Sell in POS">
                                    🛒 POS
                                </button>
                            ` : `
                                <button class="btn btn-sm btn-danger" onclick="window.DemandExpiry.openDisposeModal('${item.productId}')" title="Record loss and dispose expired stock from inventory">
                                    🗑️ Write-Off
                                </button>
                            `}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    handleReorderClick(productId, suggestedQty) {
        window.Inventory.openSupplierOrderModal(productId);
        const qtyInput = document.getElementById('supplierOrderQuantity');
        if (qtyInput) {
            qtyInput.value = suggestedQty;
        }
        window.App.showToast(`Pre-filled Supplier Purchase Order with AI-recommended ${suggestedQty} units!`, 'info');
    }

    openClearanceDiscount(productId, suggestedPercent) {
        const prod = this.store.getProductById(productId);
        if (!prod) return;

        const input = prompt(
            `Apply Clearance Discount for "${prod.name}" (Current Price: ₹${prod.price})\n\n` +
            `Expiry Date: ${prod.expiryDate}\n` +
            `Stock at Risk: ${prod.stock} ${prod.unit}\n\n` +
            `Enter discount percentage to apply (e.g. 20, 30, 40):`,
            suggestedPercent || '30'
        );

        if (input !== null) {
            const percent = parseInt(input, 10);
            if (!isNaN(percent) && percent > 0 && percent < 100) {
                const res = this.store.applyClearanceDiscount(productId, percent);
                if (res) {
                    window.App.showToast(`🎉 Clearance price set to ₹${res.newPrice} (${percent}% off) for "${prod.name}"!`, 'success');
                    this.renderAll();
                }
            } else {
                window.App.showToast('Please enter a valid discount percentage (1-99%)', 'warning');
            }
        }
    }

    openDisposeModal(productId) {
        const prod = this.store.getProductById(productId);
        if (!prod) return;

        const confirmed = confirm(
            `CONFIRM DISPOSAL OF EXPIRED STOCK\n\n` +
            `Product: ${prod.name} (${prod.sku})\n` +
            `Expired on: ${prod.expiryDate}\n` +
            `Units to write off: ${prod.stock} ${prod.unit}\n` +
            `Loss valuation: ₹${(prod.stock * prod.cost).toLocaleString()}\n\n` +
            `This will remove the expired stock from inventory and log the write-off in the Stock Audit Ledger.`
        );

        if (confirmed) {
            const ok = this.store.disposeExpiredStock(productId, null, 'Expired Shelf-Life Disposal');
            if (ok) {
                window.App.showToast(`🗑️ Disposed ${prod.stock} ${prod.unit} of expired stock for "${prod.name}".`, 'info');
                this.renderAll();
            }
        }
    }

    updateNavBadge() {
        const expiryList = this.store.getExpiryAnalysis();
        const demandList = this.store.getDemandAnalysis(this.currentPeriod);

        const expiringCount = expiryList.filter(e => e.daysLeft <= 30).length;
        const criticalReorders = demandList.filter(d => d.urgencyScore <= 2 && d.recommendedReorder > 0).length;

        const navBadge = document.getElementById('topNavDemandExpiryBadge');
        if (navBadge) {
            const totalAlerts = expiringCount + criticalReorders;
            if (totalAlerts > 0) {
                navBadge.style.display = 'inline-flex';
                navBadge.textContent = `${totalAlerts} Alert${totalAlerts > 1 ? 's' : ''}`;
                navBadge.style.background = expiringCount > 0 ? '#f43f5e' : '#f59e0b';
                navBadge.style.color = '#fff';
            } else {
                navBadge.style.display = 'none';
            }
        }
    }
}

window.DemandExpiry = new DemandExpiryManager();
