const moment = require('moment-timezone');
const { formatMoney } = require('../database/models/money');
const modeService = require('../services/modeService');

function sanitizeCSVValue(val) {
    const str = String(val);
    // Prevent CSV formula injection
    if (/^[=+\-@\t\r]/.test(str)) {
        return "'" + str;
    }
    return str;
}

/**
 * Generate CSV buffer from recap data
 * @param {Object} recap - { normal, reseller } from recap queries
 * @param {string} period - 'harian' | 'mingguan' | 'bulanan'
 * @returns {Buffer}
 */
function generateCSV(recap, period) {
    const isSingle = modeService.isSingleMode();
    const headers = isSingle
        ? ['Periode', 'Stok Terjual', 'Pendapatan (Rp)', 'Profit (Rp)', 'Diskon Voucher (Rp)']
        : ['Tipe Produk', 'Periode', 'Stok Terjual', 'Pendapatan (Rp)', 'Profit (Rp)', 'Diskon Voucher (Rp)'];
    const rows = [];

    for (const [key, data] of Object.entries(recap.normal)) {
        const row = [key, data.totalStock, data.totalRevenue, data.totalProfit, data.totalVoucherDiscount || 0];
        if (!isSingle) row.unshift('Produk Sendiri');
        rows.push(row);
    }
    if (!isSingle) {
        for (const [key, data] of Object.entries(recap.reseller)) {
            rows.push(['Produk Reseller', key, data.totalStock, data.totalRevenue, data.totalProfit, data.totalVoucherDiscount || 0]);
        }
    }

    // Build CSV string manually (no dependency needed for simple CSV)
    let csv = headers.join(',') + '\n';
    for (const row of rows) {
        csv += row.map(val => {
            const str = sanitizeCSVValue(val);
            // Escape values containing commas or quotes
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        }).join(',') + '\n';
    }

    return Buffer.from(csv, 'utf-8');
}

/**
 * Generate PDF buffer from recap data
 * @param {Object} recap - { normal, reseller }
 * @param {string} period - 'harian' | 'mingguan' | 'bulanan'
 * @param {string} title - Report title
 * @returns {Promise<Buffer>}
 */
function generatePDF(recap, period, title) {
    const PDFDocument = require('pdfkit');

    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const chunks = [];

        doc.on('data', chunk => chunks.push(chunk));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        // Header
        doc.fontSize(18).text(title, { align: 'center' });
        doc.fontSize(10).text(`Generated: ${moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm')} WIB`, { align: 'center' });
        doc.moveDown(2);

        const isSingle = modeService.isSingleMode();

        if (isSingle) {
            // SINGLE mode: flat format, no categorization
            if (Object.keys(recap.normal).length > 0) {
                renderSection(doc, recap.normal);
                doc.moveDown();
            }

            const totals = sumRecapData(recap.normal);
            doc.fontSize(14).text('Total', { underline: true });
            doc.moveDown();
            doc.fontSize(10);
            doc.text(`Stok Terjual: ${totals.totalStock}`);
            doc.text(`Pendapatan Kotor: ${formatMoney(totals.totalRevenue)}`);
            doc.text(`Profit Bersih: ${formatMoney(totals.totalProfit)}`);
            if (totals.totalVoucher > 0) {
                doc.text(`Diskon Voucher: ${formatMoney(totals.totalVoucher)}`);
                doc.text(`Pendapatan Setelah Diskon: ${formatMoney(totals.totalRevenue - totals.totalVoucher)}`);
            }
        } else {
            // MULTI mode: Produk Sendiri + Produk Reseller sections
            if (Object.keys(recap.normal).length > 0) {
                doc.fontSize(14).text('Produk Sendiri', { underline: true });
                doc.moveDown();
                renderSection(doc, recap.normal);
                doc.moveDown();
            }

            if (Object.keys(recap.reseller).length > 0) {
                doc.fontSize(14).text('Produk Reseller', { underline: true });
                doc.moveDown();
                renderSection(doc, recap.reseller);
                doc.moveDown();
            }

            const normalTotals = sumRecapData(recap.normal);
            const resellerTotals = sumRecapData(recap.reseller);
            const totalStock = normalTotals.totalStock + resellerTotals.totalStock;
            const totalRevenue = normalTotals.totalRevenue + resellerTotals.totalRevenue;
            const totalProfit = normalTotals.totalProfit + resellerTotals.totalProfit;
            const totalVoucher = normalTotals.totalVoucher + resellerTotals.totalVoucher;

            doc.fontSize(14).text('Total Keseluruhan', { underline: true });
            doc.moveDown();
            doc.fontSize(10);
            doc.text(`Stok Terjual: ${totalStock}`);
            doc.text(`Pendapatan Kotor: ${formatMoney(totalRevenue)}`);
            doc.text(`Profit Bersih: ${formatMoney(totalProfit)}`);
            if (totalVoucher > 0) {
                doc.text(`Diskon Voucher: ${formatMoney(totalVoucher)}`);
                doc.text(`Pendapatan Setelah Diskon: ${formatMoney(totalRevenue - totalVoucher)}`);
            }
        }

        doc.end();
    });
}

function sumRecapData(recapSection) {
    let totalStock = 0, totalRevenue = 0, totalProfit = 0, totalVoucher = 0;
    for (const data of Object.values(recapSection)) {
        totalStock += data.totalStock;
        totalRevenue += data.totalRevenue;
        totalProfit += data.totalProfit;
        totalVoucher += data.totalVoucherDiscount || 0;
    }
    return { totalStock, totalRevenue, totalProfit, totalVoucher };
}

function renderSection(doc, data) {
    doc.fontSize(10);
    for (const [key, values] of Object.entries(data)) {
        doc.font('Helvetica-Bold').text(key);
        doc.font('Helvetica');
        doc.text(`  Stok Terjual: ${values.totalStock}`);
        doc.text(`  Pendapatan: ${formatMoney(values.totalRevenue)}`);
        doc.text(`  Profit: ${formatMoney(values.totalProfit)}`);
        if ((values.totalVoucherDiscount || 0) > 0) {
            doc.text(`  Diskon Voucher: ${formatMoney(values.totalVoucherDiscount)}`);
        }
        doc.moveDown(0.5);
    }
}

module.exports = { generateCSV, generatePDF };
