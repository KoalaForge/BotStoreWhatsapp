const stockRepository = require('../repositories/StockRepository');
const moment = require('moment-timezone');
const clc = require('cli-color')

const addStocks = async (context, text, code, profit = 0) => {
  try {
    // Pisahkan teks berdasarkan newline (\n)
    const products = text.split("\n").map(product => product.trim()).filter(product => product);

    for (const product of products) {
      await stockRepository.create(context, {
        codeVariant: code,
        dataStock: product,
        profit: profit,
      });
    }

    console.log(clc.green.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Stocks added successfully`));
    return;
  } catch (err) {
    console.log(clc.red.bold("[ INFO ]") + ` [${moment().format('HH:mm:ss')}]:` + clc.blueBright(` Error add stock : ${err.message}`));
  }
};

module.exports = addStocks;