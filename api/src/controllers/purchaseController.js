// src/controllers/purchaseController.js
import axios from 'axios';
import Purchase from '../models/Purchase.js';

// Función helper para validar si es un número entero válido
const isValidInteger = (value) => {
  return Number.isInteger(Number(value)) && Number(value) > 0;
};

// Función helper para validar UUID (MÁS PERMISIVA)
const isValidUUID = (value) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
};

// GET /api/purchases/user/:userId - Obtener compras de un usuario
export const getUserPurchases = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!isValidInteger(userId)) {
      return res.status(400).json({
        error: 'userId debe ser un número entero válido',
        example: '1'
      });
    }

    const purchases = await Purchase.findAll({
      where: { userId: parseInt(userId) },
      order: [['createdAt', 'DESC']]
    });

    res.json(purchases);
  } catch (error) {
    console.error('Error al obtener compras:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// POST /api/purchases - Crear una nueva compra
export const createPurchase = async (req, res) => {
  try {
    const { userId, symbol, quantity, priceAtPurchase } = req.body;

    if (!isValidInteger(userId)) {
      return res.status(400).json({
        error: 'userId debe ser un número entero válido',
        example: '1'
      });
    }

    if (!symbol || typeof symbol !== 'string') {
      return res.status(400).json({ error: 'symbol es requerido y debe ser string' });
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: 'quantity debe ser un número entero positivo' });
    }

    if (!Number.isFinite(priceAtPurchase) || priceAtPurchase <= 0) {
      return res.status(400).json({ error: 'priceAtPurchase debe ser un número positivo' });
    }

    const purchase = await Purchase.create({
      userId: parseInt(userId),
      symbol: symbol.toUpperCase(),
      quantity,
      priceAtPurchase
    });

    try {
      await axios.post(`${process.env.JOBMASTER_URL}/job`, {
        purchaseId: purchase.id,
        symbol,
        quantity
      });
    } catch (jobError) {
      console.warn('JobMaster no disponible:', jobError.message);
    }

    res.status(201).json(purchase);
  } catch (error) {
    console.error('Error al crear compra:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};

// GET /api/purchases/:purchaseId/estimate - Obtener estimación de una compra
export const getEstimation = async (req, res) => {
  try {
    const { purchaseId } = req.params;

    console.log('🔍 Validando purchaseId:', purchaseId);

    if (!isValidUUID(purchaseId)) {
      console.log('❌ UUID inválido:', purchaseId);
      return res.status(400).json({
        error: 'purchaseId debe ser un UUID válido',
        received: purchaseId,
        example: '0cf4d84b-debe-4f0e-b167-4e9da9ceb3b1'
      });
    }

    console.log('✅ UUID válido, buscando compra...');

    const purchase = await Purchase.findByPk(purchaseId);
    
    if (!purchase) {
      console.log('❌ Compra no encontrada');
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    console.log('✅ Compra encontrada:', purchase.toJSON());

    const mockPrices = {
      'AAPL': 175.30,
      'GOOGL': 142.56,
      'MSFT': 378.85,
      'TSLA': 248.12,
      'AMZN': 145.34
    };
    
    const currentPrice = mockPrices[purchase.symbol] || purchase.priceAtPurchase * (0.8 + Math.random() * 0.4);

    const totalInvested = purchase.quantity * purchase.priceAtPurchase;
    const currentValue = purchase.quantity * currentPrice;
    const gainLoss = currentValue - totalInvested;
    const gainLossPercentage = (gainLoss / totalInvested) * 100;

    const changeRate = gainLossPercentage / 100;
    const futureEstimate = currentPrice * (1 + changeRate * 0.5);

    const estimation = {
      purchase: {
        id: purchase.id,
        symbol: purchase.symbol,
        quantity: purchase.quantity,
        priceAtPurchase: purchase.priceAtPurchase,
        purchaseDate: purchase.createdAt
      },
      currentPrice,
      totalInvested,
      currentValue,
      gainLoss,
      gainLossPercentage: parseFloat(gainLossPercentage.toFixed(2)),
      linearEstimation: {
        estimatedPrice: parseFloat(futureEstimate.toFixed(2)),
        estimatedValue: parseFloat((purchase.quantity * futureEstimate).toFixed(2)),
        confidence: 'low',
        timeframe: '30 days'
      }
    };

    console.log('✅ Estimación calculada:', estimation);
    res.json(estimation);
  } catch (error) {
    console.error('❌ Error al calcular estimación:', error);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
};