/**
 * QuickBill Pro - POS Billing Terminal & Order Management
 * Manages Customer Orders, Real-time SQLite Stock Deductions, and Message Delivery.
 */

class BillingTerminal {
    constructor() {
        this.store = window.Store;
        this.messaging = window.Messaging;

        this.cart = [];
        this.currentBillNumber = this.generateBillNumber();
        this.discountPercent = 0;
        this.taxRate = this.store.getSettings().defaultTaxRate || 18;
        this.activeCategory = 'ALL';
        this.searchQuery = '';
        this.currentOrderBy = 'name ASC';

        this.init();
    }

    init() {
        // Listen for store updates to keep cart & catalog in sync
        this.store.subscribe((event, data) => {
            if (event === 'PRODUCTS_UPDATED') {
                this.syncCartWithInventory();
                this.renderCatalog();
                this.renderCart();
            }
            if (event === 'SETTINGS_UPDATED') {
                this.taxRate = data.defaultTaxRate || 0;
                this.renderCart();
            }
        });
    }

    generateBillNumber() {
        const datePrefix = new Date().toISOString().slice(2, 10).replace(/-/g, '');
        const randomSuffix = Math.floor(1000 + Math.random() * 9000);
        return `QB-${datePrefix}-${randomSuffix}`;
    }

    resetBillNumber() {
        this.currentBillNumber = this.generateBillNumber();
        const billNumEl = document.getElementById('currentBillNumberDisplay');
        if (billNumEl) billNumEl.textContent = '#' + this.currentBillNumber;
    }

    // --- Catalog Filtering, Search & Order By ---
    setCategory(category) {
        this.activeCategory = category;
        this.renderCatalog();
    }

    setSearchQuery(query) {
        this.searchQuery = (query || '').toLowerCase().trim();
        this.renderCatalog();
    }

    setProductOrderBy(orderByClause) {
        this.currentOrderBy = orderByClause;
        this.store.setProductOrder(orderByClause);
        this.renderCatalog();
    }

    getFilteredProducts() {
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

        return products;
    }

    // --- Cart Actions (Order the Product) ---
    addToCart(productId, qty = 1) {
        const product = this.store.getProductById(productId);
        if (!product) {
            window.App.showToast('Product not found in database', 'error');
            return false;
        }

        if (product.stock <= 0) {
            window.App.showToast(`"${product.name}" is OUT OF STOCK! Please order stock from supplier.`, 'warning');
            return false;
        }

        const existingItem = this.cart.find(item => item.id === productId);
        const currentInCart = existingItem ? existingItem.quantity : 0;

        if (currentInCart + qty > product.stock) {
            window.App.showToast(
                `Cannot order more! Only ${product.stock} ${product.unit} available in SQLite inventory.`,
                'warning'
            );
            return false;
        }

        if (existingItem) {
            existingItem.quantity += qty;
        } else {
            this.cart.push({
                id: product.id,
                name: product.name,
                sku: product.sku,
                price: product.price,
                unit: product.unit,
                quantity: qty
            });
        }

        window.App.showToast(`Added "${product.name}" to order cart`, 'success');
        this.renderCart();
        this.renderCatalog();
        return true;
    }

    updateQuantity(productId, newQty) {
        const itemIndex = this.cart.findIndex(i => i.id === productId);
        if (itemIndex === -1) return;

        const product = this.store.getProductById(productId);
        const maxStock = product ? product.stock : 0;

        if (newQty <= 0) {
            this.removeFromCart(productId);
            return;
        }

        if (newQty > maxStock) {
            window.App.showToast(`Max available inventory for this item is ${maxStock}.`, 'warning');
            this.cart[itemIndex].quantity = maxStock;
        } else {
            this.cart[itemIndex].quantity = newQty;
        }

        this.renderCart();
        this.renderCatalog();
    }

    removeFromCart(productId) {
        const item = this.cart.find(i => i.id === productId);
        this.cart = this.cart.filter(i => i.id !== productId);
        if (item) {
            window.App.showToast(`Removed "${item.name}" from order`, 'info');
        }
        this.renderCart();
        this.renderCatalog();
    }

    clearCart() {
        this.cart = [];
        this.discountPercent = 0;
        const discountInput = document.getElementById('cartDiscountInput');
        if (discountInput) discountInput.value = '0';
        this.renderCart();
        this.renderCatalog();
    }

    syncCartWithInventory() {
        let modified = false;
        for (let i = this.cart.length - 1; i >= 0; i--) {
            const item = this.cart[i];
            const product = this.store.getProductById(item.id);
            if (!product || product.stock <= 0) {
                this.cart.splice(i, 1);
                modified = true;
            } else if (item.quantity > product.stock) {
                item.quantity = product.stock;
                modified = true;
            }
        }
        if (modified) {
            window.App.showToast('Order cart updated to match current SQLite stock levels', 'info');
        }
    }

    // --- Calculations ---
    calculateTotals() {
        const settings = this.store.getSettings();
        const subtotal = this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        const discountAmount = Math.round((subtotal * this.discountPercent) / 100);
        const discountedSubtotal = Math.max(0, subtotal - discountAmount);

        const taxRate = settings.enableTax ? (this.taxRate || 0) : 0;
        const taxAmount = Math.round((discountedSubtotal * taxRate) / 100);

        const grandTotal = discountedSubtotal + taxAmount;

        return {
            subtotal,
            discountPercent: this.discountPercent,
            discountAmount,
            taxRate,
            taxAmount,
            grandTotal,
            totalItems: this.cart.reduce((sum, i) => sum + i.quantity, 0)
        };
    }

    // --- Place Customer Order & Send Bill ---
    async executeCheckout() {
        if (this.cart.length === 0) {
            window.App.showToast('Cannot place order: Cart is empty! Add products first.', 'warning');
            return null;
        }

        const customerNameInput = document.getElementById('customerNameInput');
        const customerPhoneInput = document.getElementById('customerPhoneInput');
        const paymentMethodSelect = document.getElementById('paymentMethodSelect');
        const orderNotesInput = document.getElementById('orderNotesInput');

        const customerName = customerNameInput?.value.trim() || 'Valued Customer';
        const customerPhone = customerPhoneInput?.value.trim() || '';
        const paymentMethod = paymentMethodSelect?.value || 'Cash';
        const notes = orderNotesInput?.value.trim() || '';

        // Validate phone number - allow user to proceed without phone for walk-in cash customers
        if (!customerPhone) {
            const proceed = confirm(
                'No customer mobile number entered.\n\n' +
                'Do you want to proceed and place this order now without sending a digital bill message?\n\n' +
                '• Click "OK" to place order immediately.\n' +
                '• Click "Cancel" to enter customer mobile number first.'
            );
            if (!proceed) {
                customerPhoneInput?.focus();
                return null;
            }
        }

        try {
            const totals = this.calculateTotals();
            
            // Execute atomic SQLite transaction
            const orderRecord = this.store.executeCustomerOrder({
                billNumber: this.currentBillNumber,
                customer: {
                    name: customerName,
                    phone: customerPhone,
                    notes
                },
                items: [...this.cart],
                subtotal: totals.subtotal,
                discountPercent: totals.discountPercent,
                discountAmount: totals.discountAmount,
                taxRate: totals.taxRate,
                taxAmount: totals.taxAmount,
                grandTotal: totals.grandTotal,
                paymentMethod
            });

            window.App.showToast(
                `🎉 Order #${orderRecord.billNumber} placed! SQLite stocks updated successfully.`,
                'success'
            );

            // Open Message Dispatch Modal
            window.App.openMessageModal(orderRecord);

            // Reset Cart and Form
            this.cart = [];
            this.discountPercent = 0;
            if (customerNameInput) customerNameInput.value = '';
            if (customerPhoneInput) customerPhoneInput.value = '';
            if (orderNotesInput) orderNotesInput.value = '';
            if (paymentMethodSelect) paymentMethodSelect.value = 'Cash';
            const discountInput = document.getElementById('cartDiscountInput');
            if (discountInput) discountInput.value = '0';

            this.resetBillNumber();
            this.renderCart();
            this.renderCatalog();

            return orderRecord;
        } catch (error) {
            console.error('Order checkout failed:', error);
            window.App.showToast(`Order Error: ${error.message}`, 'error');
            return null;
        }
    }

    // --- Rendering Catalog Cards ---
    renderCatalog() {
        const container = document.getElementById('posCatalogGrid');
        if (!container) return;

        const products = this.getFilteredProducts();
        const settings = this.store.getSettings();
        const curr = settings.currencySymbol || '₹';

        if (products.length === 0) {
            container.innerHTML = `
                <div class="empty-state-catalog">
                    <div class="empty-icon">🔍</div>
                    <p>No products found matching filters</p>
                    <button class="btn btn-secondary btn-sm" onclick="window.Billing.setSearchQuery(''); window.Billing.setCategory('ALL');">Reset Filters</button>
                </div>
            `;
            return;
        }

        container.innerHTML = products.map(prod => {
            const inCartItem = this.cart.find(i => i.id === prod.id);
            const inCartQty = inCartItem ? inCartItem.quantity : 0;
            const remainingStock = Math.max(0, prod.stock - inCartQty);

            let stockBadgeClass = 'badge-in-stock';
            let stockBadgeText = `${remainingStock} ${prod.unit} available`;
            let isOutOfStock = prod.stock <= 0;

            if (isOutOfStock) {
                stockBadgeClass = 'badge-out-of-stock';
                stockBadgeText = 'Out of Stock';
            } else if (remainingStock <= 0) {
                stockBadgeClass = 'badge-out-of-stock';
                stockBadgeText = `All ${prod.stock} in order`;
            } else if (remainingStock <= prod.minStockAlert) {
                stockBadgeClass = 'badge-low-stock';
                stockBadgeText = `Low Stock (${remainingStock} ${prod.unit})`;
            }

            return `
                <div class="product-card ${isOutOfStock ? 'is-disabled' : ''}" data-id="${prod.id}" onclick="window.Billing.addToCart('${prod.id}', 1)">
                    <div class="product-card-top">
                        <span class="product-category-tag">${prod.category}</span>
                        <span class="stock-badge ${stockBadgeClass}">${stockBadgeText}</span>
                    </div>
                    <h4 class="product-card-title">${prod.name}</h4>
                    <div class="product-sku">${prod.sku}</div>
                    ${prod.description ? `<p class="product-short-desc">${prod.description}</p>` : ''}
                    <div class="product-card-bottom">
                        <div class="product-price">
                            <span class="curr">${curr}</span>${prod.price.toLocaleString()}
                            <span class="unit-text">/${prod.unit}</span>
                        </div>
                        <button class="btn-add-item ${remainingStock <= 0 ? 'disabled' : ''}" 
                                onclick="event.stopPropagation(); window.Billing.addToCart('${prod.id}', 1)"
                                title="${remainingStock <= 0 ? 'Max stock reached - please order stock' : 'Order this product'}">
                            ${inCartQty > 0 ? `<span class="cart-pill">🛒 ${inCartQty} in order</span>` : '🛒 Order'}
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    }

    renderCart() {
        const cartListEl = document.getElementById('posCartList');
        const cartCountEl = document.getElementById('cartItemsCountBadge');
        const settings = this.store.getSettings();
        const curr = settings.currencySymbol || '₹';

        const totals = this.calculateTotals();

        if (cartCountEl) {
            cartCountEl.textContent = `${totals.totalItems} items in order`;
        }

        const subtotalEl = document.getElementById('summarySubtotal');
        const discountRowEl = document.getElementById('summaryDiscountRow');
        const discountAmountEl = document.getElementById('summaryDiscountAmount');
        const taxRowEl = document.getElementById('summaryTaxRow');
        const taxRateLabelEl = document.getElementById('summaryTaxRateLabel');
        const taxAmountEl = document.getElementById('summaryTaxAmount');
        const grandTotalEl = document.getElementById('summaryGrandTotal');
        const checkoutBtnEl = document.getElementById('btnExecuteCheckout');

        if (subtotalEl) subtotalEl.textContent = `${curr}${totals.subtotal.toLocaleString()}`;
        
        if (discountRowEl && discountAmountEl) {
            if (totals.discountAmount > 0) {
                discountRowEl.style.display = 'flex';
                discountAmountEl.textContent = `-${curr}${totals.discountAmount.toLocaleString()}`;
            } else {
                discountRowEl.style.display = 'none';
            }
        }

        if (taxRowEl && taxAmountEl) {
            if (settings.enableTax && totals.taxAmount > 0) {
                taxRowEl.style.display = 'flex';
                if (taxRateLabelEl) taxRateLabelEl.textContent = `Tax (${totals.taxRate}%):`;
                taxAmountEl.textContent = `+${curr}${totals.taxAmount.toLocaleString()}`;
            } else {
                taxRowEl.style.display = 'none';
            }
        }

        if (grandTotalEl) grandTotalEl.textContent = `${curr}${totals.grandTotal.toLocaleString()}`;

        if (checkoutBtnEl) {
            checkoutBtnEl.disabled = this.cart.length === 0;
            const checkoutTotalSpan = document.getElementById('btnCheckoutTotalSpan');
            if (checkoutTotalSpan) {
                checkoutTotalSpan.textContent = `${curr}${totals.grandTotal.toLocaleString()}`;
            }
        }

        if (!cartListEl) return;

        if (this.cart.length === 0) {
            cartListEl.innerHTML = `
                <div class="empty-cart-state">
                    <div class="empty-cart-icon">🛒</div>
                    <p class="empty-cart-title">No products in current order</p>
                    <p class="empty-cart-subtitle">Click "🛒 Order" on any product to add it to this bill.</p>
                </div>
            `;
            return;
        }

        cartListEl.innerHTML = this.cart.map(item => {
            const product = this.store.getProductById(item.id);
            const maxStock = product ? product.stock : item.quantity;
            const itemTotal = item.price * item.quantity;

            return `
                <div class="cart-item-row" data-id="${item.id}">
                    <div class="cart-item-left">
                        <div class="cart-item-name">${item.name}</div>
                        <div class="cart-item-meta">
                            <span class="cart-item-unit-price">${curr}${item.price.toLocaleString()}</span>
                            <span class="cart-item-max-stock">Max Stock: ${maxStock} ${item.unit}</span>
                        </div>
                    </div>

                    <div class="cart-item-stepper">
                        <button class="btn-step" onclick="window.Billing.updateQuantity('${item.id}', ${item.quantity - 1})" title="Decrease">-</button>
                        <input type="number" class="step-input" min="1" max="${maxStock}" value="${item.quantity}" 
                               onchange="window.Billing.updateQuantity('${item.id}', parseInt(this.value, 10) || 1)" />
                        <button class="btn-step" onclick="window.Billing.updateQuantity('${item.id}', ${item.quantity + 1})" title="Increase" ${item.quantity >= maxStock ? 'disabled' : ''}>+</button>
                    </div>

                    <div class="cart-item-right">
                        <div class="cart-item-total">${curr}${itemTotal.toLocaleString()}</div>
                        <button class="btn-remove-item" onclick="window.Billing.removeFromCart('${item.id}')" title="Remove from order">✕</button>
                    </div>
                </div>
            `;
        }).join('');
    }
}

window.Billing = new BillingTerminal();
