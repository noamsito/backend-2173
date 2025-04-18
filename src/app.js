const Koa        = require('koa');
const bodyParser = require('koa-bodyparser');
const cors       = require('@koa/cors');

const stocksRoutes = require('./stocks/stocks.routes');
// aquí podrías añadir más routers, p.ej. authRoutes, walletRoutes, etc.

const app = new Koa();

// Middlewares globales
app.use(cors());
app.use(bodyParser());

// Montaje de rutas
app.use(stocksRoutes.routes());
app.use(stocksRoutes.allowedMethods());

module.exports = app;