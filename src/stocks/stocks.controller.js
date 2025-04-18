const StockService = require('./stocks.service');

async function createStock(ctx) {
  try {
    const created = await StockService.createStock(ctx.request.body);
    ctx.status = 201;
    ctx.body = { message: 'Stock creada exitosamente', data: created };
  } catch (err) {
    console.error(err);
    ctx.status = 500;
    ctx.body = { message: 'Error interno del servidor' };
  }
}

async function listStocks(ctx) {
  try {
    const result = await StockService.listStocks({
      page: ctx.query.page,
      count: ctx.query.count
    });
    ctx.status = 200;
    ctx.body = { message: 'Lista de stocks', ...result };
  } catch (err) {
    console.error(err);
    ctx.status = 500;
    ctx.body = { message: 'Error interno del servidor' };
  }
}

async function getStockDetails(ctx) {
  try {
    const { symbol } = ctx.params;
    const result = await StockService.getStockDetails(symbol, {
      price: ctx.query.price,
      quantity: ctx.query.quantity,
      date: ctx.query.date,
      page: ctx.query.page,
      count: ctx.query.count
    });
    ctx.status = 200;
    ctx.body = { message: `Detalle de stocks con símbolo ${symbol}`, ...result };
  } catch (err) {
    console.error(err);
    ctx.status = 500;
    ctx.body = { message: 'Error interno del servidor' };
  }
}

module.exports = { createStock, listStocks, getStockDetails };