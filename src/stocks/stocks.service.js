const { stocks, Sequelize } = require('../db/models');
const { Op } = Sequelize;

async function createStock(data) {
  return stocks.create(data);
}

async function listStocks({ page = 1, count = 25 }) {
  const offset = (page - 1) * count;
  const data = await stocks.findAll({
    order: [['updatedAt', 'DESC']],
    limit: count,
    offset
  });
  return { data, pagination: { page, count } };
}

async function getStockDetails(symbol, { price, quantity, date, page = 1, count = 25 }) {
  const where = { symbol };

  if (price != null)      where.price    = { [Op.lt]: parseFloat(price) };
  if (quantity != null)   where.quantity = { [Op.lte]: parseInt(quantity) };
  if (date) {
    const start = new Date(date);
    const end   = new Date(date);
    end.setHours(23,59,59,999);
    where.timestamp = { [Op.between]: [start, end] };
  }

  const offset = (page - 1) * count;
  const data = await stocks.findAll({ where, limit: count, offset, order: [['updatedAt','DESC']] });

  return { data, pagination: { page, count } };
}

module.exports = { createStock, listStocks, getStockDetails };