import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

// No crear pool aquí, usar el del servidor principal
const GROUP_ID = process.env.GROUP_ID || "1";

// RF05: Proponer un intercambio
export const proposeExchange = async (req, res) => {
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  
  try {
    const { 
      target_group_id, 
      offered_symbol, 
      offered_quantity, 
      requested_symbol, 
      requested_quantity 
    } = req.body;
    
    // Validar parámetros
    if (!target_group_id || !offered_symbol || !offered_quantity || !requested_symbol || !requested_quantity) {
      return res.status(400).json({ 
        error: "Faltan parámetros requeridos",
        required: ["target_group_id", "offered_symbol", "offered_quantity", "requested_symbol", "requested_quantity"]
      });
    }
    
    if (offered_quantity <= 0 || requested_quantity <= 0) {
      return res.status(400).json({ 
        error: "Las cantidades deben ser positivas" 
      });
    }
    
    if (String(target_group_id) === String(GROUP_ID)) {
      return res.status(400).json({ 
        error: "No puedes proponer un intercambio contigo mismo" 
      });
    }
    
    await client.query('BEGIN');
    
    // Verificar que tengamos suficientes acciones para ofrecer
    const stockQuery = `
      SELECT SUM(quantity) as total_quantity 
      FROM stocks 
      WHERE symbol = $1 AND quantity > 0
    `;
    const stockResult = await client.query(stockQuery, [offered_symbol]);
    
    if (!stockResult.rows[0] || stockResult.rows[0].total_quantity < offered_quantity) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: "No hay suficientes acciones disponibles para ofrecer" 
      });
    }
    
    // Crear la propuesta de intercambio
    const exchangeId = uuidv4();
    
    const insertQuery = `
      INSERT INTO exchanges (
        id, origin_group_id, target_group_id, 
        offered_symbol, offered_quantity,
        requested_symbol, requested_quantity,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
      RETURNING *
    `;
    
    const exchangeResult = await client.query(insertQuery, [
      exchangeId,
      parseInt(GROUP_ID),
      target_group_id,
      offered_symbol,
      offered_quantity,
      requested_symbol,
      requested_quantity
    ]);
    
    // Reservar las acciones ofrecidas
    await client.query(`
      UPDATE stocks 
      SET quantity = quantity - $1 
      WHERE symbol = $2 
      AND id = (SELECT id FROM stocks WHERE symbol = $2 AND quantity > 0 ORDER BY timestamp DESC LIMIT 1)
    `, [offered_quantity, offered_symbol]);
    
    await client.query('COMMIT');
    
    const exchange = exchangeResult.rows[0];
    
    // RNF05: Publicar la propuesta en el canal stocks/auctions
    const exchangeMessage = {
      type: 'EXCHANGE_PROPOSAL',
      exchange_id: exchangeId,
      origin_group_id: parseInt(GROUP_ID),
      target_group_id: target_group_id,
      offered_symbol: offered_symbol,
      offered_quantity: offered_quantity,
      requested_symbol: requested_symbol,
      requested_quantity: requested_quantity,
      timestamp: new Date().toISOString()
    };
    
    try {
      await axios.post('http://mqtt-client:3000/publish', {
        topic: 'stocks/auctions',
        message: exchangeMessage
      });
      console.log(`🤝 Propuesta de intercambio publicada: ${exchangeId}`);
    } catch (mqttError) {
      console.error('❌ Error publicando propuesta en MQTT:', mqttError);
    }
    
    // Registrar evento
    await logEvent('EXCHANGE_PROPOSED', {
      exchange_id: exchangeId,
      target_group_id: target_group_id,
      offered: `${offered_quantity} ${offered_symbol}`,
      requested: `${requested_quantity} ${requested_symbol}`
    }, pool);
    
    res.status(201).json({
      status: "success",
      message: "Propuesta de intercambio creada exitosamente",
      exchange: exchange
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error creando propuesta de intercambio:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    client.release();
  }
};

// RF05: Responder a una propuesta de intercambio (aceptar/rechazar)
export const respondToExchange = async (req, res) => {
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  
  try {
    const { exchange_id } = req.params;
    const { action, reason } = req.body; // action: 'accept' o 'reject'
    
    if (!action || !['accept', 'reject'].includes(action)) {
      return res.status(400).json({ 
        error: "Acción inválida. Debe ser 'accept' o 'reject'" 
      });
    }
    
    await client.query('BEGIN');
    
    // Obtener la propuesta de intercambio
    const exchangeQuery = `
      SELECT * FROM exchanges 
      WHERE id = $1 AND status = 'PENDING'
    `;
    const exchangeResult = await client.query(exchangeQuery, [exchange_id]);
    
    if (exchangeResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Propuesta no encontrada o ya procesada" });
    }
    
    const exchange = exchangeResult.rows[0];
    
    // Verificar que la propuesta sea para nuestro grupo
    if (String(exchange.target_group_id) !== String(GROUP_ID)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: "Esta propuesta no es para tu grupo" });
    }
    
    if (action === 'accept') {
      // Verificar que tengamos las acciones solicitadas
      const stockQuery = `
        SELECT SUM(quantity) as total_quantity 
        FROM stocks 
        WHERE symbol = $1 AND quantity > 0
      `;
      const stockResult = await client.query(stockQuery, [exchange.requested_symbol]);
      
      if (!stockResult.rows[0] || stockResult.rows[0].total_quantity < exchange.requested_quantity) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          error: "No tienes suficientes acciones para completar el intercambio" 
        });
      }
      
      // Actualizar estado a ACCEPTED
      await client.query(`
        UPDATE exchanges 
        SET status = 'ACCEPTED', 
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [exchange_id]);
      
      // Transferir las acciones (se manejará por MQTT)
      // Por ahora, solo reservamos las acciones solicitadas
      await client.query(`
        UPDATE stocks 
        SET quantity = quantity - $1 
        WHERE symbol = $2
        AND id = (SELECT id FROM stocks WHERE symbol = $2 AND quantity > 0 ORDER BY timestamp DESC LIMIT 1)
      `, [exchange.requested_quantity, exchange.requested_symbol]);
      
    } else {
      // Rechazar la propuesta
      await client.query(`
        UPDATE exchanges 
        SET status = 'REJECTED',
            reason = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [exchange_id, reason || 'Propuesta rechazada por el grupo']);
    }
    
    await client.query('COMMIT');
    
    // RNF05: Publicar la respuesta en el canal stocks/auctions
    const responseMessage = {
      type: 'EXCHANGE_RESPONSE',
      exchange_id: exchange_id,
      origin_group_id: exchange.origin_group_id,
      responder_group_id: parseInt(GROUP_ID),
      status: action === 'accept' ? 'ACCEPTED' : 'REJECTED',
      reason: reason,
      timestamp: new Date().toISOString()
    };
    
    try {
      await axios.post('http://mqtt-client:3000/publish', {
        topic: 'stocks/auctions',
        message: responseMessage
      });
      console.log(`📨 Respuesta de intercambio publicada: ${exchange_id} - ${action}`);
    } catch (mqttError) {
      console.error('❌ Error publicando respuesta en MQTT:', mqttError);
    }
    
    // Registrar evento
    await logEvent('EXCHANGE_RESPONSE', {
      exchange_id: exchange_id,
      action: action,
      reason: reason
    }, pool);
    
    res.json({
      status: "success",
      message: `Intercambio ${action === 'accept' ? 'aceptado' : 'rechazado'} exitosamente`,
      exchange_id: exchange_id
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error respondiendo a intercambio:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    client.release();
  }
};

// Obtener intercambios pendientes para nuestro grupo
export const getPendingExchanges = async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const query = `
      SELECT * FROM exchanges 
      WHERE target_group_id = $1 AND status = 'PENDING'
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query, [parseInt(GROUP_ID)]);
    
    res.json({
      status: "success",
      exchanges: result.rows
    });
    
  } catch (error) {
    console.error("Error obteniendo intercambios pendientes:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// Obtener historial de intercambios
export const getExchangeHistory = async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const query = `
      SELECT * FROM exchanges 
      WHERE origin_group_id = $1 OR target_group_id = $1
      ORDER BY created_at DESC
    `;
    
    const result = await pool.query(query, [parseInt(GROUP_ID)]);
    
    res.json({
      status: "success",
      exchanges: result.rows
    });
    
  } catch (error) {
    console.error("Error obteniendo historial de intercambios:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// RNF04: Procesar propuestas de intercambio externas recibidas por MQTT
export const processExternalProposal = async (req, res) => {
  const pool = req.app.locals.pool;
  try {
    const proposalData = req.body;
    
    // Si la propuesta es para nuestro grupo, la guardamos
    if (String(proposalData.target_group_id) === String(GROUP_ID)) {
      const client = await pool.connect();
      
      try {
        await client.query('BEGIN');
        
        // Insertar la propuesta externa
        const insertQuery = `
          INSERT INTO exchanges (
            id, origin_group_id, target_group_id, 
            offered_symbol, offered_quantity,
            requested_symbol, requested_quantity,
            status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
          ON CONFLICT (id) DO NOTHING
        `;
        
        await client.query(insertQuery, [
          proposalData.exchange_id,
          proposalData.origin_group_id,
          proposalData.target_group_id,
          proposalData.offered_symbol,
          proposalData.offered_quantity,
          proposalData.requested_symbol,
          proposalData.requested_quantity
        ]);
        
        await client.query('COMMIT');
        
        // Registrar evento
        await logEvent('EXTERNAL_EXCHANGE_RECEIVED', proposalData, pool);
        
        console.log(`📥 Propuesta de intercambio recibida del grupo ${proposalData.origin_group_id}`);
        
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }
    
    res.json({ status: "success", message: "Propuesta externa procesada" });
    
  } catch (error) {
    console.error("Error procesando propuesta externa:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// RNF04: Procesar respuestas de intercambio externas
export const processExternalResponse = async (req, res) => {
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  
  try {
    const responseData = req.body;
    
    // Si la respuesta es para una propuesta nuestra
    if (String(responseData.origin_group_id) === String(GROUP_ID)) {
      await client.query('BEGIN');
      
      // Actualizar el estado de nuestra propuesta
      const updateQuery = `
        UPDATE exchanges 
        SET status = $2,
            reason = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND origin_group_id = $4
      `;
      
      await client.query(updateQuery, [
        responseData.exchange_id,
        responseData.status,
        responseData.reason,
        parseInt(GROUP_ID)
      ]);
      
      // Si fue rechazada, devolver las acciones reservadas
      if (responseData.status === 'REJECTED') {
        const exchangeQuery = `
          SELECT * FROM exchanges WHERE id = $1
        `;
        const exchangeResult = await client.query(exchangeQuery, [responseData.exchange_id]);
        
        if (exchangeResult.rows.length > 0) {
          const exchange = exchangeResult.rows[0];
          
          // Devolver las acciones al inventario
          await client.query(`
            UPDATE stocks 
            SET quantity = quantity + $1 
            WHERE symbol = $2
            AND id = (SELECT id FROM stocks WHERE symbol = $2 ORDER BY timestamp DESC LIMIT 1)
          `, [exchange.offered_quantity, exchange.offered_symbol]);
        }
      }
      
      await client.query('COMMIT');
      
      // Registrar evento
      await logEvent('EXCHANGE_RESPONSE_RECEIVED', responseData, pool);
      
      console.log(`📨 Respuesta de intercambio recibida: ${responseData.status}`);
    }
    
    res.json({ status: "success", message: "Respuesta externa procesada" });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error procesando respuesta externa:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    client.release();
  }
};

// Función auxiliar para registrar eventos
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
  proposeExchange,
  respondToExchange,
  getPendingExchanges,
  getExchangeHistory,
  processExternalProposal,
  processExternalResponse
}; 