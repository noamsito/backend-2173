import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

const GROUP_ID = parseInt(process.env.GROUP_ID || "1");

// Middleware para verificar que el usuario es administrador
export const requireAdmin = async (req, res, next) => {
  try {
    const pool = req.app.locals.pool;
    
    // Verificar si el usuario tiene rol de admin
    const userQuery = `SELECT is_admin FROM users WHERE id = $1`;
    const result = await pool.query(userQuery, [req.userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    
    if (!result.rows[0].is_admin) {
      return res.status(403).json({ 
        error: "Acceso denegado. Se requieren privilegios de administrador." 
      });
    }
    
    req.isAdmin = true;
    next();
  } catch (error) {
    console.error("Error verificando rol de admin:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// Comprar acciones para el grupo usando stocks/requests (ADMIN ONLY)
export const buyStocksForGroup = async (req, res) => {
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  
  try {
    const { symbol, quantity } = req.body;
    
    if (!symbol || !quantity || quantity <= 0) {
      return res.status(400).json({ 
        error: "Faltan parámetros requeridos o cantidad inválida",
        required: ["symbol", "quantity (> 0)"]
      });
    }
    
    await client.query('BEGIN');
    
    // Verificar que la acción existe en el mercado
    const stockQuery = `
      SELECT * FROM stocks 
      WHERE symbol = $1 
      ORDER BY timestamp DESC 
      LIMIT 1
    `;
    const stockResult = await client.query(stockQuery, [symbol]);
    
    if (stockResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Acción no encontrada en el mercado" });
    }
    
    const stock = stockResult.rows[0];
    const totalCost = stock.price * quantity;
    
    // Verificar saldo de la billetera del grupo (usando usuario admin)
    const walletQuery = `SELECT balance FROM wallet WHERE user_id = $1`;
    const walletResult = await client.query(walletQuery, [req.userId]);
    
    if (walletResult.rows.length === 0 || walletResult.rows[0].balance < totalCost) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: "Saldo insuficiente para la compra grupal",
        required: totalCost,
        available: walletResult.rows[0]?.balance || 0
      });
    }
    
    // Crear solicitud de compra grupal
    const requestId = uuidv4();
    
    const insertQuery = `
      INSERT INTO group_purchase_requests (
        request_id, admin_user_id, group_id, symbol, quantity, 
        price, total_cost, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
      RETURNING *
    `;
    
    const purchaseResult = await client.query(insertQuery, [
      requestId,
      req.userId,
      GROUP_ID,
      symbol,
      quantity,
      stock.price,
      totalCost
    ]);
    
    // Reservar dinero para la compra
    await client.query(
      `UPDATE wallet SET balance = balance - $1 WHERE user_id = $2`,
      [totalCost, req.userId]
    );
    
    await client.query('COMMIT');
    
    // Enviar solicitud por canal stocks/requests siguiendo el formato del enunciado
    const requestMessage = {
      "stock_origin_": GROUP_ID, // Cambiar stock_origin_ por número de grupo
      "request_id": requestId,
      "symbol": symbol,
      "quantity": quantity,
      "price": stock.price,
      "group_id": GROUP_ID,
      "timestamp": new Date().toISOString(),
      "operation": "purchase_request"
    };
    
    try {
      await axios.post('http://mqtt-client:3000/publish', {
        topic: 'stocks/requests',
        message: requestMessage
      });
      console.log(`📨 Solicitud de compra grupal enviada: ${requestId}`);
    } catch (mqttError) {
      console.error('❌ Error enviando solicitud por MQTT:', mqttError);
    }
    
    res.status(201).json({
      status: "success",
      message: "Solicitud de compra grupal enviada exitosamente",
      request: purchaseResult.rows[0],
      message_sent: requestMessage
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error en compra grupal:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    client.release();
  }
};

// Ver stocks disponibles del grupo (que no se han vendido)
export const getGroupStocks = async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    
    const query = `
      SELECT 
        symbol,
        SUM(quantity) as total_quantity,
        AVG(price) as average_price,
        COUNT(*) as transactions,
        MAX(timestamp) as last_update
      FROM stocks s
      WHERE s.quantity > 0
      GROUP BY symbol
      ORDER BY symbol
    `;
    
    const result = await pool.query(query);
    
    res.json({
      status: "success",
      group_id: GROUP_ID,
      stocks: result.rows
    });
    
  } catch (error) {
    console.error("Error obteniendo stocks del grupo:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};



// Establecer usuario como administrador (solo para configuración inicial)
export const promoteToAdmin = async (req, res) => {
  try {
    const { userId } = req.body;
    const pool = req.app.locals.pool;
    
    if (!userId) {
      return res.status(400).json({ error: "userId requerido" });
    }
    
    const updateQuery = `
      UPDATE users 
      SET is_admin = true, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, email, name, is_admin
    `;
    
    const result = await pool.query(updateQuery, [userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }
    
    res.json({
      status: "success",
      message: "Usuario promovido a administrador",
      user: result.rows[0]
    });
    
  } catch (error) {
    console.error("Error promoviendo usuario:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

export default {
  requireAdmin,
  buyStocksForGroup,
  getGroupStocks,
  promoteToAdmin
}; 