import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import { auth } from 'express-oauth2-jwt-bearer';
import { v4 as uuidv4 } from 'uuid';
import './mqtt-client/mqttConnect.js';  // Importamos el cliente MQTT para que se ejecute
import { publishPurchaseRequest } from './mqtt-client/mqttConnect.js';
import { createSyncUserMiddleware } from './auth0-integration.js';
const Pool = pg.Pool;

const app = express();
const port = 3000;

dotenv.config();
// Crear middleware de sincronización de usuarios
const syncUser = createSyncUserMiddleware(pool);
const GROUP_ID = process.env.GROUP_ID || "your-group-id";

// Configurar middleware de autenticación Auth0
const checkJwt = auth({
    audience: 'https://stockmarket-api/',
    issuerBaseURL: 'https://dev-ouxdigl1l6bn6n3r.us.auth0.com/',
    tokenSigningAlg: 'RS256'
});

// Configuración de la base de datos
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
});

app.use(cors({
    origin: ['http://localhost:80', 'http://localhost', 'http://localhost:5173', process.env.FRONTEND_URL].filter(Boolean),
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Añadir un middleware para depuración
app.use((req, res, next) => {
    if (req.headers.authorization) {
        console.log("Authorization header presente");
        if (req.auth) {
            console.log("req.auth disponible:", Object.keys(req.auth));
        } else {
            console.log("req.auth no disponible");
        }
    }
    next();
});

const client = await pool.connect();

try {
    if (client) {
        console.log("Conexión exitosa a la base de datos.");
    } else {
        throw new Error("Error al conectar a la base de datos.");
    }
} catch (error) {
    console.error("Error conectando a la base de datos:", error);
}

// Función helper para registrar eventos
async function logEvent(type, details) {
    try {
        const query = `
            INSERT INTO events (type, details)
            VALUES ($1, $2)
            RETURNING id
        `;
        
        await client.query(query, [type, JSON.stringify(details)]);
        console.log(`Evento ${type} registrado`);
    } catch (error) {
        console.error("Error registrando evento:", error);
    }
}
    
app.post('/stocks', async (req, res) => {
    const { topic, message } = req.body;

    if (!topic || !message) {
        return res.status(400).json({ error: "Datos incompletos" });
    }

    try {
        const stockData = JSON.parse(message);
        const { symbol, price, longName, quantity, timestamp, kind } = stockData;

        // Verificar el tipo de actualización
        if (kind === 'IPO') {
            // Es una nueva stock, insertamos
            const insertQuery = `
                INSERT INTO stocks (symbol, price, long_name, quantity, timestamp)
                VALUES ($1, $2, $3, $4, $5)
                RETURNING *;
            `;

            const values = [symbol, price, longName, quantity, timestamp];
            const result = await client.query(insertQuery, values);

            console.log("New stock (IPO) saved to database:", result.rows[0]);
            res.json({ status: "success", data: result.rows[0] });
        } else if (kind === 'EMIT') {
            // Verificar si la stock ya existe
            const checkQuery = `SELECT * FROM stocks WHERE symbol = $1 ORDER BY timestamp DESC LIMIT 1;`;
            const checkResult = await client.query(checkQuery, [symbol]);
        
            if (checkResult.rows.length > 0) {
                // La stock existe, insertamos una nueva entrada con los datos actualizados
                const existingStock = checkResult.rows[0];
                const insertQuery = `
                    INSERT INTO stocks (symbol, price, long_name, quantity, timestamp)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING *;
                `;
        
                // Mantener el long_name existente si no viene en el mensaje
                const existingLongName = existingStock.long_name;
                
                // Para EMIT, sumamos la nueva cantidad a la cantidad existente
                const updatedQuantity = existingStock.quantity + quantity;
                
                const values = [
                    symbol,
                    price,                // Actualizamos al nuevo precio
                    longName || existingLongName,
                    updatedQuantity,      // Sumamos la cantidad nueva a la existente
                    timestamp
                ];
        
                const result = await client.query(insertQuery, values);
        
                console.log("Stock updated (EMIT):", result.rows[0]);
                res.json({ status: "success", data: result.rows[0] });
            } else {
                // La stock no existe, pero la trataremos como una nueva (IPO)
                console.log(`Symbol ${symbol} not found for EMIT, treating as new stock (IPO)`);
                
                const insertQuery = `
                    INSERT INTO stocks (symbol, price, long_name, quantity, timestamp)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING *;
                `;
        
                const values = [symbol, price, longName, quantity, timestamp];
                const result = await client.query(insertQuery, values);
        
                console.log("New stock from EMIT saved to database:", result.rows[0]);
                res.json({ status: "success", data: result.rows[0] });
            }
        } else if (kind === 'EMIT') {
            // Verificar si la stock ya existe
            const checkQuery = `SELECT * FROM stocks WHERE symbol = $1 ORDER BY timestamp DESC LIMIT 1;`;
            const checkResult = await client.query(checkQuery, [symbol]);
        
            if (checkResult.rows.length > 0) {
                // La stock existe, ACTUALIZAMOS el registro existente en vez de crear uno nuevo
                const existingStock = checkResult.rows[0];
                
                // Para EMIT, sumamos la nueva cantidad a la cantidad existente
                const updatedQuantity = existingStock.quantity + quantity;
                
                const updateQuery = `
                    UPDATE stocks 
                    SET price = $2, 
                        long_name = $3, 
                        quantity = $4, 
                        timestamp = $5
                    WHERE id = $1
                    RETURNING *;
                `;
                
                const values = [
                    existingStock.id,  // ID del registro existente
                    price,             // Actualizamos al nuevo precio
                    longName || existingStock.long_name, // Usamos el nombre nuevo o el existente
                    updatedQuantity,   // Sumamos la cantidad nueva a la existente
                    timestamp
                ];
        
                const result = await client.query(updateQuery, values);
        
                console.log("Stock updated (EMIT):", result.rows[0]);
                res.json({ status: "success", data: result.rows[0] });
            } else {
                // La stock no existe, pero la trataremos como una nueva (IPO)
                console.log(`Symbol ${symbol} not found for EMIT, treating as new stock (IPO)`);
                
                const insertQuery = `
                    INSERT INTO stocks (symbol, price, long_name, quantity, timestamp)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING *;
                `;
        
                const values = [symbol, price, longName, quantity, timestamp];
                const result = await client.query(insertQuery, values);
        
                console.log("New stock from EMIT saved to database:", result.rows[0]);
                res.json({ status: "success", data: result.rows[0] });
            }
        } else if (kind === 'UPDATE') {
            // Este es un UPDATE, solo actualizamos el precio si la stock existe
            const checkQuery = `SELECT * FROM stocks WHERE symbol = $1 ORDER BY timestamp DESC LIMIT 1;`;
            const checkResult = await client.query(checkQuery, [symbol]);

            if (checkResult.rows.length > 0) {
                // La stock existe, insertamos una nueva entrada con el precio actualizado
                // pero manteniendo los valores existentes para los otros campos
                const existingStock = checkResult.rows[0];
                
                const insertQuery = `
                    INSERT INTO stocks (symbol, price, long_name, quantity, timestamp)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING *;
                `;

                const values = [
                    symbol,
                    price,
                    existingStock.long_name,
                    existingStock.quantity,
                    timestamp
                ];

                const result = await client.query(insertQuery, values);

                console.log("Stock price updated (UPDATE):", result.rows[0]);
                res.json({ status: "success", data: result.rows[0] });
            } else {
                // La stock no existe, ignoramos este UPDATE
                console.log(`Symbol ${symbol} not found for UPDATE, ignoring`);
                res.status(404).json({ 
                    status: "ignored", 
                    message: `Symbol ${symbol} not found for UPDATE operation`
                });
            }
        } else {
            // Tipo de actualización desconocido
            console.error("Unknown update kind:", kind);
            res.status(400).json({ error: `Unknown update kind: ${kind}` });
        }
    } catch (error) {
        console.error("Error processing stock data:", error);
        res.status(500).json({ error: "Error processing stock data" });
    }
});
app.get('/stocks', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const count = parseInt(req.query.count) || 25;
    const offset = (page - 1) * count;

    try {
        const query = `
            SELECT DISTINCT ON (symbol) *
            FROM stocks
            ORDER BY symbol, timestamp DESC
            LIMIT $1 OFFSET $2;
        `;
        const result = await client.query(query, [count, offset]);
        res.json({ status: "success", data: result.rows });
    } catch (error) {
        console.error("Error fetching stocks:", error);
        res.status(500).json({ error: "Error fetching stocks" });
    }
});

// Endpoint de detalle de stock existente
app.get('/stocks/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const { price, quantity, date } = req.query;

    try {
        let query = `
            SELECT * FROM stocks
            WHERE symbol = $1
        `;
        const values = [symbol];
        let index = 2;

        if (price) {
            query += ` AND price <= $${index}`;
            values.push(parseFloat(price));
            index++;
        }

        if (quantity) {
            query += ` AND quantity <= $${index}`;
            values.push(parseInt(quantity));
            index++;
        }

        if (date) {
            query += ` AND timestamp::date = $${index}`;
            values.push(date);
            index++;
        }

        query += ` ORDER BY timestamp DESC;`;

        const result = await client.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                error: price || quantity || date 
                    ? "No stocks found with the filters" 
                    : "Stock not found" 
            });
        }

        res.json({ status: "success", data: result.rows });
    } catch (error) {
        console.error("Error fetching stock details:", error);
        res.status(500).json({ error: "Error fetching stock details" });
    }
});

// Endpoints de perfil y registro existentes
app.get('/user/profile', checkJwt, syncUser, async (req, res) => {
    try {
        // El usuario ya está sincronizado por el middleware
        const userQuery = `
            SELECT u.*, w.balance 
            FROM users u 
            LEFT JOIN wallet w ON u.id = w.user_id 
            WHERE u.id = $1
        `;
        const userResult = await client.query(userQuery, [req.userId]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }
        
        const user = userResult.rows[0];
        
        res.json({ status: "success", data: user });
    } catch (error) {
        console.error("Error obteniendo perfil de usuario:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Endpoint de registro (se mantiene para compatibilidad, pero no es necesario usarlo)
app.post('/users/register', checkJwt, syncUser, async (req, res) => {
    try {
        // El usuario ya ha sido sincronizado en este punto
        res.status(200).json({ 
            status: "success", 
            message: "Usuario registrado correctamente", 
            data: { id: req.userId }
        });
    } catch (error) {
        console.error("Error registrando usuario:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// NUEVOS ENDPOINTS PARA WALLET ==============================================

// Endpoint de depósito en wallet corregido
app.post('/wallet/deposit', checkJwt, syncUser, async (req, res) => {
    try {
        const { amount } = req.body;
        
        if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            return res.status(400).json({ error: "Monto de depósito inválido" });
        }
        
        const amountValue = parseFloat(amount);
        
        // Actualizar wallet
        const updateQuery = `
            UPDATE wallet
            SET balance = balance + $2, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
            RETURNING balance
        `;
        
        const updateResult = await client.query(updateQuery, [req.userId, amountValue]);
        
        const newBalance = updateResult.rows[0].balance;
        
        // Registrar evento
        await logEvent('WALLET_DEPOSIT', { 
            user_id: req.userId, 
            amount: amountValue, 
            new_balance: newBalance 
        });
        
        res.json({ balance: newBalance });
    } catch (error) {
        console.error("Error al depositar en billetera:", error);
        res.status(500).json({ 
            error: "Error interno del servidor al depositar", 
            details: error.message
        });
    }
});

// Obtener saldo de la billetera (versión mejorada)
app.get('/wallet/balance', checkJwt, syncUser, async (req, res) => {
    try {
        // Obtener saldo de la billetera
        const walletQuery = `
            SELECT balance FROM wallet 
            WHERE user_id = $1
        `;
        
        const walletResult = await client.query(walletQuery, [req.userId]);
        
        const balance = walletResult.rows[0]?.balance || 0;
        
        res.json({ balance });
    } catch (error) {
        console.error("Error obteniendo saldo de billetera:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// ENDPOINTS DE COMPRA DE ACCIONES ===========================================

// Comprar acciones (versión mejorada)
app.post('/stocks/buy', checkJwt, syncUser, async (req, res) => {
    try {
        const { symbol, quantity } = req.body;
        
        if (!symbol || !quantity || quantity <= 0) {
            return res.status(400).json({ error: "Solicitud de compra inválida" });
        }
        
        // Obtener precio actual y disponibilidad de la acción
        const stockQuery = `
            SELECT * FROM stocks 
            WHERE symbol = $1 
            ORDER BY timestamp DESC 
            LIMIT 1
        `;
        
        const stockResult = await client.query(stockQuery, [symbol]);
        
        if (stockResult.rows.length === 0) {
            return res.status(404).json({ error: "Acción no encontrada" });
        }
        
        const stock = stockResult.rows[0];
        
        if (stock.quantity < quantity) {
            return res.status(400).json({ error: "No hay suficientes acciones disponibles" });
        }
        
        const totalCost = stock.price * quantity;
        
        // Verificar saldo en billetera
        const walletQuery = `
            SELECT balance FROM wallet 
            WHERE user_id = $1
        `;
        
        const walletResult = await client.query(walletQuery, [req.userId]);
        
        if (walletResult.rows.length === 0 || walletResult.rows[0].balance < totalCost) {
            return res.status(400).json({ error: "Fondos insuficientes" });
        }
        
        // Generar UUID para la solicitud
        const requestId = uuidv4();
        
        // Crear solicitud de compra en la base de datos
        const purchaseQuery = `
            INSERT INTO purchase_requests 
            (request_id, user_id, symbol, quantity, price, status) 
            VALUES ($1, $2, $3, $4, $5, 'PENDING')
            RETURNING id
        `;
        
        await client.query(purchaseQuery, [
            requestId, 
            req.userId,  // Usamos req.userId proporcionado por el middleware
            symbol, 
            quantity, 
            stock.price
        ]);
        
        // Reservar temporalmente la cantidad de acciones
        await client.query(`
            UPDATE stocks 
            SET quantity = quantity - $1 
            WHERE id = $2
        `, [quantity, stock.id]);
        
        // Publicar solicitud de compra al broker MQTT
        const requestData = {
            request_id: requestId,
            quantity: quantity,
            symbol: symbol
        };
        
        publishPurchaseRequest(requestData);
        
        // Registrar evento
        await logEvent('PURCHASE_REQUEST', {
            request_id: requestId,
            user_id: req.userId,
            symbol: symbol,
            quantity: quantity,
            price: stock.price,
            group_id: GROUP_ID
        });
        
        res.json({ 
            status: "success", 
            message: "Solicitud de compra enviada", 
            request_id: requestId 
        });
    } catch (error) {
        console.error("Error procesando compra:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Obtener compras del usuario (versión mejorada)
app.get('/purchases', checkJwt, syncUser, async (req, res) => {
    try {
        // Obtener compras del usuario
        const purchasesQuery = `
            SELECT pr.*, s.long_name 
            FROM purchase_requests pr
            JOIN stocks s ON pr.symbol = s.symbol AND s.timestamp = (
                SELECT MAX(timestamp) FROM stocks 
                WHERE symbol = pr.symbol
            )
            WHERE pr.user_id = $1
            ORDER BY pr.created_at DESC
        `;
        
        const purchasesResult = await client.query(purchasesQuery, [req.userId]);
        
        res.json({ data: purchasesResult.rows });
    } catch (error) {
        console.error("Error obteniendo compras:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// ENDPOINTS DE VALIDACIÓN Y PROCESAMIENTO DE COMPRAS =======================

// Validación de compra (para las respuestas del broker)
app.post('/purchase-validation', async (req, res) => {
    try {
        const validation = req.body;
        
        if (!validation.request_id) {
            return res.status(400).json({ error: "Datos de validación inválidos" });
        }
        
        // Actualizar estado de la solicitud de compra
        const updateQuery = `
            UPDATE purchase_requests 
            SET status = $1, 
                reason = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE request_id = $3
            RETURNING user_id, symbol, quantity, price
        `;
        
        const updateResult = await client.query(updateQuery, [
            validation.status,
            validation.reason || null,
            validation.request_id
        ]);
        
        if (updateResult.rows.length === 0) {
            return res.status(404).json({ error: "Solicitud de compra no encontrada" });
        }
        
        const purchase = updateResult.rows[0];
        const totalCost = purchase.price * purchase.quantity;
        
        // Registrar evento de validación
        await logEvent('PURCHASE_VALIDATION', {
            request_id: validation.request_id,
            status: validation.status,
            reason: validation.reason
        });
        
        // Si la compra fue aceptada, descontar de la billetera
        if (validation.status === 'ACCEPTED') {
            await client.query(`
                UPDATE wallet 
                SET balance = balance - $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $2
            `, [totalCost, purchase.user_id]);
        } 
        // Si la compra fue rechazada, devolver la cantidad reservada
        else if (validation.status === 'REJECTED' || validation.status === 'error') {
            // Obtener la entrada más reciente de la acción
            const stockQuery = `
                SELECT id FROM stocks 
                WHERE symbol = $1 
                ORDER BY timestamp DESC 
                LIMIT 1
            `;
            
            const stockResult = await client.query(stockQuery, [purchase.symbol]);
            
            if (stockResult.rows.length > 0) {
                await client.query(`
                    UPDATE stocks 
                    SET quantity = quantity + $1 
                    WHERE id = $2
                `, [purchase.quantity, stockResult.rows[0].id]);
            }
        }
        
        res.json({ status: "success" });
    } catch (error) {
        console.error("Error procesando validación de compra:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Procesar compra externa (de otros grupos)
app.post('/external-purchase', async (req, res) => {
    try {
        const purchase = req.body;
        
        if (!purchase.symbol || !purchase.quantity || !purchase.request_id) {
            return res.status(400).json({ error: "Datos de compra inválidos" });
        }
        
        // Obtener la entrada más reciente de la acción
        const stockQuery = `
            SELECT id FROM stocks 
            WHERE symbol = $1 
            ORDER BY timestamp DESC 
            LIMIT 1
        `;
        
        const stockResult = await client.query(stockQuery, [purchase.symbol]);
        
        if (stockResult.rows.length > 0) {
            // Actualizar nuestro inventario de acciones
            await client.query(`
                UPDATE stocks 
                SET quantity = quantity - $1 
                WHERE id = $2
            `, [purchase.quantity, stockResult.rows[0].id]);
        }
        
        // Registrar evento de compra externa
        await logEvent('EXTERNAL_PURCHASE', purchase);
        
        res.json({ status: "success" });
    } catch (error) {
        console.error("Error procesando compra externa:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// ENDPOINTS DE LOG DE EVENTOS ==============================================

// Registrar evento
app.post('/events', async (req, res) => {
    try {
        const { type, details } = req.body;
        
        if (!type || !details) {
            return res.status(400).json({ error: "Datos de evento inválidos" });
        }
        
        const query = `
            INSERT INTO events (type, details)
            VALUES ($1, $2)
            RETURNING id
        `;
        
        await client.query(query, [type, details]);
        
        res.json({ status: "success" });
    } catch (error) {
        console.error("Error registrando evento:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Obtener eventos
app.get('/events', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const count = parseInt(req.query.count) || 25;
        const type = req.query.type;
        
        const offset = (page - 1) * count;
        
        let query = `
            SELECT * FROM events
        `;
        
        const params = [];
        
        if (type && type !== 'ALL') {
            query += ` WHERE type = $1`;
            params.push(type);
        }
        
        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(count, offset);
        
        const result = await client.query(query, params);
        
        res.json({ data: result.rows });
    } catch (error) {
        console.error("Error obteniendo eventos:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.listen(port, () => {
    console.log(`Servidor ejecutándose en http://localhost:${port}`);
});