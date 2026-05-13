const clc = require("cli-color");
const moment = require('moment-timezone');
const transactionRepository = require("../repositories/TransactionRepository");

async function countUserOrders(context, telegramId) {
    try {
        // Use MongoDB aggregation for better performance
        const result = await transactionRepository.aggregate(context, [
            {
                $match: {
                    user_id: telegramId,
                    isSuccess: true,
                    isCanceled: false
                }
            },
            {
                $group: {
                    _id: null,
                    totalQuantity: { $sum: "$orderQuantity" }
                }
            }
        ]);

        return result.length > 0 ? result[0].totalQuantity : 0;
    } catch (err) {
        console.log(clc.red.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Something error in file utils/countUserOrders.js  ${err.message}`));
        return 0;
    }
}

async function countSoldStocks(context) {
    try {
        // Use MongoDB aggregation for better performance - calculates sum directly in database
        const result = await transactionRepository.aggregate(context, [
            {
                $match: {
                    isSuccess: true,
                    isCanceled: false,
                    orderQuantity: { $exists: true, $ne: null }
                }
            },
            {
                $group: {
                    _id: null,
                    totalQuantity: { $sum: "$orderQuantity" }
                }
            }
        ]);

        return result.length > 0 ? result[0].totalQuantity : 0;
    } catch (err) {
        console.log(clc.red.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Something error in file utils/countUserOrders.js  ${err.message}`));
        return 0;
    }
}

async function sumUserTransactionAmount(context, telegramId) {
    try {
        // Use MongoDB aggregation for better performance
        const result = await transactionRepository.aggregate(context, [
            {
                $match: {
                    user_id: telegramId.toString(),
                    isSuccess: true,
                    isCanceled: false
                }
            },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: "$totalPrice" }
                }
            }
        ]);

        return result.length > 0 ? result[0].totalAmount : 0;
    } catch (err) {
        console.log(clc.red.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Something error in file utils/countUserOrders.js  ${err.message}`));
        return 0;
    }
}

async function sumUsersTransactionAmount(context) {
    try {
        // Use MongoDB aggregation for better performance
        const result = await transactionRepository.aggregate(context, [
            {
                $match: {
                    isSuccess: true,
                    isCanceled: false
                }
            },
            {
                $group: {
                    _id: null,
                    totalAmount: { $sum: "$totalPrice" }
                }
            }
        ]);

        return result.length > 0 ? result[0].totalAmount : 0;
    } catch (err) {
        console.log(clc.red.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Something error in file utils/countUserOrders.js  ${err.message}`));
        return 0;
    }
}

module.exports = {
    countUserOrders,
    sumUserTransactionAmount,
    countSoldStocks,
    sumUsersTransactionAmount,
}