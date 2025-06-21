import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

// No crear pool aquí, usar el del servidor principal
const GROUP_ID = process.env.GROUP_ID || "1";

// RF04: Crear una subasta
export const createAuction = async (req, res) => {
  // Usar el pool del servidor principal que se pasa como req.pool
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  
  try {
    const { symbol, quantity, starting_price, duration_minutes } = req.body;
    
    // Validar parámetros
    if (!symbol || !quantity || !starting_price || !duration_minutes) {
      return res.status(400).json({ 
        error: "Faltan parámetros requeridos",
        required: ["symbol", "quantity", "starting_price", "duration_minutes"]
      });
    }
    
    if (quantity <= 0 || starting_price <= 0 || duration_minutes <= 0) {
      return res.status(400).json({ 
        error: "Los valores deben ser positivos" 
      });
    }
    
    await client.query('BEGIN');
    
    // Verificar que tengamos suficientes acciones del símbolo
    const stockQuery = `
      SELECT SUM(quantity) as total_quantity 
      FROM stocks 
      WHERE symbol = $1 AND quantity > 0
    `;
    const stockResult = await client.query(stockQuery, [symbol]);
    
    if (!stockResult.rows[0] || stockResult.rows[0].total_quantity < quantity) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: "No hay suficientes acciones disponibles para subastar" 
      });
    }
    
    // Crear la subasta
    const auctionId = uuidv4();
    const endTime = new Date(Date.now() + duration_minutes * 60 * 1000);
    
    const insertQuery = `
      INSERT INTO auctions (
        id, group_id, symbol, quantity, starting_price, 
        current_price, end_time, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
      RETURNING *
    `;
    
    const auctionResult = await client.query(insertQuery, [
      auctionId,
      GROUP_ID,
      symbol,
      quantity,
      starting_price,
      starting_price,
      endTime
    ]);
    
    // Reservar las acciones para la subasta
    await client.query(`
      UPDATE stocks 
      SET quantity = quantity - $1 
      WHERE symbol = $2 
      AND id = (SELECT id FROM stocks WHERE symbol = $2 AND quantity > 0 ORDER BY timestamp DESC LIMIT 1)
    `, [quantity, symbol]);
    
    await client.query('COMMIT');
    
    const auction = auctionResult.rows[0];
    
    // RNF05: Publicar la subasta en el canal stocks/auctions
    const auctionMessage = {
      type: 'AUCTION_CREATED',
      auction_id: auctionId,
      group_id: GROUP_ID,
      symbol: symbol,
      quantity: quantity,
      starting_price: starting_price,
      end_time: endTime.toISOString(),
      timestamp: new Date().toISOString()
    };
    
    try {
      await axios.post('http://mqtt-client:3000/publish', {
        topic: 'stocks/auctions',
        message: auctionMessage
      });
      console.log(`📢 Subasta publicada en stocks/auctions: ${auctionId}`);
    } catch (mqttError) {
      console.error('❌ Error publicando subasta en MQTT:', mqttError);
    }
    
    // Registrar evento
    await logEvent('AUCTION_CREATED', {
      auction_id: auctionId,
      symbol: symbol,
      quantity: quantity,
      starting_price: starting_price,
      end_time: endTime
    }, pool);
    
    res.status(201).json({
      status: "success",
      message: "Subasta creada exitosamente",
      auction: auction
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error creando subasta:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    client.release();
  }
};

// Obtener subastas activas
export const getActiveAuctions = async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!pool) {
      throw new Error('Database pool no está disponible');
    }
    
    const query = `
      SELECT a.*, 
             COUNT(DISTINCT ab.id) as bid_count,
             MAX(ab.bid_amount) as highest_bid
      FROM auctions a
      LEFT JOIN auction_bids ab ON a.id = ab.auction_id
      WHERE a.status = 'ACTIVE' AND a.end_time > NOW()
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `;
    
    const result = await pool.query(query);
    
    res.json({
      status: "success",
      auctions: result.rows
    });
    
  } catch (error) {
    console.error("Error obteniendo subastas:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// Hacer una oferta en una subasta
export const placeBid = async (req, res) => {
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  
  try {
    const { auction_id } = req.params;
    const { bid_amount } = req.body;
    const bidder_group_id = req.body.group_id || GROUP_ID;
    
    if (!bid_amount || bid_amount <= 0) {
      return res.status(400).json({ error: "El monto de la oferta debe ser positivo" });
    }
    
    await client.query('BEGIN');
    
    // Verificar que la subasta existe y está activa
    const auctionQuery = `
      SELECT * FROM auctions 
      WHERE id = $1 AND status = 'ACTIVE' AND end_time > NOW()
    `;
    const auctionResult = await client.query(auctionQuery, [auction_id]);
    
    if (auctionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Subasta no encontrada o ya cerrada" });
    }
    
    const auction = auctionResult.rows[0];
    
    // Verificar que la oferta sea mayor que el precio actual
    if (bid_amount <= auction.current_price) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: "La oferta debe ser mayor al precio actual",
        current_price: auction.current_price
      });
    }
    
    // Insertar la oferta
    const bidId = uuidv4();
    await client.query(`
      INSERT INTO auction_bids (id, auction_id, bidder_group_id, bid_amount)
      VALUES ($1, $2, $3, $4)
    `, [bidId, auction_id, bidder_group_id, bid_amount]);
    
    // Actualizar el precio actual de la subasta
    await client.query(`
      UPDATE auctions 
      SET current_price = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [bid_amount, auction_id]);
    
    await client.query('COMMIT');
    
    // RNF05: Publicar la oferta en el canal stocks/auctions
    const bidMessage = {
      type: 'AUCTION_BID',
      auction_id: auction_id,
      bidder_group_id: bidder_group_id,
      bid_amount: bid_amount,
      timestamp: new Date().toISOString()
    };
    
    try {
      await axios.post('http://mqtt-client:3000/publish', {
        topic: 'stocks/auctions',
        message: bidMessage
      });
      console.log(`💰 Oferta publicada en stocks/auctions: ${bid_amount} para subasta ${auction_id}`);
    } catch (mqttError) {
      console.error('❌ Error publicando oferta en MQTT:', mqttError);
    }
    
    res.json({
      status: "success",
      message: "Oferta realizada exitosamente",
      bid: {
        id: bidId,
        auction_id: auction_id,
        bid_amount: bid_amount
      }
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error realizando oferta:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    client.release();
  }
};

// Cerrar una subasta (admin o automático)
export const closeAuction = async (req, res) => {
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  
  try {
    const { auction_id } = req.params;
    
    await client.query('BEGIN');
    
    // Obtener la subasta con la oferta más alta
    const auctionQuery = `
      SELECT a.*, 
             ab.bidder_group_id as winner_group_id,
             ab.bid_amount as winning_bid
      FROM auctions a
      LEFT JOIN auction_bids ab ON a.id = ab.auction_id 
        AND ab.bid_amount = (
          SELECT MAX(bid_amount) FROM auction_bids WHERE auction_id = a.id
        )
      WHERE a.id = $1 AND a.status = 'ACTIVE'
    `;
    
    const auctionResult = await client.query(auctionQuery, [auction_id]);
    
    if (auctionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Subasta no encontrada o ya cerrada" });
    }
    
    const auction = auctionResult.rows[0];
    
    // Actualizar el estado de la subasta
    if (auction.winner_group_id) {
      // Hay un ganador
      await client.query(`
        UPDATE auctions 
        SET status = 'CLOSED', 
            winner_group_id = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [auction.winner_group_id, auction_id]);
      
      // Transferir las acciones al ganador (se manejará por MQTT)
    } else {
      // No hubo ofertas, devolver las acciones
      await client.query(`
        UPDATE auctions 
        SET status = 'CANCELLED',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [auction_id]);
      
      // Devolver las acciones al inventario
      await client.query(`
        UPDATE stocks 
        SET quantity = quantity + $1 
        WHERE symbol = $2
        AND id = (SELECT id FROM stocks WHERE symbol = $2 ORDER BY timestamp DESC LIMIT 1)
      `, [auction.quantity, auction.symbol]);
    }
    
    await client.query('COMMIT');
    
    // RNF05: Publicar el cierre en el canal stocks/auctions
    const closeMessage = {
      type: 'AUCTION_CLOSED',
      auction_id: auction_id,
      winner_group_id: auction.winner_group_id,
      winning_bid: auction.winning_bid,
      symbol: auction.symbol,
      quantity: auction.quantity,
      timestamp: new Date().toISOString()
    };
    
    try {
      await axios.post('http://mqtt-client:3000/publish', {
        topic: 'stocks/auctions',
        message: closeMessage
      });
      console.log(`🔨 Subasta cerrada y publicada en stocks/auctions: ${auction_id}`);
    } catch (mqttError) {
      console.error('❌ Error publicando cierre en MQTT:', mqttError);
    }
    
    res.json({
      status: "success",
      message: auction.winner_group_id ? "Subasta cerrada con ganador" : "Subasta cancelada sin ofertas",
      auction: {
        id: auction_id,
        winner_group_id: auction.winner_group_id,
        winning_bid: auction.winning_bid
      }
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error cerrando subasta:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    client.release();
  }
};

// Procesar subastas externas (desde MQTT)
export const processExternalAuction = async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const auctionData = req.body;
    
    console.log("Procesando subasta externa:", auctionData);
    
    // Registrar la subasta externa para seguimiento
    await logEvent('EXTERNAL_AUCTION', auctionData, pool);
    
    res.json({ status: "success", message: "Subasta externa procesada" });
  } catch (error) {
    console.error("Error procesando subasta externa:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

async function logEvent(type, details, pool) {
  try {
    if (!details.timestamp) {
      details.timestamp = new Date().toISOString();
    }
    
    const query = `
      INSERT INTO events (type, details)
      VALUES ($1, $2)
      RETURNING id
    `;
    
    const result = await pool.query(query, [type, JSON.stringify(details)]);
    console.log(`Evento ${type} registrado con ID ${result.rows[0].id}`);
    return result.rows[0].id;
  } catch (error) {
    console.error("Error registrando evento:", error);
    return null;
  }
}

export default {
  createAuction,
  getActiveAuctions,
  placeBid,
  closeAuction,
  processExternalAuction
}; 