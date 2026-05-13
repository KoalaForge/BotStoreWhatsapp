const { requireAdmin } = require('../middleware/waAuth');
const moment = require('moment-timezone');
const { getDailySummary, getWeeklySummary, getMonthlySummary } = require('../command/privateCommand/recapTransactions');
const reportExporter = require('../utils/reportExporter');

const recapHandlers = {
    harian: { fn: getDailySummary, title: 'Rekap Harian' },
    mingguan: { fn: getWeeklySummary, title: () => `Rekap mingguan pada bulan ${moment().locale('id').format('MMMM YYYY')}` },
    bulanan: { fn: getMonthlySummary, title: () => `Rekap bulanan pada tahun ${moment().locale('id').format('YYYY')}` }
};

/**
 * Export recap as CSV or PDF file (WhatsApp version).
 * Usage: .exportrekap <harian|mingguan|bulanan> <csv|pdf>
 *
 * In Telegram this was a callback handler matching `export-recap-(csv|pdf)-(harian|mingguan|bulanan)`.
 * In WhatsApp we use a text command since there are no inline keyboards for this flow.
 */
async function exportRecap(ctx) {
    if (!await requireAdmin(ctx)) return;

    try {
        const args = ctx.commandArgs || [];

        if (args.length < 2) {
            return ctx.reply(
                `*Export Rekap*\n\n` +
                `*Penggunaan:*\n` +
                `.exportrekap <periode> <format>\n\n` +
                `*Periode:* harian, mingguan, bulanan\n` +
                `*Format:* csv, pdf\n\n` +
                `*Contoh:*\n` +
                `.exportrekap harian csv\n` +
                `.exportrekap bulanan pdf`
            );
        }

        const period = args[0].toLowerCase().trim();
        const format = args[1].toLowerCase().trim();

        if (!recapHandlers[period]) {
            return ctx.reply('*Periode tidak valid.* Gunakan: harian, mingguan, atau bulanan.');
        }

        if (!['csv', 'pdf'].includes(format)) {
            return ctx.reply('*Format tidak valid.* Gunakan: csv atau pdf.');
        }

        await ctx.reply(`_Membuat file ${format.toUpperCase()}..._`);

        const handler = recapHandlers[period];
        const recap = await handler.fn(ctx);
        const title = typeof handler.title === 'function' ? handler.title() : handler.title;
        const dateStr = moment().tz('Asia/Jakarta').format('YYYY-MM-DD');

        let fileBuffer, filename, mimetype;
        if (format === 'csv') {
            fileBuffer = reportExporter.generateCSV(recap, period);
            filename = `rekap-${period}-${dateStr}.csv`;
            mimetype = 'text/csv';
        } else {
            fileBuffer = await reportExporter.generatePDF(recap, period, title);
            filename = `rekap-${period}-${dateStr}.pdf`;
            mimetype = 'application/pdf';
        }

        const caption = `*${title}*\nGenerated: ${moment().tz('Asia/Jakarta').format('DD/MM/YYYY HH:mm')} WIB`;

        await ctx.sendDocument(fileBuffer, filename, caption, mimetype);

    } catch (err) {
        console.error('Export recap error:', err);
        await ctx.reply('*Terjadi kesalahan, gagal membuat file export.*\n\n_Silakan coba lagi._');
    }
}

module.exports = exportRecap;
