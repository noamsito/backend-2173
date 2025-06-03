import express from 'express';
import { WebpayController } from '../controllers/webpayController.js';

const router = express.Router();

// Iniciar transacción de pago
router.post('/init', WebpayController.initTransaction);

// Manejar retorno de Webpay (GET y POST)
router.get('/return', WebpayController.handleReturn);
router.post('/return', WebpayController.handleReturn);


// Obtener estado de transacción
router.get('/status/:token', WebpayController.getTransactionStatus);


export default router;