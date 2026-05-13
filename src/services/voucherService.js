const voucherRepository = require('../repositories/VoucherRepository');
const moment = require('moment-timezone');

class VoucherService {
    /**
     * Find voucher by code (case-insensitive)
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} code - Voucher code
     * @returns {Promise<Object|null>} - Voucher document or null
     */
    async findVoucherByCode(context, code) {
        if (!code) return null;

        return await voucherRepository.findByCode(context, code.toUpperCase().trim());
    }

    /**
     * Validate and apply voucher to order
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} voucherCode - Voucher code to validate
     * @param {number} orderAmount - Order amount in IDR
     * @returns {Promise<Object>} - Validation result
     */
    async validateAndApplyVoucher(context, voucherCode, orderAmount) {
        try {
            // Validate input
            if (!voucherCode || voucherCode.trim() === '') {
                return {
                    isValid: false,
                    errorMessage: 'Kode voucher tidak boleh kosong',
                    errorCode: 'EMPTY_CODE'
                };
            }

            if (!orderAmount || orderAmount <= 0) {
                return {
                    isValid: false,
                    errorMessage: 'Jumlah order tidak valid',
                    errorCode: 'INVALID_AMOUNT'
                };
            }

            // Find voucher
            const voucher = await this.findVoucherByCode(context, voucherCode);

            if (!voucher) {
                return {
                    isValid: false,
                    errorMessage: 'Kode voucher tidak ditemukan',
                    errorCode: 'VOUCHER_NOT_FOUND'
                };
            }

            // Check if voucher is valid
            if (!voucher.isValid()) {
                return {
                    isValid: false,
                    errorMessage: voucher.getInvalidReason(),
                    errorCode: 'VOUCHER_INACTIVE'
                };
            }

            // Check minimum order amount
            if (voucher.min_order_amount > 0 && orderAmount < voucher.min_order_amount) {
                const minAmount = voucher.min_order_amount.toLocaleString('id-ID');
                return {
                    isValid: false,
                    errorMessage: `Minimum pembelian Rp ${minAmount}`,
                    errorCode: 'AMOUNT_TOO_LOW'
                };
            }

            // Calculate discount
            const discountAmount = voucher.calculateDiscount(orderAmount);
            const newTotal = Math.max(0, orderAmount - discountAmount);

            return {
                isValid: true,
                voucherCode: voucher.code,
                discountAmount: discountAmount,
                newTotal: newTotal,
                discountType: voucher.discount_type,
                discountValue: voucher.discount_value,
                maxDiscountAmount: voucher.max_discount_amount
            };

        } catch (error) {
            console.error('Error in validateAndApplyVoucher:', error);
            return {
                isValid: false,
                errorMessage: 'Terjadi kesalahan saat memvalidasi voucher',
                errorCode: 'VALIDATION_ERROR'
            };
        }
    }

    /**
     * Confirm voucher usage (increment used_count)
     * IMPORTANT: Call this ONLY after payment is confirmed
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} voucherCode - Voucher code to confirm
     * @returns {Promise<boolean>} - Success status
     */
    async confirmVoucherUsage(context, voucherCode) {
        try {
            if (!voucherCode) return false;

            const voucher = await this.findVoucherByCode(context, voucherCode);

            if (!voucher) {
                console.log(`Voucher not found for confirmation: ${voucherCode}`);
                return false;
            }

            // Increment using atomic operation
            await voucherRepository.updateOne(
                context,
                { code: voucher.code },
                { $inc: { used_count: 1 } }
            );

            console.log(`Voucher usage confirmed: ${voucherCode}, new count: ${voucher.used_count + 1}`);
            return true;

        } catch (error) {
            console.error('Error confirming voucher usage:', error);
            return false;
        }
    }

    /**
     * Create a new voucher
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {Object} voucherData - Voucher data
     * @returns {Promise<Object>} - Created voucher
     */
    async createVoucher(context, voucherData) {
        try {
            // Check if code already exists
            const existing = await this.findVoucherByCode(context, voucherData.code);
            if (existing) {
                throw new Error('Kode voucher sudah digunakan');
            }

            // Validate discount type
            if (!['fixed', 'percentage'].includes(voucherData.discount_type)) {
                throw new Error('Tipe diskon harus "fixed" atau "percentage"');
            }

            // Validate dates if provided
            if (voucherData.start_date && voucherData.end_date) {
                const startDate = new Date(voucherData.start_date);
                const endDate = new Date(voucherData.end_date);

                if (startDate >= endDate) {
                    throw new Error('Tanggal mulai harus sebelum tanggal berakhir');
                }
            }

            const voucher = await voucherRepository.create(context, {
                code: voucherData.code.toUpperCase().trim(),
                discount_type: voucherData.discount_type,
                discount_value: voucherData.discount_value,
                max_uses: voucherData.max_uses || null,
                min_order_amount: voucherData.min_order_amount || 0,
                max_discount_amount: voucherData.max_discount_amount || 0,
                description: voucherData.description || '',
                start_date: voucherData.start_date || null,
                end_date: voucherData.end_date || null,
                is_active: voucherData.is_active !== undefined ? voucherData.is_active : true,
            });

            return voucher;

        } catch (error) {
            throw error;
        }
    }

    /**
     * Delete voucher by code
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} code - Voucher code to delete
     * @returns {Promise<boolean>} - Success status
     */
    async deleteVoucher(context, code) {
        try {
            const result = await voucherRepository.deleteOne(context, {
                code: code.toUpperCase().trim()
            });
            return result.deletedCount > 0;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Activate voucher
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} code - Voucher code to activate
     * @returns {Promise<boolean>} - Success status
     */
    async activateVoucher(context, code) {
        try {
            const result = await voucherRepository.updateOne(
                context,
                { code: code.toUpperCase().trim() },
                { $set: { is_active: true } }
            );
            return result.modifiedCount > 0;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Deactivate voucher
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} code - Voucher code to deactivate
     * @returns {Promise<boolean>} - Success status
     */
    async deactivateVoucher(context, code) {
        try {
            const result = await voucherRepository.updateOne(
                context,
                { code: code.toUpperCase().trim() },
                { $set: { is_active: false } }
            );
            return result.modifiedCount > 0;
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get all vouchers (for admin list)
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {boolean} activeOnly - Filter only active vouchers
     * @returns {Promise<Array>} - Array of vouchers
     */
    async getAllVouchers(context, activeOnly = false) {
        try {
            const query = activeOnly ? { is_active: true } : {};
            return await voucherRepository.find(context, query, { sort: { createdAt: -1 } });
        } catch (error) {
            throw error;
        }
    }

    /**
     * Get voucher statistics
     * @param {Object} context - Repository context (botId, ownerId, mode)
     * @param {string} code - Voucher code
     * @returns {Promise<Object|null>} - Voucher stats
     */
    async getVoucherStats(context, code) {
        try {
            const voucher = await this.findVoucherByCode(context, code);

            if (!voucher) return null;

            return {
                code: voucher.code,
                isActive: voucher.is_active,
                totalUses: voucher.used_count,
                maxUses: voucher.max_uses,
                remainingUses: voucher.getRemainingUses(),
                isValid: voucher.isValid(),
                discountType: voucher.discount_type,
                discountValue: voucher.discount_value
            };
        } catch (error) {
            throw error;
        }
    }

    /**
     * Format voucher info for display
     * @param {Object} voucher - Voucher document
     * @returns {string} - Formatted voucher info
     */
    formatVoucherInfo(voucher) {
        // Determine overall status based on full validation
        const isFullyValid = voucher.isValid();
        const status = isFullyValid ? '✅' : '❌';

        // Build status text with specific reason if not valid
        let statusText = '';
        if (!voucher.is_active) {
            statusText = '(DINONAKTIFKAN)';
        } else if (!isFullyValid) {
            const now = new Date();
            if (voucher.start_date && voucher.start_date > now) {
                statusText = '(BELUM DIMULAI)';
            } else if (voucher.end_date && voucher.end_date < now) {
                statusText = '(KADALUARSA)';
            } else if (voucher.max_uses && voucher.used_count >= voucher.max_uses) {
                statusText = '(HABIS KUOTA)';
            } else {
                statusText = '(TIDAK AKTIF)';
            }
        }

        let discountText = '';
        if (voucher.discount_type === 'percentage') {
            discountText = `${voucher.discount_value}%`;
            if (voucher.max_discount_amount > 0) {
                discountText += ` (Max Rp ${voucher.max_discount_amount.toLocaleString('id-ID')})`;
            }
        } else {
            discountText = `Rp ${voucher.discount_value.toLocaleString('id-ID')}`;
        }

        let usageText = '';
        if (voucher.max_uses) {
            usageText = `${voucher.used_count} / ${voucher.max_uses}`;
            if (voucher.used_count >= voucher.max_uses) {
                usageText += ' (HABIS)';
            }
        } else {
            usageText = `${voucher.used_count} / Unlimited`;
        }

        let dateText = '';
        if (voucher.start_date || voucher.end_date) {
            const startDate = voucher.start_date ?
                moment(voucher.start_date).tz('Asia/Jakarta').format('DD/MM/YYYY') :
                '-';
            const endDate = voucher.end_date ?
                moment(voucher.end_date).tz('Asia/Jakarta').format('DD/MM/YYYY') :
                '-';
            dateText = `${startDate} - ${endDate}`;
        } else {
            dateText = 'Tidak terbatas';
        }

        let minOrderText = '';
        if (voucher.min_order_amount > 0) {
            minOrderText = `Min. Order: Rp ${voucher.min_order_amount.toLocaleString('id-ID')}`;
        }

        return `
${status} <b>${voucher.code}</b> ${statusText}
Tipe: ${voucher.discount_type === 'percentage' ? 'Persentase' : 'Fixed'}
Diskon: ${discountText}
Terpakai: ${usageText}
Periode: ${dateText}${minOrderText ? '\n' + minOrderText : ''}
${voucher.description ? 'Deskripsi: ' + voucher.description : ''}
`;
    }
}

// Export singleton instance
module.exports = new VoucherService();
