const Router = require('koa-router');
const router = new Router();
const models = require('../models'); // Asegúrate de que este path sea correcto y que el modelo se llame "stocks"

// POST /stocks
router.post('/', async (ctx) => {
  try {
    console.log("Datos recibidos en POST:", ctx.request.body);
    let stockData = ctx.request.body;
    const createdStock = await models.stocks.create(stockData);
    ctx.status = 201;
    ctx.body = {
      message: "Stock creada exitosamente",
      data: createdStock
    };
  } catch (error) {
    console.error("Error al crear stock:", error);
    ctx.status = 500;
    ctx.body = { message: "Error interno del servidor" };
  }
});

// GET /stocks - Listado de stocks con paginación
router.get('/', async (ctx) => {
  try {
    const page = parseInt(ctx.query.page) || 1;
    const count = parseInt(ctx.query.count) || 25;
    const offset = (page - 1) * count;
    
    const stocks = await models.stocks.findAll({
      order: [['updatedAt', 'DESC']],
      limit: count,
      offset: offset
    });
    ctx.status = 200;
    ctx.body = {
      message: "Lista de stocks",
      data: stocks,
      pagination: {
        page: page,
        count: count
      }
    };
  } catch (error) {
    console.error("Error al obtener stocks:", error);
    ctx.status = 500;
    ctx.body = { message: "Error interno del servidor" };
  }
});

// GET /stocks/:symbol - Detalle de stock(s) por símbolo con filtros opcionales
router.get('/:symbol', async (ctx) => {
  try {
    const symbol = ctx.params.symbol;
    // Filtros opcionales
    const priceFilter = ctx.query.price ? parseFloat(ctx.query.price) : null;
    const quantityFilter = ctx.query.quantity ? parseInt(ctx.query.quantity) : null;
    const dateFilter = ctx.query.date; // Formato: YYYY-MM-DD

    // Construir condición "where"
    let where = { symbol: symbol };

    // Filtro por precio menor al indicado
    if (priceFilter !== null) {
      where.price = { [models.Sequelize.Op.lt]: priceFilter };
    }
    // Filtro por cantidad menor o igual
    if (quantityFilter !== null) {
      where.quantity = { [models.Sequelize.Op.lte]: quantityFilter };
    }
    // Filtro por fecha de publicación
    if (dateFilter) {
      const startDate = new Date(dateFilter);
      const endDate = new Date(dateFilter);
      endDate.setHours(23, 59, 59, 999);
      where.timestamp = { [models.Sequelize.Op.between]: [startDate, endDate] };
    }

    // Paginación (opcional en este endpoint también)
    const page = parseInt(ctx.query.page) || 1;
    const count = parseInt(ctx.query.count) || 25;
    const offset = (page - 1) * count;

    const stocks = await models.stocks.findAll({
      where: where,
      limit: count,
      offset: offset,
      order: [['updatedAt', 'DESC']]
    });

    ctx.status = 200;
    ctx.body = {
      message: `Detalle de stocks con símbolo ${symbol}`,
      data: stocks,
      pagination: {
        page: page,
        count: count
      }
    };
  } catch (error) {
    console.error("Error al obtener detalle de stock:", error);
    ctx.status = 500;
    ctx.body = { message: "Error interno del servidor" };
  }
});

module.exports = router;