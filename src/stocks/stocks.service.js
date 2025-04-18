const { stocks } = require('../db/models');

async function saveMarketUpdate(data) {
  return stocks.create({
    symbol:    data.symbol,
    price:     data.price,
    longName:  data.longName || null,
    quantity:  data.quantity || null,
    timestamp: data.timestamp
  });
}

async function listStocks({ page = 1, count = 25 } = {}) {
  const offset = (page - 1) * count;
  const data = await stocks.findAll({
    order: [['updatedAt','DESC']],
    limit: count,
    offset
  });
  return { data, pagination: { page, count } };
}

module.exports = { saveMarketUpdate, listStocks };