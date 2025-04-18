const Koa = require('koa');
const Router = require('koa-router');
const bodyParser = require('koa-bodyparser');
const stocksRouter = require('./stocks');

const app = new Koa();
const router = new Router();

// Middleware para parsear el body de las peticiones
app.use(bodyParser());

// Montar las rutas de stocks en el path /stocks
router.use('/stocks', stocksRouter.routes(), stocksRouter.allowedMethods());

// Registrar las rutas en la aplicación
app.use(router.routes()).use(router.allowedMethods());

module.exports = app;