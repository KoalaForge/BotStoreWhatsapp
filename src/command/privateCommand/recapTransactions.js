const transactionRepository = require('../../repositories/TransactionRepository');
const moment = require('moment-timezone');
const clc = require('cli-color');
const { requireAdmin } = require('../../middleware/waAuth');
const { formatMoney } = require('../../database/models/money');
const modeService = require('../../services/modeService');

const getDailySummary = async (context) => {
    const startOfMonth = moment().tz('Asia/Jakarta').startOf('month').toDate();
    const endOfMonth = moment().tz('Asia/Jakarta').endOf('month').toDate();

    const results = await transactionRepository.aggregate(context, [
        {
            $match: {
                isSuccess: true,
                isCanceled: false,
                $or: [
                    { transaction_type: 'product' },
                    { transaction_type: { $exists: false } }
                ],
                createdAt: { $gte: startOfMonth, $lte: endOfMonth }
            }
        },
        {
            $addFields: {
                dateOnly: {
                    $dateToString: {
                        format: '%Y-%m-%d',
                        date: '$createdAt',
                        timezone: 'Asia/Jakarta'
                    }
                },
                isReseller: { $ifNull: ['$is_reseller_order', false] }
            }
        },
        {
            $group: {
                _id: { date: '$dateOnly', isReseller: '$isReseller' },
                totalStock: { $sum: '$orderQuantity' },
                totalRevenue: { $sum: '$totalPrice' },
                totalProfit: { $sum: '$profit' },
                totalVoucherDiscount: { $sum: { $ifNull: ['$voucherDiscount', 0] } }
            }
        },
        { $sort: { '_id.date': 1 } }
    ]);

    const normal = {};
    const reseller = {};
    results.forEach(item => {
        const dayOfWeek = moment(item._id.date).locale('id').format('dddd, DD MMMM YYYY');
        const target = item._id.isReseller ? reseller : normal;
        target[dayOfWeek] = {
            totalStock: item.totalStock,
            totalRevenue: item.totalRevenue,
            totalProfit: item.totalProfit,
            totalVoucherDiscount: item.totalVoucherDiscount
        };
    });

    return { normal, reseller };
};

const getWeeklySummary = async (context) => {
    const startOfMonth = moment().tz('Asia/Jakarta').startOf('month').toDate();
    const endOfMonth = moment().tz('Asia/Jakarta').endOf('month').toDate();

    const results = await transactionRepository.find(context, {
        isSuccess: true,
        isCanceled: false,
        $or: [
            { transaction_type: 'product' },
            { transaction_type: { $exists: false } }
        ],
        createdAt: { $gte: startOfMonth, $lte: endOfMonth }
    }, {
        select: 'createdAt orderQuantity totalPrice profit is_reseller_order voucherDiscount',
        lean: true
    });

    const normal = {};
    const reseller = {};

    results.forEach(txn => {
        const transactionDate = moment(txn.createdAt).tz('Asia/Jakarta');
        const firstDayOfMonth = transactionDate.clone().startOf('month');
        const weekNumberInMonth = `Minggu ke-${Math.ceil((transactionDate.date() + firstDayOfMonth.day()) / 7)} pada bulan ${transactionDate.locale('id').format('MMMM')}`;

        const target = txn.is_reseller_order ? reseller : normal;

        if (!target[weekNumberInMonth]) {
            target[weekNumberInMonth] = { totalStock: 0, totalRevenue: 0, totalProfit: 0, totalVoucherDiscount: 0 };
        }

        target[weekNumberInMonth].totalStock += txn.orderQuantity;
        target[weekNumberInMonth].totalRevenue += txn.totalPrice;
        target[weekNumberInMonth].totalProfit += txn.profit;
        target[weekNumberInMonth].totalVoucherDiscount += txn.voucherDiscount || 0;
    });

    return { normal, reseller };
};

const getMonthlySummary = async (context) => {
    const startOfYear = moment().tz('Asia/Jakarta').startOf('year').toDate();
    const endOfYear = moment().tz('Asia/Jakarta').endOf('year').toDate();

    const results = await transactionRepository.aggregate(context, [
        {
            $match: {
                isSuccess: true,
                isCanceled: false,
                $or: [
                    { transaction_type: 'product' },
                    { transaction_type: { $exists: false } }
                ],
                createdAt: { $gte: startOfYear, $lte: endOfYear }
            }
        },
        {
            $addFields: {
                dateOnly: {
                    $dateToString: {
                        format: '%Y-%m-%d',
                        date: '$createdAt',
                        timezone: 'Asia/Jakarta'
                    }
                },
                isReseller: { $ifNull: ['$is_reseller_order', false] }
            }
        },
        {
            $group: {
                _id: { date: '$dateOnly', isReseller: '$isReseller' },
                totalStock: { $sum: '$orderQuantity' },
                totalRevenue: { $sum: '$totalPrice' },
                totalProfit: { $sum: '$profit' },
                totalVoucherDiscount: { $sum: { $ifNull: ['$voucherDiscount', 0] } }
            }
        },
        { $sort: { '_id.date': 1 } }
    ]);

    const normal = {};
    const reseller = {};

    results.forEach(item => {
        const transactionDate = moment(item._id.date);
        const month = transactionDate.locale('id').format('MMMM YYYY');
        const target = item._id.isReseller ? reseller : normal;

        if (!target[month]) {
            target[month] = { totalStock: 0, totalRevenue: 0, totalProfit: 0, totalVoucherDiscount: 0 };
        }

        target[month].totalStock += item.totalStock;
        target[month].totalRevenue += item.totalRevenue;
        target[month].totalProfit += item.totalProfit;
        target[month].totalVoucherDiscount += item.totalVoucherDiscount;
    });

    return { normal, reseller };
};

// Format a section (normal or reseller) with WhatsApp markdown
const formatSection = (label, data) => {
    if (Object.keys(data).length === 0) return { text: '', stock: 0, revenue: 0, profit: 0, voucherDiscount: 0 };

    let text = `*${label}:*\n`;
    let stock = 0, revenue = 0, profit = 0, voucherDiscount = 0;

    for (const key in data) {
        stock += data[key].totalStock;
        revenue += data[key].totalRevenue;
        profit += data[key].totalProfit;
        voucherDiscount += data[key].totalVoucherDiscount || 0;

        text += `*${key}:*\n`;
        text += `  Stok terjual: ${data[key].totalStock}\n`;
        text += `  Pendapatan kotor: ${formatMoney(data[key].totalRevenue)}\n`;
        text += `  Profit bersih: ${formatMoney(data[key].totalProfit)}\n`;
        if ((data[key].totalVoucherDiscount || 0) > 0) {
            const voucherPct = data[key].totalRevenue > 0
                ? ((data[key].totalVoucherDiscount / data[key].totalRevenue) * 100).toFixed(1)
                : '0.0';
            text += `  Diskon voucher: ${formatMoney(data[key].totalVoucherDiscount)} (${voucherPct}%)\n`;
        }
        text += `\n`;
    }

    text += `*Subtotal ${label}:*\n`;
    text += `  Stok terjual: ${stock}\n`;
    text += `  Pendapatan kotor: ${formatMoney(revenue)}\n`;
    text += `  Profit bersih: ${formatMoney(profit)}\n`;
    if (voucherDiscount > 0) {
        const subtotalPct = revenue > 0 ? ((voucherDiscount / revenue) * 100).toFixed(1) : '0.0';
        text += `  Diskon voucher: ${formatMoney(voucherDiscount)} (${subtotalPct}%)\n`;
        text += `  Pendapatan setelah diskon: ${formatMoney(revenue - voucherDiscount)}\n`;
    }
    text += `\n`;

    return { text, stock, revenue, profit, voucherDiscount };
};

// SINGLE mode: flat format
const formatRecapSimple = (title, data) => {
    if (Object.keys(data).length === 0) return `*${title}*\n\nBelum ada data transaksi.\n`;

    let text = `*${title}*\n\n`;
    let totalStock = 0, totalRevenue = 0, totalProfit = 0, totalVoucherDiscount = 0;

    for (const key in data) {
        totalStock += data[key].totalStock;
        totalRevenue += data[key].totalRevenue;
        totalProfit += data[key].totalProfit;
        totalVoucherDiscount += data[key].totalVoucherDiscount || 0;

        text += `*${key}:*\n`;
        text += `  Stok terjual: ${data[key].totalStock}\n`;
        text += `  Pendapatan kotor: ${formatMoney(data[key].totalRevenue)}\n`;
        text += `  Profit bersih: ${formatMoney(data[key].totalProfit)}\n`;
        if ((data[key].totalVoucherDiscount || 0) > 0) {
            const voucherPct = data[key].totalRevenue > 0
                ? ((data[key].totalVoucherDiscount / data[key].totalRevenue) * 100).toFixed(1)
                : '0.0';
            text += `  Diskon voucher: ${formatMoney(data[key].totalVoucherDiscount)} (${voucherPct}%)\n`;
        }
        text += `\n`;
    }

    text += `*Total:*\n`;
    text += `  Stok terjual: ${totalStock}\n`;
    text += `  Pendapatan kotor: ${formatMoney(totalRevenue)}\n`;
    text += `  Profit bersih: ${formatMoney(totalProfit)}\n`;
    if (totalVoucherDiscount > 0) {
        const totalPct = totalRevenue > 0 ? ((totalVoucherDiscount / totalRevenue) * 100).toFixed(1) : '0.0';
        text += `  Total diskon voucher: ${formatMoney(totalVoucherDiscount)} (${totalPct}%)\n`;
        text += `  Pendapatan setelah diskon: ${formatMoney(totalRevenue - totalVoucherDiscount)}\n`;
    }

    return text;
};

const formatRecap = (title, { normal, reseller }) => {
    if (modeService.isSingleMode()) {
        return formatRecapSimple(title, normal);
    }

    let text = `*${title}*\n\n`;

    const normalSection = formatSection('Produk Sendiri', normal);
    const resellerSection = formatSection('Produk Reseller', reseller);

    text += normalSection.text;
    text += resellerSection.text;

    const totalStock = normalSection.stock + resellerSection.stock;
    const totalRevenue = normalSection.revenue + resellerSection.revenue;
    const totalProfit = normalSection.profit + resellerSection.profit;
    const totalVoucherDiscount = (normalSection.voucherDiscount || 0) + (resellerSection.voucherDiscount || 0);

    text += `*Total Keseluruhan:*\n`;
    text += `  Stok terjual: ${totalStock}\n`;
    text += `  Pendapatan kotor: ${formatMoney(totalRevenue)}\n`;
    text += `  Profit bersih: ${formatMoney(totalProfit)}\n`;
    if (totalVoucherDiscount > 0) {
        const totalPct = totalRevenue > 0 ? ((totalVoucherDiscount / totalRevenue) * 100).toFixed(1) : '0.0';
        text += `  Total diskon voucher: ${formatMoney(totalVoucherDiscount)} (${totalPct}%)\n`;
        text += `  Pendapatan setelah diskon: ${formatMoney(totalRevenue - totalVoucherDiscount)}\n`;
    }

    return text;
};

const getPaymentMethodBreakdown = async (context, startDate, endDate) => {
    const results = await transactionRepository.aggregate(context, [
        {
            $match: {
                isSuccess: true,
                isCanceled: false,
                createdAt: { $gte: startDate, $lte: endDate }
            }
        },
        {
            $group: {
                _id: '$payment_method_code',
                count: { $sum: 1 },
                totalAmount: { $sum: '$totalPrice' },
                totalFees: { $sum: { $ifNull: ['$payment_fee', 0] } }
            }
        },
        { $sort: { totalAmount: -1 } }
    ]);

    return results.map(item => ({
        method: item._id || 'unknown',
        count: item.count,
        totalAmount: item.totalAmount,
        totalFees: item.totalFees
    }));
};

const formatPaymentBreakdown = (breakdown) => {
    if (!breakdown || breakdown.length === 0) return '';

    const methodNames = {
        'balance': 'Saldo',
        'qris': 'QRIS',
        'linkqu': 'LinkQu QRIS',
        'tokopay': 'TokoPay QRIS'
    };

    let text = `\n*Breakdown Metode Pembayaran:*\n`;
    let totalTx = 0, totalAmount = 0, totalFees = 0;

    for (const item of breakdown) {
        const name = methodNames[item.method] || item.method;
        totalTx += item.count;
        totalAmount += item.totalAmount;
        totalFees += item.totalFees;

        text += `*${name}:*\n`;
        text += `  Jumlah transaksi: ${item.count}\n`;
        text += `  Total pembayaran: ${formatMoney(item.totalAmount)}\n`;
        if (item.totalFees > 0) {
            text += `  Biaya gateway: ${formatMoney(item.totalFees)}\n`;
        }
        text += `\n`;
    }

    text += `*Total Pembayaran:*\n`;
    text += `  Total transaksi: ${totalTx}\n`;
    text += `  Total pembayaran: ${formatMoney(totalAmount)}\n`;
    if (totalFees > 0) {
        const feePercentage = totalAmount > 0 ? ((totalFees / totalAmount) * 100).toFixed(1) : 0;
        text += `  Total biaya gateway: ${formatMoney(totalFees)} (${feePercentage}%)\n`;
    }

    return text;
};

const dateRanges = {
    harian: () => ({ start: moment().tz('Asia/Jakarta').startOf('month').toDate(), end: moment().tz('Asia/Jakarta').endOf('month').toDate() }),
    mingguan: () => ({ start: moment().tz('Asia/Jakarta').startOf('month').toDate(), end: moment().tz('Asia/Jakarta').endOf('month').toDate() }),
    bulanan: () => ({ start: moment().tz('Asia/Jakarta').startOf('year').toDate(), end: moment().tz('Asia/Jakarta').endOf('year').toDate() })
};

/**
 * Recap transactions (WhatsApp version).
 * Usage: .rekap harian|mingguan|bulanan
 */
const recapTransactions = async (ctx) => {
    if (!await requireAdmin(ctx)) return;

    try {
        const argument = (ctx.commandText || '').trim();

        if (argument === '') {
            return ctx.reply(
                '*Penggunaan:*\n' +
                '`.rekap harian|mingguan|bulanan`'
            );
        }

        const handlers = {
            harian: { fn: getDailySummary, title: 'Rekap Harian' },
            mingguan: { fn: getWeeklySummary, title: () => `Rekap mingguan pada bulan ${moment().locale('id').format('MMMM YYYY')}` },
            bulanan: { fn: getMonthlySummary, title: () => `Rekap bulanan pada tahun ${moment().locale('id').format('YYYY')}` }
        };

        const handler = handlers[argument];
        if (!handler) {
            return ctx.reply('*Nilai rekap yang valid adalah harian, bulanan serta mingguan.*');
        }

        const recap = await handler.fn(ctx);
        const title = typeof handler.title === 'function' ? handler.title() : handler.title;

        const { start, end } = dateRanges[argument]();
        const paymentBreakdown = await getPaymentMethodBreakdown(ctx, start, end);

        let recapText = formatRecap(title, recap);
        recapText += formatPaymentBreakdown(paymentBreakdown);

        // Send as text. For large recaps, also offer export as file.
        if (recapText.length > 4000) {
            // Send as document for large recaps
            const timestamp = moment().tz('Asia/Jakarta').format('YYYYMMDD_HHmmss');
            const filename = `rekap_${argument}_${timestamp}.txt`;
            const buffer = Buffer.from(recapText.replace(/\*/g, '').replace(/_/g, ''), 'utf8');
            await ctx.sendDocument(buffer, filename, `*${title}*\n\n_Rekap terlalu panjang, dikirim sebagai file._`);
        } else {
            await ctx.reply(recapText);
        }

    } catch (err) {
        await ctx.reply('*Terjadi kesalahan, silakan coba lagi.*');
        console.log(clc.red.bold("[ ERROR ]") + ` [${moment().format('HH:mm:ss')}]: ${clc.blueBright(`Error in recapTransactions: ${err.message}`)}`);
    }
};

module.exports = recapTransactions;
module.exports.getDailySummary = getDailySummary;
module.exports.getWeeklySummary = getWeeklySummary;
module.exports.getMonthlySummary = getMonthlySummary;
module.exports.getPaymentMethodBreakdown = getPaymentMethodBreakdown;
