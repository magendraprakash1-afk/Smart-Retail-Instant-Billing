/**
 * QuickBill Pro - Main Application Controller
 * Handles Navigation, Orders Ledger, SQLite Console, Supplier POs, and Modals.
 */

class AppController {
    constructor() {
        this.store = window.Store;
        this.messaging = window.Messaging;
        this.currentActiveInvoice = null;
        this.activeMessageChannel = 'whatsapp';

        this.init();
    }

    init() {
        this.setupNavigation();
        this.setupKeyboardShortcuts();
        this.setupSettingsForm();
        this.setupInvoiceFilters();

        this.store.subscribe((event) => {
            if (event === 'INVOICES_UPDATED') {
                this.renderInvoicesTable();
                this.renderTopMetrics();
            }
            if (event === 'SETTINGS_UPDATED') {
                this.applyStoreSettings();
            }
        });

        // Delay to allow SQLite WebAssembly to initialize cleanly
        setTimeout(() => {
            this.applyStoreSettings();
            this.renderInvoicesTable();
            this.renderTopMetrics();
            if (window.Billing) {
                window.Billing.renderCatalog();
                window.Billing.renderCart();
                window.Billing.resetBillNumber();
            }
            if (window.Inventory) {
                window.Inventory.renderInventory();
                window.Inventory.renderStockStats();
                window.Inventory.renderStockLogs();
                window.Inventory.renderSupplierOrders();
            }
            if (window.DemandExpiry) {
                window.DemandExpiry.renderAll();
            }
        }, 120);
    }

    // --- Navigation Tabs ---
    setupNavigation() {
        const navBtns = document.querySelectorAll('.nav-tab-btn');
        navBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetViewId = btn.getAttribute('data-target');
                this.switchView(targetViewId);
            });
        });
    }

    switchView(viewId) {
        document.querySelectorAll('.nav-tab-btn').forEach(btn => {
            if (btn.getAttribute('data-target') === viewId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        document.querySelectorAll('.app-view').forEach(view => {
            if (view.id === viewId) {
                view.classList.add('active');
            } else {
                view.classList.remove('active');
            }
        });

        if (viewId === 'view-pos' && window.Billing) {
            window.Billing.renderCatalog();
            window.Billing.renderCart();
        } else if (viewId === 'view-inventory' && window.Inventory) {
            window.Inventory.renderInventory();
            window.Inventory.renderStockStats();
            window.Inventory.renderSupplierOrders();
        } else if (viewId === 'view-invoices') {
            this.renderInvoicesTable();
        } else if (viewId === 'view-stock-logs' && window.Inventory) {
            window.Inventory.renderStockLogs();
        } else if (viewId === 'view-demand-expiry' && window.DemandExpiry) {
            window.DemandExpiry.renderAll();
        }
    }

    // --- Top Metrics Bar ---
    renderTopMetrics() {
        const invoices = this.store.getInvoices();
        const settings = this.store.getSettings();
        const curr = settings.currencySymbol || '₹';

        const todayStr = new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

        const activeInvoices = invoices.filter(inv => inv.status !== 'VOIDED');
        const todayInvoices = activeInvoices.filter(inv => inv.date === todayStr);

        const todaySales = todayInvoices.reduce((sum, inv) => sum + (inv.pricing ? inv.pricing.grandTotal : 0), 0);
        const totalSales = activeInvoices.reduce((sum, inv) => sum + (inv.pricing ? inv.pricing.grandTotal : 0), 0);

        const elTodaySales = document.getElementById('metricTodaySales');
        const elTotalBills = document.getElementById('metricTotalBills');
        const elTotalSales = document.getElementById('metricTotalSales');

        if (elTodaySales) elTodaySales.textContent = `${curr}${todaySales.toLocaleString()}`;
        if (elTotalBills) elTotalBills.textContent = activeInvoices.length.toLocaleString();
        if (elTotalSales) elTotalSales.textContent = `${curr}${totalSales.toLocaleString()}`;
    }

    // --- Invoices & Message History ---
    setupInvoiceFilters() {
        const searchInput = document.getElementById('invoiceSearchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.renderInvoicesTable(e.target.value.toLowerCase().trim());
            });
        }
    }

    renderInvoicesTable(filterQuery = '') {
        const tbody = document.getElementById('invoicesTableBody');
        if (!tbody) return;

        let invoices = this.store.getInvoices();
        const settings = this.store.getSettings();
        const curr = settings.currencySymbol || '₹';

        if (filterQuery) {
            invoices = invoices.filter(inv =>
                (inv.billNumber || '').toLowerCase().includes(filterQuery) ||
                (inv.customer?.name || '').toLowerCase().includes(filterQuery) ||
                (inv.customer?.phone && inv.customer.phone.includes(filterQuery))
            );
        }

        if (invoices.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="text-center py-6 text-muted">
                        <div class="empty-table-state">
                            <span class="empty-table-icon">🧾</span>
                            <p>${filterQuery ? 'No matching orders found in SQLite.' : 'No customer orders placed yet. Add products to order in POS terminal!'}</p>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = invoices.map(inv => {
            const isVoided = inv.status === 'VOIDED';
            const itemsCount = (inv.items || []).reduce((sum, i) => sum + i.quantity, 0);

            let msgBadges = [];
            if (inv.messageDispatched?.whatsapp) {
                msgBadges.push('<span class="badge-channel-sent whatsapp">🟢 WhatsApp Sent</span>');
            }
            if (inv.messageDispatched?.sms) {
                msgBadges.push('<span class="badge-channel-sent sms">🔵 SMS Sent</span>');
            }
            if (msgBadges.length === 0) {
                msgBadges.push('<span class="badge-channel-pending">🟡 Not Dispatched</span>');
            }

            const grandTotal = inv.pricing?.grandTotal || 0;

            return `
                <tr class="${isVoided ? 'row-voided' : ''}">
                    <td>
                        <strong class="invoice-num">#${inv.billNumber}</strong>
                        ${isVoided ? '<span class="badge-voided">VOIDED</span>' : ''}
                    </td>
                    <td>
                        <span class="invoice-datetime">${inv.date} <small>${inv.time}</small></span>
                    </td>
                    <td>
                        <div class="customer-info-cell">
                            <strong>${inv.customer?.name || 'Customer'}</strong>
                            <span class="customer-phone">${inv.customer?.phone || 'No Phone'}</span>
                        </div>
                    </td>
                    <td>
                        <span class="badge-items-count">${itemsCount} item${itemsCount > 1 ? 's' : ''}</span>
                    </td>
                    <td>
                        <strong class="invoice-total ${isVoided ? 'line-through' : ''}">${curr}${grandTotal.toLocaleString()}</strong>
                        <div class="text-payment-mode">${inv.paymentMethod}</div>
                    </td>
                    <td>
                        <div class="msg-status-stack">
                            ${msgBadges.join(' ')}
                        </div>
                    </td>
                    <td class="text-right">
                        <div class="invoice-actions-group">
                            <button class="btn btn-sm btn-primary-soft" onclick="window.App.openMessageModalForInvoice('${inv.id}')" title="Send or resend bill via WhatsApp/SMS">
                                💬 Send Message Bill
                            </button>
                            <button class="btn btn-sm btn-secondary" onclick="window.App.viewReceiptModal('${inv.id}')" title="View digital receipt">
                                👁️ View E-Bill
                            </button>
                            ${!isVoided ? `
                                <button class="btn btn-sm btn-danger-soft" onclick="window.App.handleVoidInvoice('${inv.id}')" title="Cancel order and restore stock in SQLite">
                                    ↩️ Void & Restore Stock
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    handleVoidInvoice(invoiceId) {
        const inv = this.store.getInvoiceById(invoiceId);
        if (!inv) return;

        const reason = prompt(
            `Void Order #${inv.billNumber}?\n\n` +
            `This will RESTORE all items back into the SQLite stock inventory.\n\n` +
            `Reason for cancellation:`,
            'Customer Return / Error'
        );

        if (reason !== null) {
            const success = this.store.voidInvoice(invoiceId, reason || 'Cancelled');
            if (success) {
                this.showToast(`Order #${inv.billNumber} voided. Stock returned to SQLite inventory!`, 'info');
            }
        }
    }

    // --- Message Dispatch Modal Orchestration ---
    openMessageModal(invoice) {
        this.currentActiveInvoice = invoice;
        const modal = document.getElementById('messageDispatchModal');
        if (!modal) return;

        document.getElementById('modalCustomerName').textContent = invoice.customer?.name || 'Customer';
        document.getElementById('modalCustomerPhone').textContent = invoice.customer?.phone || 'No phone entered';
        document.getElementById('modalInvoiceNumber').textContent = '#' + invoice.billNumber;
        document.getElementById('modalInvoiceTotal').textContent = 
            (this.store.getSettings().currencySymbol || '₹') + (invoice.pricing?.grandTotal || 0).toLocaleString();

        this.setMessageTab('whatsapp');
        modal.classList.add('active');
    }

    openMessageModalForInvoice(invoiceId) {
        const invoice = this.store.getInvoiceById(invoiceId);
        if (invoice) {
            this.openMessageModal(invoice);
        }
    }

    setMessageTab(channel) {
        this.activeMessageChannel = channel;
        
        document.querySelectorAll('.msg-channel-tab').forEach(tab => {
            if (tab.getAttribute('data-channel') === channel) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });

        const textArea = document.getElementById('messageTextPreview');
        const receiptPreview = document.getElementById('messageReceiptCardContainer');
        const textContainer = document.getElementById('messageTextContainer');
        const btnSendWhatsApp = document.getElementById('btnActionSendWhatsApp');
        const btnSendSMS = document.getElementById('btnActionSendSMS');

        if (!this.currentActiveInvoice) return;

        if (channel === 'whatsapp') {
            textContainer.style.display = 'block';
            receiptPreview.style.display = 'none';
            textArea.value = this.messaging.generateWhatsAppBill(this.currentActiveInvoice);
            btnSendWhatsApp.style.display = 'inline-flex';
            btnSendSMS.style.display = 'none';
        } else if (channel === 'sms') {
            textContainer.style.display = 'block';
            receiptPreview.style.display = 'none';
            textArea.value = this.messaging.generateSMSBill(this.currentActiveInvoice);
            btnSendWhatsApp.style.display = 'none';
            btnSendSMS.style.display = 'inline-flex';
        } else if (channel === 'receipt') {
            textContainer.style.display = 'none';
            receiptPreview.style.display = 'block';
            receiptPreview.innerHTML = this.messaging.renderDigitalReceiptHtml(this.currentActiveInvoice);
            btnSendWhatsApp.style.display = 'none';
            btnSendSMS.style.display = 'none';
        }
    }

    dispatchViaWhatsApp() {
        if (!this.currentActiveInvoice) return;
        const textArea = document.getElementById('messageTextPreview');
        const messageText = textArea ? textArea.value : this.messaging.generateWhatsAppBill(this.currentActiveInvoice);
        const phone = this.currentActiveInvoice.customer?.phone;

        const whatsappUrl = this.messaging.buildWhatsAppUrl(phone, messageText);
        this.store.markMessageSent(this.currentActiveInvoice.id, 'whatsapp');
        window.open(whatsappUrl, '_blank');

        this.showToast(`Opening WhatsApp to send Bill #${this.currentActiveInvoice.billNumber}...`, 'success');
        this.closeModal('messageDispatchModal');
    }

    dispatchViaSMS() {
        if (!this.currentActiveInvoice) return;
        const textArea = document.getElementById('messageTextPreview');
        const messageText = textArea ? textArea.value : this.messaging.generateSMSBill(this.currentActiveInvoice);
        const phone = this.currentActiveInvoice.customer?.phone;

        const smsUrl = this.messaging.buildSMSUrl(phone, messageText);
        this.store.markMessageSent(this.currentActiveInvoice.id, 'sms');
        window.location.href = smsUrl;

        this.showToast(`Triggering SMS for Bill #${this.currentActiveInvoice.billNumber}...`, 'success');
        this.closeModal('messageDispatchModal');
    }

    async copyCurrentMessage() {
        const textArea = document.getElementById('messageTextPreview');
        if (!textArea) return;

        const success = await this.messaging.copyToClipboard(textArea.value);
        if (success) {
            this.showToast('📋 Bill message copied to clipboard!', 'success');
            const btnCopy = document.getElementById('btnCopyMessageText');
            if (btnCopy) {
                const originalHtml = btnCopy.innerHTML;
                btnCopy.innerHTML = '✅ Copied!';
                setTimeout(() => { btnCopy.innerHTML = originalHtml; }, 2000);
            }
        }
    }

    viewReceiptModal(invoiceId) {
        const invoice = this.store.getInvoiceById(invoiceId);
        if (!invoice) return;

        const modal = document.getElementById('receiptPreviewModal');
        const content = document.getElementById('receiptPreviewModalContent');
        if (content) {
            content.innerHTML = this.messaging.renderDigitalReceiptHtml(invoice);
        }
        if (modal) modal.classList.add('active');
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.classList.remove('active');
    }

    // --- Interactive SQLite Console Handler ---
    executeCustomSQL() {
        const input = document.getElementById('customSqlInput');
        const container = document.getElementById('sqlResultsContainer');
        if (!input || !container) return;

        const sql = input.value.trim();
        if (!sql) {
            this.showToast('Please type a SQL query to execute', 'warning');
            return;
        }

        const res = this.store.runSQLQuery(sql);

        if (res.error) {
            container.innerHTML = `
                <div style="background: rgba(244, 63, 94, 0.15); border: 1px solid var(--danger); padding: 0.85rem; border-radius: 8px; color: #fb7185; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem;">
                    ❌ <strong>SQL Error:</strong> ${res.error}
                </div>
            `;
            return;
        }

        if (res.results && res.results.length > 0) {
            const resultData = res.results[0];
            const columns = resultData.columns;
            const values = resultData.values;

            const headerHtml = columns.map(c => `<th style="padding: 0.5rem 0.8rem; background: var(--bg-surface-elevated); color: var(--primary);">${c}</th>`).join('');
            const rowsHtml = values.map(row => `
                <tr style="border-bottom: 1px solid var(--border-subtle);">
                    ${row.map(val => `<td style="padding: 0.5rem 0.8rem; font-family: 'JetBrains Mono', monospace; font-size: 0.82rem;">${val !== null ? val : 'NULL'}</td>`).join('')}
                </tr>
            `).join('');

            container.innerHTML = `
                <div style="margin-bottom: 0.4rem; color: #34d399; font-size: 0.82rem; font-weight: 600;">
                    ✅ Query executed successfully (${values.length} row${values.length !== 1 ? 's' : ''} returned):
                </div>
                <table style="width: 100%; border-collapse: collapse; text-align: left; background: #080b12; border-radius: 8px; overflow: hidden;">
                    <thead><tr style="border-bottom: 1px solid var(--border-highlight);">${headerHtml}</tr></thead>
                    <tbody>${rowsHtml}</tbody>
                </table>
            `;
        } else {
            container.innerHTML = `
                <div style="background: rgba(16, 185, 129, 0.15); border: 1px solid var(--primary); padding: 0.85rem; border-radius: 8px; color: #34d399; font-family: 'JetBrains Mono', monospace; font-size: 0.85rem;">
                    ✅ Statement executed successfully. Database state updated.
                </div>
            `;
        }
    }

    async handleUniversalFileImport(file) {
        if (!file) return;
        const name = file.name.toLowerCase();
        
        try {
            if (name.endsWith('.xlsx') || name.endsWith('.xls') || name.endsWith('.csv')) {
                this.showToast(`Reading and importing ${file.name} locally into SQLite (No server upload)...`, 'info');
                const res = await this.store.importExcelOrCSVFile(file);
                this.showToast(`✅ Successfully imported ${res.count} records from ${file.name} into SQLite! (Zero server upload)`, 'success');
                this.switchView('view-inventory');
            } else if (name.endsWith('.sqlite') || name.endsWith('.db')) {
                this.showToast(`Importing SQLite database ${file.name}...`, 'info');
                const ok = await this.store.importSQLiteFile(file);
                if (ok) {
                    this.showToast('✅ SQLite database file imported successfully!', 'success');
                    this.switchView('view-inventory');
                }
            } else {
                this.showToast('Unsupported file format. Please choose an .xlsx, .xls, .csv, or .sqlite file.', 'warning');
            }
        } catch (e) {
            console.error('Import error:', e);
            this.showToast(`Error importing file: ${e.message}`, 'error');
        }
    }

    async importStockSenseDefault() {
        try {
            const res = await this.store.importStockSenseDataset();
            if (res) {
                this.showToast(`✅ Imported all ${res.totalRecords} records and ${res.masterProductsCount} master products from StockSense Excel file into SQLite! (No server upload)`, 'success');
                this.switchView('view-inventory');
            } else {
                this.showToast('StockSense dataset already loaded or unavailable', 'info');
            }
        } catch (err) {
            this.showToast(`Failed to load StockSense data: ${err.message}`, 'error');
        }
    }

    // --- Settings Form ---
    setupSettingsForm() {
        const form = document.getElementById('storeSettingsForm');
        if (form) {
            form.addEventListener('submit', (e) => {
                e.preventDefault();
                const settings = {
                    storeName: document.getElementById('settingStoreName').value.trim(),
                    tagline: document.getElementById('settingTagline').value.trim(),
                    storePhone: document.getElementById('settingStorePhone').value.trim(),
                    storeAddress: document.getElementById('settingStoreAddress').value.trim(),
                    currencySymbol: document.getElementById('settingCurrencySymbol').value.trim(),
                    defaultTaxRate: parseFloat(document.getElementById('settingDefaultTaxRate').value) || 0,
                    enableTax: document.getElementById('settingEnableTax').checked,
                    whatsappPrefixCountryCode: document.getElementById('settingWhatsappPrefix').value.trim(),
                    messageGreeting: document.getElementById('settingMessageGreeting').value.trim(),
                    messageFooter: document.getElementById('settingMessageFooter').value.trim(),
                    includeItemDetailsInSMS: document.getElementById('settingIncludeItemDetailsInSMS').checked
                };

                this.store.saveSettings(settings);
                this.showToast('Settings saved!', 'success');
            });
        }
    }

    applyStoreSettings() {
        const settings = this.store.getSettings();
        const brandStoreName = document.getElementById('brandStoreName');
        const brandTagline = document.getElementById('brandTagline');
        if (brandStoreName) brandStoreName.textContent = settings.storeName;
        if (brandTagline) brandTagline.textContent = settings.tagline;

        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };

        setVal('settingStoreName', settings.storeName);
        setVal('settingTagline', settings.tagline);
        setVal('settingStorePhone', settings.storePhone);
        setVal('settingStoreAddress', settings.storeAddress);
        setVal('settingCurrencySymbol', settings.currencySymbol);
        setVal('settingDefaultTaxRate', settings.defaultTaxRate);
        setVal('settingWhatsappPrefix', settings.whatsappPrefixCountryCode);
        setVal('settingMessageGreeting', settings.messageGreeting);
        setVal('settingMessageFooter', settings.messageFooter);

        const enableTaxEl = document.getElementById('settingEnableTax');
        if (enableTaxEl) enableTaxEl.checked = !!settings.enableTax;

        const incItemEl = document.getElementById('settingIncludeItemDetailsInSMS');
        if (incItemEl) incItemEl.checked = !!settings.includeItemDetailsInSMS;

        const phonePrefixHint = document.getElementById('posPhonePrefixHint');
        if (phonePrefixHint) phonePrefixHint.textContent = settings.whatsappPrefixCountryCode;
    }

    // --- Keyboard Shortcuts ---
    setupKeyboardShortcuts() {
        window.addEventListener('keydown', (e) => {
            if (e.key === 'F1') {
                e.preventDefault();
                this.switchView('view-pos');
            }
            if (e.key === 'F2') {
                e.preventDefault();
                const searchInput = document.getElementById('posSearchInput');
                if (searchInput) searchInput.focus();
            }
            if (e.key === 'F3') {
                e.preventDefault();
                this.switchView('view-inventory');
            }
            if (e.key === 'F4') {
                e.preventDefault();
                this.switchView('view-invoices');
            }
            if (e.key === 'F8') {
                e.preventDefault();
                if (window.Billing) window.Billing.executeCheckout();
            }
            if (e.key === 'Escape') {
                document.querySelectorAll('.app-modal.active').forEach(m => m.classList.remove('active'));
            }
        });
    }

    // --- Toast Notifications ---
    showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast-item toast-${type}`;

        let icon = 'ℹ️';
        if (type === 'success') icon = '✅';
        if (type === 'warning') icon = '⚠️';
        if (type === 'error') icon = '❌';

        toast.innerHTML = `
            <span class="toast-icon">${icon}</span>
            <div class="toast-message">${message}</div>
            <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
        `;

        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }
}

window.App = new AppController();
