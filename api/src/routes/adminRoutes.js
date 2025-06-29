// src/routes/adminRoutes.js
import express from 'express';
import { buyStocksForGroup, getGroupStocks, promoteToAdmin, requireAdmin } from '../controllers/adminController.js';
import { createAuction, getExternalOffers, createProposal, respondToProposal, saveExternalOffer, getExchangeHistory, checkMyProposal, executeExchange, handleMyProposalRejected } from '../controllers/auctionController.js';

const router = express.Router();

// Ruta para comprar acciones (administrador)
router.post('/buy-stocks', requireAdmin, buyStocksForGroup);

// Ruta para ver stocks del grupo
router.get('/stocks', requireAdmin, getGroupStocks);

// Ruta para promover usuario a admin (solo configuración)
router.post('/promote', promoteToAdmin);

// 🏛️ Ruta para crear ofertas generales (Solo administradores)
router.post('/auctions/offer', requireAdmin, createAuction);

// Ruta para crear propuestas dirigidas como respuesta a ofertas (Solo administradores)
router.post('/auctions/proposal', requireAdmin, createProposal);

// Ruta para aceptar o rechazar propuestas (Solo administradores)
router.post('/auctions/respond', requireAdmin, respondToProposal);

// Ruta para obtener ofertas externas recibidas (Solo administradores)
router.get('/external-offers', requireAdmin, getExternalOffers);

// Ruta para guardar ofertas externas (usada por MQTT client)
router.post('/external-offers', saveExternalOffer);

// Ruta para obtener historial de intercambios (Solo administradores)
router.get('/exchange-history', requireAdmin, getExchangeHistory);

// Ruta para verificar si una propuesta es mía (usada por MQTT client)
router.post('/check-my-proposal', checkMyProposal);

// Ruta para ejecutar intercambio cuando mi propuesta es aceptada (usada por MQTT client)
router.post('/execute-exchange', executeExchange);

// Ruta para manejar rechazo de mis propuestas (devolver acciones reservadas, usada por MQTT client)
router.post('/handle-proposal-rejected', handleMyProposalRejected);

// MOVIDO: my-stocks ya no es solo para admin, se movió a server.js

export default router; 