/**
 * SnK Service
 * Business logic for Syarat & Ketentuan (Terms & Conditions) operations
 * Bridges between commands and repository layer
 */

const snkFormatter = require('../utils/snkFormatter');
const productVariantRepository = require('../repositories/ProductVariantRepository');
const productVariantSnkRepository = require('../repositories/ProductVariantSnkRepository');

class SnKService {
    /**
     * Set SnK for a product variant
     * @param {Object} ctx - Telegraf context
     * @param {string} codeVariant - Variant code
     * @param {string} rawText - Raw SnK text from admin reply
     * @returns {Promise<Object>} - { success, error, data }
     */
    async setVariantSnK(ctx, codeVariant, rawText) {
        // Validate variant exists
        const variant = await productVariantRepository.findByCodeVariant(ctx, codeVariant);
        if (!variant) {
            return {
                success: false,
                error: 'CODE VARIANT PRODUCT TIDAK DI TEMUKAN'
            };
        }

        // Validate input length
        const validation = snkFormatter.validateInput(rawText);
        if (!validation.valid) {
            return {
                success: false,
                error: validation.error
            };
        }

        // Parse input into sections
        const { termsAndConditions, warrantyTerms } = snkFormatter.parseInput(rawText);

        // Validate that at least one section has content (after trimming)
        const hasTerms = termsAndConditions.trim().length > 0;
        const hasWarranty = warrantyTerms.trim().length > 0;

        if (!hasTerms && !hasWarranty) {
            return {
                success: false,
                error: 'SnK tidak boleh kosong. Minimal isi Syarat & Ketentuan atau Ketentuan Garansi.'
            };
        }

        // Delete existing SnK if any
        const existingSnK = await productVariantSnkRepository.findByCodeVariant(ctx, codeVariant);
        if (existingSnK) {
            await productVariantSnkRepository.deleteSnk(ctx, codeVariant);
        }

        // Create new SnK with both sections (trimmed)
        await productVariantSnkRepository.create(ctx, {
            codeVariant,
            termsAndConditions: termsAndConditions.trim(),
            warrantyTerms: warrantyTerms.trim()
        });

        return {
            success: true,
            data: {
                codeVariant,
                hasTerms,
                hasWarranty,
                termsLength: validation.termsLength,
                warrantyLength: validation.warrantyLength
            }
        };
    }

    /**
     * Delete SnK for a product variant
     * @param {Object} ctx - Telegraf context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object>} - { success, error }
     */
    async deleteVariantSnK(ctx, codeVariant) {
        // Check if SnK exists
        const existingSnK = await productVariantSnkRepository.findByCodeVariant(ctx, codeVariant);
        if (!existingSnK) {
            return {
                success: false,
                error: 'Code yang kamu masukkan tidak di temukan'
            };
        }

        await productVariantSnkRepository.deleteSnk(ctx, codeVariant);

        return { success: true };
    }

    /**
     * Get SnK for a product variant (formatted for display)
     * @param {Object} ctx - Telegraf context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<string>} - Formatted SnK or empty string
     */
    async getFormattedSnK(ctx, codeVariant) {
        const snk = await productVariantSnkRepository.findByCodeVariant(ctx, codeVariant);
        if (!snk) return '';

        return snkFormatter.formatForDisplay({
            termsAndConditions: snk.termsAndConditions || '',
            warrantyTerms: snk.warrantyTerms || ''
        });
    }

    /**
     * Get SnK for admin preview
     * @param {Object} ctx - Telegraf context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object>} - { found, formatted }
     */
    async getPreviewSnK(ctx, codeVariant) {
        const snk = await productVariantSnkRepository.findByCodeVariant(ctx, codeVariant);
        if (!snk) {
            return { found: false, formatted: '`SnK belum diatur untuk variant ini`' };
        }

        return {
            found: true,
            formatted: snkFormatter.formatForPreview({
                termsAndConditions: snk.termsAndConditions || '',
                warrantyTerms: snk.warrantyTerms || ''
            })
        };
    }

    /**
     * Check if SnK exists for a variant
     * @param {Object} ctx - Telegraf context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<boolean>} - True if SnK exists
     */
    async hasSnK(ctx, codeVariant) {
        return await productVariantSnkRepository.existsByCodeVariant(ctx, codeVariant);
    }

    /**
     * Get raw SnK data for a variant
     * @param {Object} ctx - Telegraf context
     * @param {string} codeVariant - Variant code
     * @returns {Promise<Object|null>} - SnK document or null
     */
    async getRawSnK(ctx, codeVariant) {
        return await productVariantSnkRepository.findByCodeVariant(ctx, codeVariant);
    }

    /**
     * List all SnK for admin
     * @param {Object} ctx - Telegraf context
     * @returns {Promise<Array>} - Array of SnK documents
     */
    async listAllSnK(ctx) {
        return await productVariantSnkRepository.findAllSnk(ctx);
    }

    /**
     * Get count of SnK entries
     * @param {Object} ctx - Telegraf context
     * @returns {Promise<number>} - Count of SnK entries
     */
    async countSnK(ctx) {
        return await productVariantSnkRepository.countSnk(ctx);
    }
}

module.exports = new SnKService();
