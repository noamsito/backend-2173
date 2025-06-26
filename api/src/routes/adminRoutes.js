// src/routes/adminRoutes.js
import express from 'express';
import { buyStocksForGroup, getGroupStocks, promoteToAdmin, requireAdmin } from '../controllers/adminController.js';
import { createAuction, getExternalOffers, createProposal, respondToProposal, saveExternalOffer, getExchangeHistory, checkMyProposal, executeExchange, getMyStocks, handleMyProposalRejected } from '../controllers/auctionController.js';

const router = express.Router();

// Ruta para comprar acciones (administrador)
router.post('/buy-stocks', requireAdmin, buyStocksForGroup);

// Ruta para ver stocks del grupo
router.get('/stocks', requireAdmin, getGroupStocks);

// Ruta para promover usuario a admin (solo configuración)
router.post('/promote', promoteToAdmin);

// Ruta para crear ofertas generales (temporal sin requireAdmin)
router.post('/auctions/offer', createAuction);

// Ruta para crear propuestas dirigidas como respuesta a ofertas (temporal sin requireAdmin)
router.post('/auctions/proposal', createProposal);

// Ruta para aceptar o rechazar propuestas
router.post('/auctions/respond', respondToProposal);

// Ruta para obtener ofertas externas recibidas
router.get('/external-offers', getExternalOffers);

// Ruta para guardar ofertas externas (usada por MQTT client)
router.post('/external-offers', saveExternalOffer);

// Ruta para obtener historial de intercambios
router.get('/exchange-history', getExchangeHistory);

// Ruta para verificar si una propuesta es mía (usada por MQTT client)
router.post('/check-my-proposal', checkMyProposal);

// Ruta para ejecutar intercambio cuando mi propuesta es aceptada (usada por MQTT client)
router.post('/execute-exchange', executeExchange);

// Ruta para manejar rechazo de mis propuestas (devolver acciones reservadas, usada por MQTT client)
router.post('/handle-proposal-rejected', handleMyProposalRejected);

// Ruta para obtener el inventario real de acciones del usuario
router.get('/my-stocks', getMyStocks);

export default router; 