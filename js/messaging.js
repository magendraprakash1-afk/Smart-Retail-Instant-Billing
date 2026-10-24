/**
 * QuickBill Pro - Message Dispatch & Receipt Generator Engine
 * Specializes in message-first customer receipt delivery (WhatsApp, SMS, Clipboard, and E-Receipt).
 */

class MessageEngine {
    constructor() {
        this.store = window.Store;
    }

    /**
     * Formats customer phone number to international E.164 without plus or spaces for WhatsApp,
     * and clean format for SMS.
     */
    sanitizePhoneNumber(phone, defaultCountryCode = '+91') {
        if (!phone) return '';
        let cleaned = phone.replace(/[^0-9+]/g, '');
        
        // If user didn't type a country code, prepend default
        if (!cleaned.startsWith('+')) {
            if (cleaned.length === 10) {
                cleaned = defaultCountryCode.replace('+', '') + cleaned;
            }
        } else {
            cleaned = cleaned.replace('+', '');
        }

        return cleaned;
    }

    /**
     * Generates a beautifully formatted WhatsApp message.
     * Uses WhatsApp formatting: *bold*, _italics_, ~strikethrough~, and monospace.
     */
    generateWhatsAppBill(invoice) {
        const settings = this.store.getSettings();
        const curr = settings.currencySymbol || '₹';
        const storeName = settings.storeName || 'Store';
        const phone = settings.storePhone || '';
        const address = settings.storeAddress || '';

        const divider = '━━━━━━━━━━━━━━━━━━━━━━';
        
        let lines = [];

        // Header
        lines.push(`🧾 *TAX INVOICE / E-BILL*`);
        lines.push(`🏪 *${storeName.toUpperCase()}*`);
        if (settings.tagline) lines.push(`_${settings.tagline}_`);
        lines.push(divider);

        // Bill Meta
        lines.push(`📌 *Invoice No:* #${invoice.billNumber}`);
        lines.push(`📅 *Date & Time:* ${invoice.date} | ${invoice.time}`);
        lines.push(`👤 *Customer:* ${invoice.customer.name}`);
        if (invoice.customer.phone) lines.push(`📱 *Mobile:* ${invoice.customer.phone}`);
        lines.push(divider);

        // Itemized List
        lines.push(`🛍️ *PURCHASED ITEMS:*`);
        invoice.items.forEach((item, index) => {
            const itemTotal = (item.price * item.quantity).toLocaleString();
            lines.push(
                `${index + 1}. *${item.name}*\n    ` +
                `└ ${item.quantity} ${item.unit || 'pcs'} × ${curr}${item.price.toLocaleString()} = *${curr}${itemTotal}*`
            );
        });
        lines.push(divider);

        // Financials
        lines.push(`💵 *Subtotal:* ${curr}${invoice.pricing.subtotal.toLocaleString()}`);
        
        if (invoice.pricing.discountAmount > 0) {
            lines.push(`🏷️ *Discount (${invoice.pricing.discountPercent}%):* -${curr}${invoice.pricing.discountAmount.toLocaleString()}`);
        }
        
        if (invoice.pricing.taxAmount > 0) {
            lines.push(`📊 *Tax / GST (${invoice.pricing.taxRate}%):* +${curr}${invoice.pricing.taxAmount.toLocaleString()}`);
        }

        lines.push(`💰 *TOTAL PAYABLE:* *${curr}${invoice.pricing.grandTotal.toLocaleString()}*`);
        lines.push(`💳 *Payment Mode:* ${invoice.paymentMethod}`);
        lines.push(divider);

        // Notes & Footer
        if (invoice.customer.notes) {
            lines.push(`📝 *Note:* ${invoice.customer.notes}`);
            lines.push('');
        }

        const footerGreeting = settings.messageGreeting
            .replace('{customer_name}', invoice.customer.name)
            .replace('{store_name}', storeName);
        
        const footerNote = settings.messageFooter
            .replace('{store_phone}', phone)
            .replace('{store_name}', storeName);

        lines.push(footerGreeting);
        lines.push(footerNote);
        
        if (address) {
            lines.push(`📍 _${address}_`);
        }
        lines.push(`_🌱 Thank you for choosing paperless e-billing!_`);

        return lines.join('\n');
    }

    /**
     * Generates a concise yet comprehensive SMS message.
     */
    generateSMSBill(invoice) {
        const settings = this.store.getSettings();
        const curr = settings.currencySymbol || '₹';
        const storeName = settings.storeName || 'Store';
        const count = invoice.items.reduce((sum, item) => sum + item.quantity, 0);

        let itemsSummary = '';
        if (settings.includeItemDetailsInSMS) {
            itemsSummary = invoice.items.map(i => `${i.quantity}x ${i.name.slice(0, 15)}`).join(', ');
            if (itemsSummary.length > 80) {
                itemsSummary = itemsSummary.slice(0, 77) + '...';
            }
            itemsSummary = `Items: [${itemsSummary}]. `;
        } else {
            itemsSummary = `Total Items: ${count}. `;
        }

        return (
            `Bill #${invoice.billNumber} from ${storeName}: ` +
            `Hello ${invoice.customer.name}, your total bill is ${curr}${invoice.pricing.grandTotal.toLocaleString()} ` +
            `paid via ${invoice.paymentMethod}. ${itemsSummary}` +
            `Date: ${invoice.date}. Helpline: ${settings.storePhone}. Thank you!`
        );
    }

    /**
     * Builds direct WhatsApp click-to-chat URL.
     */
    buildWhatsAppUrl(phone, messageText) {
        const settings = this.store.getSettings();
        const sanitizedPhone = this.sanitizePhoneNumber(phone, settings.whatsappPrefixCountryCode);
        const encodedMessage = encodeURIComponent(messageText);

        if (sanitizedPhone) {
            // Target specific customer
            return `https://api.whatsapp.com/send?phone=${sanitizedPhone}&text=${encodedMessage}`;
        } else {
            // General share dialog
            return `https://api.whatsapp.com/send?text=${encodedMessage}`;
        }
    }

    /**
     * Builds native SMS link.
     */
    buildSMSUrl(phone, messageText) {
        const settings = this.store.getSettings();
        const sanitizedPhone = this.sanitizePhoneNumber(phone, settings.whatsappPrefixCountryCode);
        const encoded = encodeURIComponent(messageText);
        
        // Android and iOS standard compatibility
        return `sms:${sanitizedPhone}?body=${encoded}`;
    }

    /**
     * Triggers native or browser share if supported.
     */
    async shareNative(title, text) {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: title,
                    text: text
                });
                return true;
            } catch (err) {
                if (err.name !== 'AbortError') {
                    console.warn('Native share failed:', err);
                }
                return false;
            }
        }
        return false;
    }

    /**
     * Copies plain text to clipboard.
     */
    async copyToClipboard(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return true;
            } else {
                // Fallback for non-https or file protocol
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                textarea.style.top = '0';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                const success = document.execCommand('copy');
                document.body.removeChild(textarea);
                return success;
            }
        } catch (e) {
            console.error('Clipboard copy error:', e);
            return false;
        }
    }

    /**
     * Formats a digital receipt card HTML for visual modal or on-screen review.
     */
    renderDigitalReceiptHtml(invoice) {
        const settings = this.store.getSettings();
        const curr = settings.currencySymbol || '₹';

        const itemRows = invoice.items.map(item => `
            <div class="receipt-item-row">
                <div class="receipt-item-info">
                    <span class="receipt-item-name">${item.name}</span>
                    <span class="receipt-item-sub">${item.quantity} ${item.unit || 'pcs'} × ${curr}${item.price.toLocaleString()}</span>
                </div>
                <div class="receipt-item-price">${curr}${(item.price * item.quantity).toLocaleString()}</div>
            </div>
        `).join('');

        return `
            <div class="digital-receipt-card" id="digitalReceiptCard">
                <div class="receipt-header">
                    <div class="receipt-badge">DIGITAL E-RECEIPT</div>
                    <div class="receipt-logo-icon">🧾</div>
                    <h2 class="receipt-store-name">${settings.storeName}</h2>
                    <p class="receipt-tagline">${settings.tagline}</p>
                    <p class="receipt-address">${settings.storeAddress}</p>
                </div>

                <div class="receipt-divider-dashed"></div>

                <div class="receipt-meta-grid">
                    <div>
                        <span class="receipt-label">INVOICE NO</span>
                        <strong class="receipt-val">#${invoice.billNumber}</strong>
                    </div>
                    <div>
                        <span class="receipt-label">DATE & TIME</span>
                        <strong class="receipt-val">${invoice.date} ${invoice.time}</strong>
                    </div>
                    <div>
                        <span class="receipt-label">CUSTOMER</span>
                        <strong class="receipt-val">${invoice.customer.name}</strong>
                    </div>
                    <div>
                        <span class="receipt-label">PHONE</span>
                        <strong class="receipt-val">${invoice.customer.phone || 'N/A'}</strong>
                    </div>
                </div>

                <div class="receipt-divider-dashed"></div>

                <div class="receipt-items-container">
                    <div class="receipt-items-header">
                        <span>ITEM & QTY</span>
                        <span>AMOUNT</span>
                    </div>
                    ${itemRows}
                </div>

                <div class="receipt-divider-dashed"></div>

                <div class="receipt-summary">
                    <div class="receipt-sum-row">
                        <span>Subtotal:</span>
                        <span>${curr}${invoice.pricing.subtotal.toLocaleString()}</span>
                    </div>
                    ${invoice.pricing.discountAmount > 0 ? `
                        <div class="receipt-sum-row text-success">
                            <span>Discount (${invoice.pricing.discountPercent}%):</span>
                            <span>-${curr}${invoice.pricing.discountAmount.toLocaleString()}</span>
                        </div>
                    ` : ''}
                    ${invoice.pricing.taxAmount > 0 ? `
                        <div class="receipt-sum-row">
                            <span>Tax / GST (${invoice.pricing.taxRate}%):</span>
                            <span>+${curr}${invoice.pricing.taxAmount.toLocaleString()}</span>
                        </div>
                    ` : ''}
                    <div class="receipt-sum-row total-highlight">
                        <span>GRAND TOTAL:</span>
                        <span>${curr}${invoice.pricing.grandTotal.toLocaleString()}</span>
                    </div>
                    <div class="receipt-sum-row payment-tag">
                        <span>Payment Mode:</span>
                        <span class="badge-payment">${invoice.paymentMethod} (PAID)</span>
                    </div>
                </div>

                <div class="receipt-footer">
                    <div class="receipt-barcode-visual">
                        <div class="barcode-lines"></div>
                        <span class="barcode-text">INV-${invoice.billNumber}</span>
                    </div>
                    <p class="receipt-thankyou">Thank you for your business!</p>
                    <p class="receipt-paperless-note">🌿 100% Paperless & Message-Delivered Receipt</p>
                </div>
            </div>
        `;
    }
}

window.Messaging = new MessageEngine();
