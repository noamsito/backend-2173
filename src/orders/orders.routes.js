const Router          = require('koa-router');
const { createOrder } = require('./orders.controller');

const router = new Router({ prefix: '/orders' });

router.post('/', createOrder);

module.exports = router;