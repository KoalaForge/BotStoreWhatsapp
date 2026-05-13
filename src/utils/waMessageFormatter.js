const moment = require('moment-timezone');
const { formatMoney } = require('../database/models/money');
const snkFormatter = require('./snkFormatter');
const { parseOrderData } = require('./parser');
const { htmlToWhatsApp } = require('./waFormatter');

class MessageFormatter {
    /**
     * Format voucher lines for customer-facing messages
     * @private
     */
    _formatCustomerVoucherLines({ voucherCode, voucherDiscount, totalPrice }) {
        if (!voucherCode || voucherDiscount <= 0) return '';
        const subtotal = totalPrice + voucherDiscount;
        return `*Subtotal:* Rp ${subtotal.toLocaleString('id-ID')}\n` +
               `*Voucher (${voucherCode}):* -Rp ${voucherDiscount.toLocaleString('id-ID')}\n`;
    }

    /**
     * Format voucher lines for admin notifications
     * @private
     */
    _formatAdminVoucherLines({ voucherCode, voucherDiscount, totalPrice }) {
        if (!voucherCode || voucherDiscount <= 0) return '';
        const subtotal = totalPrice + voucherDiscount;
        return `Subtotal: Rp ${subtotal.toLocaleString('id-ID')}\n` +
               `Voucher (${voucherCode}): -Rp ${voucherDiscount.toLocaleString('id-ID')}\n`;
    }

    /**
     * Format payment method lines for customer-facing messages
     * @private
     */
    _formatCustomerPaymentMethodLines({ payment_method_code, newBalance }) {
        if (payment_method_code !== 'balance') return '';
        let lines = `*Metode:* Saldo\n`;
        if (newBalance !== null) {
            lines += `*Saldo Sisa:* Rp ${newBalance.toLocaleString('id-ID')}\n`;
        }
        return lines;
    }

    /**
     * Format payment method line for admin notifications
     * @private
     */
    _formatAdminPaymentMethodLine(payment_method_code) {
        if (payment_method_code !== 'balance') return '';
        return `Metode: Saldo\n`;
    }

    /**
     * Format reseller profit info lines for admin notifications
     * @private
     */
    _formatResellerInfoLines(resellerInfo) {
        if (!resellerInfo || resellerInfo.markupPerUnit == null) return '';
        let lines = `\n*Profit*\n`;
        if (resellerInfo.costPerUnit != null) {
            lines += `Modal: Rp ${resellerInfo.costPerUnit.toLocaleString('id-ID')}/pcs\n`;
            lines += `Total Modal: Rp ${resellerInfo.totalCost.toLocaleString('id-ID')}\n`;
        }
        lines += `Markup: Rp ${resellerInfo.markupPerUnit.toLocaleString('id-ID')}/pcs\n`;
        lines += `Total Profit: Rp ${resellerInfo.totalProfit.toLocaleString('id-ID')}\n`;
        if (resellerInfo.remainingBalance != null) {
            lines += `Saldo Platform: Rp ${resellerInfo.remainingBalance.toLocaleString('id-ID')}\n`;
        }
        return lines;
    }

    /**
     * Format top-up success message for customer
     */
    formatTopUpSuccessMessage({ transactionId, totalPrice, topupAmount = null, gatewayFee = 0, newBalance }) {
        let message = `> *Top-Up Saldo Berhasil*\n\n`;
        message += `*ID:* \`${transactionId}\`\n`;
        message += `*Jenis:* Top-Up Saldo\n`;

        if (gatewayFee > 0 && topupAmount) {
            const feePercentage = (gatewayFee / topupAmount * 100).toFixed(1).replace(/\.0$/, '');
            message += `*Nominal:* ${formatMoney(topupAmount)}\n`;
            message += `*Biaya Gateway (${feePercentage}%):* ${formatMoney(gatewayFee)}\n`;
            message += `*Total Bayar:* ${formatMoney(totalPrice)}\n`;
            message += `*Saldo Ditambahkan:* ${formatMoney(topupAmount)}\n`;
        } else {
            message += `*Nominal:* ${formatMoney(totalPrice)}\n`;
            message += `*Total Bayar:* ${formatMoney(totalPrice)}\n`;
        }

        message += `\n*Saldo Anda*\n`;
        message += `${formatMoney(newBalance)}\n\n`;
        message += `_Saldo telah bertambah dan siap digunakan._`;
        return message;
    }

    /**
     * Format product purchase success message for customer
     */
    formatProductSuccessMessage({
        transactionId,
        productName,
        variantName,
        orderQuantity,
        totalPrice,
        payment_method_code = 'qris',
        paymentDate,
        orderData,
        snkContent = null,
        snkTermsAndConditions = null,
        snkWarrantyTerms = null,
        newBalance = null,
        voucherCode = null,
        voucherDiscount = 0
    }) {
        const currentDateTime = moment(paymentDate, 'YYYY-MM-DD HH:mm:ss');

        let message = `> *Pembayaran Berhasil*\n\n`;
        message += `*ID:* \`${transactionId}\`\n`;
        message += `*Produk:* ${productName}\n`;
        message += `*Variasi:* ${variantName ?? '-'}\n`;
        message += `*Jumlah:* ${orderQuantity}x\n`;

        message += this._formatCustomerVoucherLines({ voucherCode, voucherDiscount, totalPrice });

        message += `*Total Bayar:* Rp ${totalPrice.toLocaleString('id-ID')}\n`;

        message += this._formatCustomerPaymentMethodLines({ payment_method_code, newBalance });

        message += `*Tanggal:* ${currentDateTime.format('DD MMM YYYY')}, ${currentDateTime.format('HH:mm')} WIB\n`;

        message += `\n*Data Pembelian*\n\n`;
        // parseOrderData uses <b> tags, convert to WhatsApp markdown
        message += htmlToWhatsApp(parseOrderData(orderData)).trim();

        const snkDisplay = this._formatSnK(snkContent, snkTermsAndConditions, snkWarrantyTerms);
        if (snkDisplay) {
            message += `\n\n${snkDisplay}`;
        }

        message += `\n\n_Simpan data ini sebagai bukti pembelian untuk klaim garansi._`;

        return message;
    }

    /**
     * Format SnK for display (supports both old and new schema)
     * Converts HTML output from snkFormatter to WhatsApp markdown
     * @private
     */
    _formatSnK(snkContent, snkTermsAndConditions, snkWarrantyTerms) {
        let htmlDisplay = '';

        if (snkTermsAndConditions || snkWarrantyTerms) {
            htmlDisplay = snkFormatter.formatForDisplay({
                termsAndConditions: snkTermsAndConditions || '',
                warrantyTerms: snkWarrantyTerms || ''
            });
        } else if (snkContent) {
            htmlDisplay = snkFormatter.formatForDisplay({
                termsAndConditions: snkContent,
                warrantyTerms: ''
            });
        }

        if (!htmlDisplay) return '';

        return htmlToWhatsApp(htmlDisplay);
    }

    /**
     * Format top-up admin notification
     */
    formatTopUpAdminNotification({
        transactionId,
        buyer,
        totalPrice,
        topupAmount = null,
        gatewayFee = 0,
        newBalance,
        paymentDate
    }) {
        const paymentDateTime = moment(paymentDate, 'YYYY-MM-DD HH:mm:ss');

        let message = `\n> *Top-Up Saldo Berhasil*\n\n`;
        message += `*Reff:* \`${transactionId}\`\n`;
        message += `User: ${buyer}\n`;

        if (gatewayFee > 0 && topupAmount) {
            const feePercentage = (gatewayFee / topupAmount * 100).toFixed(1).replace(/\.0$/, '');
            message += `Nominal: ${formatMoney(topupAmount)}\n`;
            message += `Biaya Gateway (${feePercentage}%): ${formatMoney(gatewayFee)}\n`;
            message += `Total Dibayar: ${formatMoney(totalPrice)}\n`;
        } else {
            message += `Nominal: ${formatMoney(totalPrice)}\n`;
        }

        message += `Saldo Terbaru: ${formatMoney(newBalance)}\n`;
        message += `Tanggal: ${paymentDateTime.format('DD MMM YYYY')}, ${paymentDateTime.format('HH:mm')} WIB\n`;

        return message;
    }

    /**
     * Format product purchase admin notification
     */
    formatProductAdminNotification({
        transactionId,
        buyer,
        productName,
        variantName,
        variantPrice,
        orderQuantity,
        totalPrice,
        payment_method_code = 'qris',
        paymentDate,
        orderData,
        voucherCode = null,
        voucherDiscount = 0,
        resellerInfo = null,
        buyer_notes = null,
        appliedTier = null
    }) {
        const paymentDateTime = moment(paymentDate, 'YYYY-MM-DD HH:mm:ss');

        let message = `\n> *Transaksi Baru*\n\n`;
        message += `*Reff:* \`${transactionId}\`\n`;
        message += `Pembeli: ${buyer}\n`;
        message += `Produk: ${productName} — ${variantName}\n`;
        message += `Harga: Rp ${variantPrice.toLocaleString('id-ID')}\n`;
        if (appliedTier) {
            message += `_(grosir ≥${appliedTier.min_qty} pcs)_\n`;
        }
        message += `Jumlah: ${orderQuantity}x\n`;

        message += this._formatAdminVoucherLines({ voucherCode, voucherDiscount, totalPrice });

        message += `*Total:* Rp ${totalPrice.toLocaleString('id-ID')}\n`;

        message += this._formatAdminPaymentMethodLine(payment_method_code);
        message += this._formatResellerInfoLines(resellerInfo);

        message += `\nTanggal: ${paymentDateTime.format('DD MMM YYYY')}, ${paymentDateTime.format('HH:mm')} WIB\n`;
        if (buyer_notes) {
            message += `\n*Catatan Pembeli*\n\n`;
            message += `_"${buyer_notes}"_\n`;
        }
        message += `\n*Data Pembelian*\n\n`;
        message += htmlToWhatsApp(parseOrderData(orderData));

        return message;
    }

    /**
     * Format product purchase success message for customer (summary only, without account detail)
     * Used when orderQuantity > 5, account details sent as file
     */
    formatProductSuccessMessageSummary({
        transactionId,
        productName,
        variantName,
        orderQuantity,
        totalPrice,
        payment_method_code = 'qris',
        paymentDate,
        snkContent = null,
        snkTermsAndConditions = null,
        snkWarrantyTerms = null,
        newBalance = null,
        voucherCode = null,
        voucherDiscount = 0
    }) {
        const currentDateTime = moment(paymentDate, 'YYYY-MM-DD HH:mm:ss');

        let message = `> *Pembayaran Berhasil*\n\n`;
        message += `*ID:* \`${transactionId}\`\n`;
        message += `*Produk:* ${productName}\n`;
        message += `*Variasi:* ${variantName ?? '-'}\n`;
        message += `*Jumlah:* ${orderQuantity}x\n`;

        message += this._formatCustomerVoucherLines({ voucherCode, voucherDiscount, totalPrice });

        message += `*Total Bayar:* Rp ${totalPrice.toLocaleString('id-ID')}\n`;

        message += this._formatCustomerPaymentMethodLines({ payment_method_code, newBalance });

        message += `*Tanggal:* ${currentDateTime.format('DD MMM YYYY')}, ${currentDateTime.format('HH:mm')} WIB\n\n`;

        message += `_Data pembelian dikirim dalam file terpisah di bawah._\n`;

        const snkDisplay = this._formatSnK(snkContent, snkTermsAndConditions, snkWarrantyTerms);
        if (snkDisplay) {
            message += `\n${snkDisplay}`;
        }

        message += `\n\n_Simpan file data pembelian sebagai bukti pembelian untuk klaim garansi._`;

        return message;
    }

    /**
     * Format product purchase admin notification (summary only, without account detail)
     * Used when orderQuantity > 5, account details sent as file
     */
    formatProductAdminNotificationSummary({
        transactionId,
        buyer,
        productName,
        variantName,
        variantPrice,
        orderQuantity,
        totalPrice,
        payment_method_code = 'qris',
        paymentDate,
        voucherCode = null,
        voucherDiscount = 0,
        resellerInfo = null,
        buyer_notes = null,
        appliedTier = null
    }) {
        const paymentDateTime = moment(paymentDate, 'YYYY-MM-DD HH:mm:ss');

        let message = `\n> *Transaksi Baru*\n\n`;
        message += `*Reff:* \`${transactionId}\`\n`;
        message += `Pembeli: ${buyer}\n`;
        message += `Produk: ${productName} — ${variantName}\n`;
        message += `Harga: Rp ${variantPrice.toLocaleString('id-ID')}\n`;
        if (appliedTier) {
            message += `_(grosir ≥${appliedTier.min_qty} pcs)_\n`;
        }
        message += `Jumlah: ${orderQuantity}x\n`;

        message += this._formatAdminVoucherLines({ voucherCode, voucherDiscount, totalPrice });

        message += `*Total:* Rp ${totalPrice.toLocaleString('id-ID')}\n`;

        message += this._formatAdminPaymentMethodLine(payment_method_code);
        message += this._formatResellerInfoLines(resellerInfo);

        message += `\nTanggal: ${paymentDateTime.format('DD MMM YYYY')}, ${paymentDateTime.format('HH:mm')} WIB\n`;
        if (buyer_notes) {
            message += `\n*Catatan Pembeli*\n`;
            message += `_"${buyer_notes}"_\n`;
        }

        message += `\n_Data pembelian dikirim dalam file terpisah di bawah._`;

        return message;
    }

    /**
     * Format transaction expired message
     */
    formatTransactionExpiredMessage({ transactionId, transaction_type, expiredDate }) {
        const messageType = transaction_type === 'topup' ? 'Top-Up' : 'Transaksi';
        const expiredDateTime = moment(expiredDate, 'YYYY-MM-DD HH:mm:ss');

        let message = `*${messageType} Kadaluwarsa*\n\n`;
        message += `*ID:* \`${transactionId}\`\n`;
        message += `*Status:* Dibatalkan otomatis\n`;
        message += `*Waktu:* ${expiredDateTime.format('DD MMM YYYY')}, ${expiredDateTime.format('HH:mm')} WIB\n\n`;
        message += `_Silakan buat pesanan baru jika masih diperlukan._`;

        return message;
    }

    /**
     * Format owner platform top-up success message
     */
    formatOwnerTopUpSuccessMessage({ transactionId, totalPrice, topupAmount = null, gatewayFee = 0, newBalance }) {
        let message = `> *Top-Up Saldo Platform Berhasil*\n\n`;
        message += `*ID:* \`${transactionId}\`\n`;
        message += `*Jenis:* Top-Up Saldo Platform\n`;

        if (gatewayFee > 0 && topupAmount) {
            const feePercentage = (gatewayFee / topupAmount * 100).toFixed(1).replace(/\.0$/, '');
            message += `*Nominal:* ${formatMoney(topupAmount)}\n`;
            message += `*Biaya Gateway (${feePercentage}%):* ${formatMoney(gatewayFee)}\n`;
            message += `*Total Bayar:* ${formatMoney(totalPrice)}\n`;
            message += `*Saldo Ditambahkan:* ${formatMoney(topupAmount)}\n`;
        } else {
            message += `*Nominal:* ${formatMoney(totalPrice)}\n`;
            message += `*Total Bayar:* ${formatMoney(totalPrice)}\n`;
        }

        message += `\n*Saldo Platform*\n`;
        message += `${formatMoney(newBalance)}\n\n`;
        message += `_Saldo platform telah bertambah dan siap digunakan._`;
        return message;
    }

    /**
     * Format platform balance display for /saldoplatform command
     */
    formatPlatformBalanceDisplay({ balance, totalTopup, totalSpent, recentHistory = [] }) {
        let message = `*Saldo Platform*\n\n`;
        message += `*Tersedia:* ${formatMoney(balance)}\n`;
        message += `*Total Top-Up:* ${formatMoney(totalTopup)}\n`;
        message += `*Total Terpakai:* ${formatMoney(totalSpent)}\n`;

        if (recentHistory.length > 0) {
            message += `\n*Riwayat Terakhir*\n`;
            for (const tx of recentHistory) {
                const sign = tx.amount >= 0 ? '+' : '';
                const typeLabel = this._getBalanceTransactionTypeLabel(tx.type);
                const date = new Date(tx.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: '2-digit' });
                message += `> ${date}  ${typeLabel}  ${sign}${formatMoney(tx.amount)}\n`;
            }
        }

        message += `\n_Gunakan /topupplatform untuk menambah saldo._`;
        return message;
    }

    /**
     * Build tier hint lines for order confirmation display
     * @private
     */
    _buildTierHintLines({ applicableTier, nextTier }) {
        let lines = '';
        if (applicableTier) {
            lines += `_✓ Harga grosir aktif (min ${applicableTier.min_qty} pcs)_\n`;
        } else if (nextTier) {
            lines += `_📦 Beli min ${nextTier.min_qty} pcs untuk harga grosir_\n`;
        }
        return lines;
    }

    /**
     * Get human-readable label for balance transaction type
     * @private
     */
    _getBalanceTransactionTypeLabel(type) {
        const labels = {
            topup: 'Top-Up',
            purchase: 'Pembelian',
            refund: 'Refund',
            withdrawal: 'Penarikan',
            admin_adjustment: 'Penyesuaian',
            settlement_income: 'Settlement',
            settlement_fee: 'Biaya Settlement'
        };
        return labels[type] || type;
    }

    /**
     * Format payment reminder message
     */
    formatPaymentReminderMessage({ transactionId }) {
        let message = `*Waktu Pembayaran Hampir Habis*\n\n`;
        message += `*ID:* \`${transactionId}\`\n`;
        message += `*Sisa Waktu:* 60 detik\n\n`;
        message += `Segera selesaikan pembayaran agar pesanan tidak dibatalkan otomatis.\n\n`;
        message += `_Ketik *batal* untuk membatalkan_`;

        return message;
    }

    /**
     * Format order confirmation message (before payment)
     */
    formatOrderConfirmation({
        productName,
        variantName,
        price,
        stockAvailable,
        orderQuantity,
        totalPrice,
        includeCartEmoji = false,
        confirmationQuestion = null,
        variantLabel = 'Variasi',
        priceLabel = 'Harga',
        showQuantityPrefix = false,
        voucherCode = null,
        voucherDiscount = 0,
        subtotal = null,
        isDiscountCapped = false,
        buyerNotes = null,
        tierHint = null
    }) {
        const formattedPrice = formatMoney(parseInt(price));
        const formattedTotal = formatMoney(parseInt(totalPrice));

        let message = `> *Rincian Pesanan*\n\n`;
        message += `*Produk:* ${productName}\n`;
        message += `*${variantLabel}:* ${variantName}\n`;
        message += `*${priceLabel}:* ${formattedPrice}\n`;
        if (tierHint) {
            message += this._buildTierHintLines(tierHint);
        }
        message += `*Stok:* ${stockAvailable} tersedia\n\n`;
        message += `*Jumlah:* ${showQuantityPrefix ? 'x' : ''}${orderQuantity}\n`;

        if (voucherCode && voucherDiscount > 0) {
            const calculatedSubtotal = subtotal || totalPrice + voucherDiscount;
            message += `*Subtotal:* ${formatMoney(parseInt(calculatedSubtotal))}\n`;
            const cappedNote = isDiscountCapped ? ' (disesuaikan)' : '';
            message += `*Voucher (${voucherCode}):* -${formatMoney(parseInt(voucherDiscount))}${cappedNote}\n`;
        } else if (voucherCode && isDiscountCapped && voucherDiscount === 0) {
            message += `*Voucher (${voucherCode}):* tidak berlaku untuk pesanan ini\n`;
        }

        message += `*Total:* ${formattedTotal}\n`;

        if (buyerNotes) {
            message += `\n*Catatan Pembeli*\n`;
            message += `_"${buyerNotes}"_\n`;
        }

        if (confirmationQuestion) {
            message += `\n_${confirmationQuestion}_`;
        } else {
            message += `\n> Diperbarui pada ${moment().format('HH:mm:ss')} WIB`;
        }

        return message;
    }
}

module.exports = new MessageFormatter();
