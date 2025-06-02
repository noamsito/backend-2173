// src/routes/purchases.js
import express from 'express';
import { createPurchase, getEstimation, getUserPurchases, getPurchaseStats } from '../controllers/purchaseController.js';

const router = express.Router();

// Listar compras de un usuario
//router.get('/user/:userId', getUserPurchases);

// Crear nueva compra
//router.post('/', createPurchase);

// Obtener estimación de una compra
router.get('/:purchaseId/estimate', getEstimation);

// 🆕 NUEVA RUTA - Estadísticas de compras
//router.get('/stats', getPurchaseStats);

export default router;