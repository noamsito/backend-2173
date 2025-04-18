const StockService = require('./stocks.service');

async function listStocks(ctx) {
  try {
    const result = await StockService.listStocks({
      page:  ctx.query.page,
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

module.exports = { listStocks };