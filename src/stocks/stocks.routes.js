const Router = require('koa-router');
const StockController = require('./stocks.controller');

const router = new Router({ prefix: '/stocks' });

router.post('/',          StockController.createStock);
router.get('/',           StockController.listStocks);
router.get('/:symbol',    StockController.getStockDetails);

module.exports = router;