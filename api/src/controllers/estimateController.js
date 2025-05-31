const express = require('express');
const { createPurchase, getEstimation } = require('../controllers/purchaseController');
const router = express.Router();

router.post('/', createPurchase);
router.get('/:id/estimate', getEstimation);

module.exports = router;