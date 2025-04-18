const Router              = require('koa-router');
const { listStocks }      = require('./stocks.controller');

const router = new Router({ prefix: '/stocks' });
router.get('/', listStocks);

module.exports = router;