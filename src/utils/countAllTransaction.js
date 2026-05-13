const clc = require("cli-color");
const moment = require('moment-timezone');
const transactionRepository = require("../repositories/TransactionRepository");

async function countAllTransaction(context) {
    try {
        const transactionData = await transactionRepository.find(context, { isSuccess: true, isCanceled: false })
        const profit = transactionData.reduce((total, data) => {
            return total + data.totalPrice;
        }, 0);


        return [transactionData.length, profit]
    } catch (err) {
        console.log(clc.red.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Something error in file utils/countAllTransaction.js  ${err.message}`));
    }
}

module.exports = countAllTransaction