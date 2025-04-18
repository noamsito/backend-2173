const Koa        = require('koa');
const cors       = require('@koa/cors');
const bodyParser = require('koa-bodyparser');

const stocksRoutes = require('./stocks/stocks.routes');
const ordersRoutes = require('./orders/orders.routes');  // ← aquí

const app = new Koa();

app.use(cors());
app.use(bodyParser());

// Rutas de stocks
app.use(stocksRoutes.routes());
app.use(stocksRoutes.allowedMethods());

// Rutas de órdenes
app.use(ordersRoutes.routes());
app.use(ordersRoutes.allowedMethods());

module.exports = app;