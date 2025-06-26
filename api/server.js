import express, { request } from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import purchaseRoutes from './src/routes/purchases.js';
import { auth } from 'express-oauth2-jwt-bearer';
import { v4 as uuidv4 } from 'uuid';
import { createSyncUserMiddleware } from './auth-integration.js';
import mqtt from 'mqtt';
import axios from 'axios';
import sequelize from './db/db.js';
import { TransbankService } from './src/services/webpayService.js';
import webpayRoutes from './src/routes/webpayRoutes.js';
import adminRoutes from './src/routes/adminRoutes.js';
import { corsOptions, customCorsMiddleware, webpayCorsmiddleware } from './cors-configuration.js';
import * as auctionController from './src/controllers/auctionController.js';
import * as exchangeController from './src/controllers/exchangeController.js';
import * as adminController from './src/controllers/adminController.js';
import { initializeDatabase } from './src/utils/initDatabase.js';

const Pool = pg.Pool;
const app = express();
const port = 3000;

// 🔧 CONFIGURACIÓN DE BYPASS DE AUTENTICACIÓN PARA PRUEBAS
const BYPASS_AUTH = process.env.BYPASS_AUTH === 'true' || process.env.NODE_ENV === 'development';

// Middleware de bypass que simula un usuario autenticado
const bypassAuthMiddleware = (req, res, next) => {
    if (BYPASS_AUTH) {
        console.log('🔧 BYPASS AUTH: Simulando usuario autenticado para pruebas');
        // Simular usuario autenticado con ID fijo para pruebas
        req.userId = 1;
        req.auth = {
            payload: {
                sub: 'test-user-id',
                email: 'test@ejemplo.com',
                name: 'Usuario de Prueba'
            }
        };
        next();
    } else {
        // Si no está en modo bypass, usar autenticación normal
        return res.status(401).json({ 
            error: "Autenticación requerida",
            message: "Para usar el modo de pruebas, configura BYPASS_AUTH=true"
        });
    }
};

// Función helper para decidir qué middleware usar
const conditionalAuth = (req, res, next) => {
    if (BYPASS_AUTH) {
        console.log('🔧 Usando bypass de autenticación');
        return bypassAuthMiddleware(req, res, next);
    } else {
        console.log('🔐 Usando autenticación JWT normal');
        return checkJwt(req, res, next);
    }
};

const conditionalSyncUser = (req, res, next) => {
    if (BYPASS_AUTH) {
        console.log('🔧 Simulando sincronización de usuario');
        // En modo bypass, ya tenemos req.userId = 1
        return next();
    } else {
        return syncUser(req, res, next);
    }
};

// ✅ APLICAR CORS DESPUÉS DE CREAR LA INSTANCIA DE EXPRESS
app.use(cors(corsOptions));
app.use(customCorsMiddleware);

// Para rutas específicas de WebPay
app.use('/webpay', webpayCorsmiddleware);

// Middleware de debugging
app.use('/api/purchases', (req, res, next) => {
    console.log(`🔍 ${req.method} ${req.path} - Origin: ${req.get('Origin')}`);
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/purchases', purchaseRoutes);
app.use('/admin', conditionalAuth, conditionalSyncUser, adminRoutes);


dotenv.config();

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://antonioescobar.lat';

const WORKERS_API_URL = process.env.WORKERS_API_URL || 'http://localhost:3000';

// Función para triggerar estimación después de compra exitosa
async function triggerEstimationCalculation(userId, purchaseData) {
    try {
        console.log(`Triggerando estimación para usuario ${userId}, acción: ${purchaseData.symbol}`);
        
        const response = await fetch(`${WORKERS_API_URL}/job`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                userId,
                stocksPurchased: [
                    {
                        symbol: purchaseData.symbol,
                        quantity: purchaseData.quantity,
                        purchasePrice: purchaseData.price
                    }
                ]
            })
        });
        
        const result = await response.json();
        
        if (response.ok) {
            console.log(`Estimación triggereada para usuario ${userId}, jobId: ${result.jobId}`);
            return result.jobId;
        } else {
            console.error('Error del JobMaster:', result);
            return null;
        }
    } catch (error) {
        console.error('Error triggering estimation:', error.message);
        return null;
    }
}

// Configuración de la base de datos
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
});

// Hacer que el pool esté disponible para los controladores
app.locals.pool = pool;

// Crear middleware de sincronización de usuarios
const syncUser = createSyncUserMiddleware(pool);
const GROUP_ID = process.env.GROUP_ID || "1";

// CORREGIR: Configurar middleware de autenticación Auth0 con las variables correctas
const checkJwt = auth({
    audience: process.env.AUTH0_AUDIENCE || 'https://stockmarket-api/',
    issuerBaseURL: `https://${process.env.AUTH0_DOMAIN || 'dev-ouxdigl1l6bn6n3r.us.auth0.com'}`,
    tokenSigningAlg: 'RS256'
});

// Middleware para verificar si el usuario es admin
const checkAdmin = async (req, res, next) => {
    try {
        // Verificar si el usuario tiene rol de admin
        const userQuery = `
            SELECT role FROM users WHERE id = $1
        `;
        const result = await pool.query(userQuery, [req.userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }
        
        req.isAdmin = result.rows[0].role === 'admin';
        next();
    } catch (error) {
        console.error("Error verificando rol de admin:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
};

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
        // Añadir timestamp al evento si no lo tiene
        if (!details.timestamp) {
            details.timestamp = new Date().toISOString();
        }
        
        // Verificar si ya existe un evento similar para eventos que pueden duplicarse
        if (['IPO', 'EMIT'].includes(type)) {
            // Verificar eventos duplicados por símbolo, precio, cantidad y cercanía en el timestamp
            const checkQuery = `
                SELECT id FROM events 
                WHERE type = $1 
                AND details->>'symbol' = $2 
                AND details->>'price' = $3 
                AND details->>'quantity' = $4
                AND created_at > NOW() - INTERVAL '5 minutes'
            `;
            
            const checkResult = await client.query(checkQuery, [
                type, 
                details.symbol, 
                details.price.toString(), 
                details.quantity.toString()
            ]);
            
            // Si ya existe un evento similar, no registramos uno nuevo
            if (checkResult.rows.length > 0) {
                console.log(`Evento ${type} para ${details.symbol} ya existe, no registrando duplicado`);
                return checkResult.rows[0].id;
            }
        }
        
        // Añadir descripción humanizada según el tipo de evento
        let eventText = "";
        
        // Solo generamos descripciones para los 4 tipos de eventos que modifican el universo de acciones
        switch(type) {
            case 'IPO':
                eventText = `Se realizó una IPO de ${details.quantity} acciones de ${details.symbol} (${details.long_name || ''}) a un precio de $${details.price} por acción.`;
                break;
                
            case 'EMIT':
                eventText = `Se realizó un EMIT de ${details.quantity} acciones adicionales de ${details.symbol} (${details.long_name || ''}) a un precio de $${details.price} por acción.`;
                break;
                
            case 'PURCHASE_VALIDATION':
                // Solo procesamos las compras aceptadas
                if (details.status === 'ACCEPTED') {
                    // Tratamos de obtener todos los datos relevantes
                    const symbol = details.symbol;
                    const quantity = details.quantity;
                    const price = details.price;
                    const totalCost = quantity && price ? (quantity * price).toFixed(2) : 'desconocido';
                    
                    eventText = `Compraste ${quantity || ''} acciones de ${symbol || ''} por un monto total de $${totalCost}.`;
                }
                break;
                
            case 'EXTERNAL_PURCHASE':
                eventText = `El grupo ${details.group_id} compró ${details.quantity} acciones de ${details.symbol}.`;
                break;
        }
        
        // Solo registramos el evento si es uno de los 4 tipos que modifican el universo de acciones
        // y si logramos generar un texto descriptivo
        if (eventText && ['IPO', 'EMIT', 'PURCHASE_VALIDATION', 'EXTERNAL_PURCHASE'].includes(type)) {
            // Añadir el texto al evento
            details.event_text = eventText;
            
            const query = `
                INSERT INTO events (type, details)
                VALUES ($1, $2)
                RETURNING id
            `;
            
            const result = await client.query(query, [type, JSON.stringify(details)]);
            console.log(`Evento ${type} registrado con ID ${result.rows[0].id}`);
            return result.rows[0].id;
        }
        
        // Para los otros tipos de eventos, solo registramos sin texto descriptivo
        if (!['IPO', 'EMIT', 'PURCHASE_VALIDATION', 'EXTERNAL_PURCHASE'].includes(type)) {
            const query = `
                INSERT INTO events (type, details)
                VALUES ($1, $2)
                RETURNING id
            `;
            
            const result = await client.query(query, [type, JSON.stringify(details)]);
            console.log(`Evento ${type} registrado con ID ${result.rows[0].id}`);
            return result.rows[0].id;
        }
        
        return null;
    } catch (error) {
        console.error("Error registrando evento:", error);
        return null;
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
            
            // Registrar evento
            await logEvent('IPO', {
                symbol,
                price,
                long_name: longName,
                quantity,
                timestamp,
                kind: 'IPO'
            });
            
            res.json({ status: "success", data: result.rows[0] });
            
        } else if (kind === 'EMIT') {
            // Verificar si la stock ya existe
            const checkQuery = `SELECT * FROM stocks WHERE symbol = $1 ORDER BY timestamp DESC LIMIT 1;`;
            const checkResult = await client.query(checkQuery, [symbol]);
        
            if (checkResult.rows.length > 0) {
                // La stock existe, actualizamos la entrada existente
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
                
                const updateValues = [
                    existingStock.id,  // ID del registro existente
                    price,             // Actualizamos al nuevo precio
                    longName || existingStock.long_name, // Usamos el nombre nuevo o el existente
                    updatedQuantity,   // Sumamos la cantidad nueva a la existente
                    timestamp
                ];
        
                const result = await client.query(updateQuery, updateValues);
        
                console.log("Stock updated (EMIT):", result.rows[0]);
                
                // Registrar evento
                await logEvent('EMIT', {
                    symbol,
                    price,
                    long_name: longName || existingStock.long_name,
                    quantity,
                    timestamp,
                    kind: 'EMIT'
                });
                
                res.json({ status: "success", data: result.rows[0] });
            } else {
                // La stock no existe, tratarla como una nueva (IPO)
                console.log(`Symbol ${symbol} not found for EMIT, treating as new stock (IPO)`);
                
                const insertQuery = `
                    INSERT INTO stocks (symbol, price, long_name, quantity, timestamp)
                    VALUES ($1, $2, $3, $4, $5)
                    RETURNING *;
                `;
        
                const insertValues = [symbol, price, longName, quantity, timestamp];
                const result = await client.query(insertQuery, insertValues);
        
                console.log("New stock from EMIT saved to database:", result.rows[0]);
                
                // Registrar evento como IPO ya que es nuevo
                await logEvent('IPO', {
                    symbol,
                    price,
                    long_name: longName,
                    quantity,
                    timestamp,
                    kind: 'IPO'
                });
                
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

                const updateValues = [
                    symbol,
                    price,
                    existingStock.long_name,
                    existingStock.quantity,
                    timestamp
                ];

                const result = await client.query(insertQuery, updateValues);

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
    
    // Obtener parámetros de filtrado
    const { 
        symbol, 
        name, 
        minPrice, 
        maxPrice, 
        minQuantity, 
        maxQuantity, 
        date 
    } = req.query;

    try {
        let query = `
            SELECT DISTINCT ON (symbol) *
            FROM stocks
        `;
        
        const values = [];
        let paramIndex = 1;
        let whereClauseAdded = false;
        
        // Construir la cláusula WHERE con los filtros
        if (symbol) {
            query += whereClauseAdded ? ' AND ' : ' WHERE ';
            query += `symbol ILIKE $${paramIndex}`;
            values.push(`%${symbol}%`);
            paramIndex++;
            whereClauseAdded = true;
        }
        
        if (name) {
            query += whereClauseAdded ? ' AND ' : ' WHERE ';
            query += `long_name ILIKE $${paramIndex}`;
            values.push(`%${name}%`);
            paramIndex++;
            whereClauseAdded = true;
        }
        
        if (minPrice) {
            query += whereClauseAdded ? ' AND ' : ' WHERE ';
            query += `price >= $${paramIndex}`;
            values.push(parseFloat(minPrice));
            paramIndex++;
            whereClauseAdded = true;
        }
        
        if (maxPrice) {
            query += whereClauseAdded ? ' AND ' : ' WHERE ';
            query += `price <= $${paramIndex}`;
            values.push(parseFloat(maxPrice));
            paramIndex++;
            whereClauseAdded = true;
        }
        
        if (minQuantity) {
            query += whereClauseAdded ? ' AND ' : ' WHERE ';
            query += `quantity >= $${paramIndex}`;
            values.push(parseInt(minQuantity));
            paramIndex++;
            whereClauseAdded = true;
        }
        
        if (maxQuantity) {
            query += whereClauseAdded ? ' AND ' : ' WHERE ';
            query += `quantity <= $${paramIndex}`;
            values.push(parseInt(maxQuantity));
            paramIndex++;
            whereClauseAdded = true;
        }
        
        if (date) {
            query += whereClauseAdded ? ' AND ' : ' WHERE ';
            query += `timestamp::date = $${paramIndex}`;
            values.push(date);
            paramIndex++;
            whereClauseAdded = true;
        }
        
        // Completar la query con ORDER BY, LIMIT y OFFSET
        query += ` ORDER BY symbol, timestamp DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        values.push(count, offset);

        const result = await client.query(query, values);
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
app.get('/user/profile', conditionalAuth, conditionalSyncUser, async (req, res) => {
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
app.post('/users/register', conditionalAuth, conditionalSyncUser, async (req, res) => {
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

// Endpoint de depósito en wallet
app.post('/wallet/deposit', conditionalAuth, conditionalSyncUser, async (req, res) => {
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
        
        res.json({ 
            success: true,
            message: `Depósito de $${amountValue} realizado exitosamente`,
            balance: newBalance 
        });
    } catch (error) {
        console.error("Error al depositar en billetera:", error);
        res.status(500).json({ 
            error: "Error interno del servidor al depositar", 
            details: error.message
        });
    }
});

// Obtener saldo de la billetera
app.get('/wallet/balance', conditionalAuth, conditionalSyncUser, async (req, res) => {
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

// Comprar acciones
app.post('/stocks/buy', conditionalAuth, conditionalSyncUser, async (req, res) => {
    try {
        const { symbol, quantity } = req.body;
        
        if (!symbol || !quantity || quantity <= 0) {
            return res.status(400).json({ error: "Solicitud de compra inválida" });
        }
        
        console.log(`🛒 Procesando compra directa: ${quantity} acciones de ${symbol}`);
        
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

        // Verificar saldo del usuario
        const balanceQuery = `SELECT balance FROM wallet WHERE user_id = $1`;
        const balanceResult = await client.query(balanceQuery, [req.userId]);
        
        if (balanceResult.rows.length === 0) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }
        
        const userBalance = balanceResult.rows[0].balance;
        
        if (userBalance < totalCost) {
            return res.status(400).json({ 
                error: `Saldo insuficiente. Necesitas $${totalCost.toLocaleString()} pero tienes $${userBalance.toLocaleString()}` 
            });
        }

        console.log(`💰 Costo total: $${totalCost}, saldo usuario: $${userBalance}`);
        
        // Generar UUID para la solicitud
        const requestId = uuidv4();

        // Iniciar transacción de base de datos
        await client.query('BEGIN');

        try {
            // 1. Descontar del saldo del usuario
            await client.query(
                `UPDATE wallet SET balance = balance - $1 WHERE user_id = $2`,
                [totalCost, req.userId]
            );

            // 2. Reducir cantidad de acciones disponibles
            await client.query(
                `UPDATE stocks SET quantity = quantity - $1 WHERE id = $2`,
                [quantity, stock.id]
            );

            // 3. Crear registro de compra en purchase_requests
            const purchaseQuery = `
                INSERT INTO purchase_requests 
                (request_id, user_id, symbol, quantity, price, status) 
                VALUES ($1, $2, $3, $4, $5, 'ACCEPTED')
                RETURNING id
            `;
            
            await client.query(purchaseQuery, [
                requestId, 
                req.userId,
                symbol, 
                quantity, 
                stock.price
            ]);

            // ✨ NUEVO: También insertar en la tabla purchases para que aparezca en "Mis Acciones"
            await client.query(`
                INSERT INTO purchases (user_id, symbol, quantity, price_at_purchase, status)
                VALUES ($1, $2, $3, $4, 'COMPLETED')
            `, [req.userId, symbol, quantity, stock.price]);

            // 4. Registrar evento
            await logEvent('PURCHASE_DIRECT', {
                request_id: requestId,
                user_id: req.userId,
                symbol: symbol,
                quantity: quantity,
                price: stock.price,
                total_cost: totalCost,
                group_id: GROUP_ID
            });

            // Confirmar transacción
            await client.query('COMMIT');

            console.log(`✅ Compra exitosa: ${quantity} acciones de ${symbol} por $${totalCost}`);
            
            res.json({
                message: `Compra exitosa: ${quantity} acciones de ${symbol} por $${totalCost.toLocaleString()}`,
                success: true,
                request_id: requestId,
                symbol: symbol,
                quantity: quantity,
                totalCost: totalCost,
                newBalance: userBalance - totalCost
            });
            
        } catch (dbError) {
            // Revertir transacción en caso de error
            await client.query('ROLLBACK');
            throw dbError;
        }
        
    } catch (error) {
        console.error("❌ Error procesando compra:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});



// Obtener compras del usuario (versión mejorada) - CON AUTENTICACIÓN RESTAURADA
app.get('/purchases', conditionalAuth, conditionalSyncUser, async (req, res) => {
    try {
        // Obtener compras del usuario con una consulta mejorada que evita duplicados
        const purchasesQuery = `
        WITH latest_stocks AS (
            SELECT DISTINCT ON (symbol) symbol, long_name, price, timestamp
            FROM stocks
            ORDER BY symbol, timestamp DESC
        )
        SELECT 
            pr.id, 
            pr.request_id, 
            pr.symbol, 
            pr.quantity, 
            pr.price as price_at_purchase, 
            pr.status, 
            pr.reason,
            pr.created_at,
            ls.long_name
        FROM purchase_requests pr
        JOIN latest_stocks ls ON pr.symbol = ls.symbol
        WHERE pr.user_id = $1
        AND pr.status IN ('PENDING', 'ACCEPTED')
        ORDER BY pr.created_at DESC
        `;

        const result = await client.query(purchasesQuery, [req.userId]);

        const purchases = result.rows.map(row => ({
            id: row.id,
            request_id: row.request_id,
            symbol: row.symbol,
            quantity: row.quantity,
            priceAtPurchase: row.price_at_purchase,  // ← MAPEAR NOMBRE
            status: row.status,
            reason: row.reason,
            createdAt: row.created_at,              // ← MAPEAR NOMBRE
            longName: row.long_name
        }));

        res.json(purchases);
        /*
        const purchasesResult = await client.query(purchasesQuery, [req.userId]);
        
        console.log(`Obtenidas ${purchasesResult.rows.length} compras para el usuario ${req.userId}`);
        
        res.json({ data: purchasesResult.rows });
        */
    } catch (error) {
        console.error("Error obteniendo compras:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Añade esta ruta de depuración para verificar duplicados
app.get('/debug/check-duplicates', async (req, res) => {
    try {
        const query = `
            SELECT request_id, COUNT(*) as count
            FROM purchase_requests
            GROUP BY request_id
            HAVING COUNT(*) > 1
            ORDER BY count DESC
        `;
        
        const result = await client.query(query);
        
        if (result.rows.length > 0) {
            console.log(`Se encontraron ${result.rows.length} request_ids duplicados`);
            res.json({ 
                duplicates_found: true, 
                duplicate_request_ids: result.rows
            });
        } else {
            console.log("No se encontraron request_ids duplicados");
            res.json({ duplicates_found: false });
        }
    } catch (error) {
        console.error("Error verificando duplicados:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});


// REEMPLAZAR TODO EL ENDPOINT /purchase-validation (líneas 936-1024) CON ESTE:
app.post('/purchase-validation', async (req, res) => {
    try {
      const validation = req.body;
  
      console.log(`🔍 VALIDACIÓN RECIBIDA:`, validation);
      
      if (!validation.request_id) {
        return res.status(400).json({ error: "Datos de validación inválidos" });
      }
      
      // Verificar si es una transacción WebPay
      const webpayCheck = await client.query(`
        SELECT COUNT(*) as count FROM webpay_transactions 
        WHERE request_id = $1
      `, [validation.request_id]);
      
      const isWebpayTransaction = webpayCheck.rows[0].count > 0;
      
      if (isWebpayTransaction) {
        console.log(`🔍 Validación de WebPay detectada para ${validation.request_id}, ignorando (ya procesada por WebPay)`);
        return res.json({ 
          status: "ignored", 
          message: "Transacción WebPay ya procesada directamente" 
        });
      }
      
      // Registrar para depuración
      console.log(`Procesando validación para request_id: ${validation.request_id}, status: ${validation.status}`);
      
      // Verificar si ya hemos procesado una validación final para este request_id
      const checkQuery = `
        SELECT status 
        FROM purchase_requests 
        WHERE request_id = $1
      `;
      
      const checkResult = await client.query(checkQuery, [validation.request_id]);
  
      console.log(`🔍 Estado actual encontrado:`, checkResult.rows);
      
      // Si ya existe una validación final, no procesar esta
      if (checkResult.rows.length > 0 && ['ACCEPTED', 'REJECTED'].includes(checkResult.rows[0].status)) {
        console.log(`Validación duplicada para request_id ${validation.request_id}, ignorando`);
        return res.json({ 
          status: "ignored", 
          message: `La solicitud ${validation.request_id} ya ha sido validada con estado ${checkResult.rows[0].status}`
        });
      }
  
      console.log(`🔄 Actualizando request_id ${validation.request_id} a status: ${validation.status}`);
      
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
        console.log(`No se encontró la solicitud ${validation.request_id} en nuestra base de datos`);
        return res.status(404).json({ error: "Solicitud de compra no encontrada" });
      }
      
      const purchase = updateResult.rows[0];
      
      // Registrar evento de validación
      await logEvent('PURCHASE_VALIDATION', {
        request_id: validation.request_id,
        status: validation.status,
        reason: validation.reason,
        symbol: purchase.symbol,
        quantity: purchase.quantity,
        price: purchase.price
      });
      
      // NOTA: No se maneja wallet ni stocks aquí para transacciones WebPay
      // porque ya se procesan directamente en webpayController.js
      
      res.json({ status: "success" });
    } catch (error) {
      console.error("Error procesando validación de compra:", error);
      res.status(500).json({ error: "Error interno del servidor" });
    }
  });

// Procesar compra externa (de otros grupos)
// Asegúrate de que esta ruta exista exactamente así
app.post('/external-purchase', async (req, res) => {
    try {
        const purchase = req.body;
        
        if (!purchase.symbol || !purchase.quantity || !purchase.request_id) {
            return res.status(400).json({ error: "Datos de compra inválidos" });
        }
        
        console.log(`Procesando compra externa: ${purchase.quantity} acciones de ${purchase.symbol}, request_id: ${purchase.request_id}`);
        
        // Obtener la entrada más reciente de la acción
        const stockQuery = `
            SELECT id, quantity, symbol FROM stocks 
            WHERE symbol = $1 
            ORDER BY timestamp DESC 
            LIMIT 1
        `;
        
        const stockResult = await client.query(stockQuery, [purchase.symbol]);
        
        if (stockResult.rows.length === 0) {
            console.log(`Símbolo ${purchase.symbol} no encontrado para compra externa`);
            return res.status(404).json({ error: `Símbolo ${purchase.symbol} no encontrado` });
        }
        
        const stock = stockResult.rows[0];
        
        // Verificar si hay suficientes acciones
        if (stock.quantity < purchase.quantity) {
            console.log(`No hay suficientes acciones de ${purchase.symbol} disponibles (tenemos ${stock.quantity}, se pidieron ${purchase.quantity})`);
            return res.status(400).json({ 
                error: `No hay suficientes acciones de ${purchase.symbol} disponibles` 
            });
        }
        
        // Actualizar cantidad de acciones
        await client.query(`
            UPDATE stocks 
            SET quantity = quantity - $1 
            WHERE id = $2
        `, [purchase.quantity, stock.id]);
        
        console.log(`Actualizado inventario para compra externa: ${purchase.symbol}, -${purchase.quantity} acciones`);
        
        // Registrar evento
        await logEvent('EXTERNAL_PURCHASE', purchase);
        
        res.json({ status: "success" });
    } catch (error) {
        console.error("Error procesando compra externa:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// ENDPOINTS DE LOG DE EVENTOS ==============================================

// Registrar evento
// Registrar evento (endpoint para recibir eventos del cliente MQTT)
// Registrar evento (endpoint para recibir eventos del cliente MQTT)
app.post('/events', async (req, res) => {
    try {
        const { type, details } = req.body;
        
        if (!type || !details) {
            return res.status(400).json({ error: "Tipo o detalles del evento faltantes" });
        }
        
        // Usar la función de registrar evento que ahora verifica duplicados
        const eventId = await logEvent(type, details);
        
        if (!eventId) {
            return res.status(400).json({ error: "No se pudo registrar el evento" });
        }
        
        res.json({ status: "success", id: eventId });
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
            SELECT id, type, details, created_at 
            FROM events
        `;
        
        const params = [];
        
        if (type && type !== 'ALL') {
            query += ` WHERE type = $1`;
            params.push(type);
        } else {
            // Si no hay tipo específico, filtramos para mostrar solo los 4 tipos de eventos relevantes
            query += ` WHERE type IN ('IPO', 'EMIT', 'PURCHASE_VALIDATION', 'EXTERNAL_PURCHASE')`;
            
            // Para PURCHASE_VALIDATION, solo incluimos las aceptadas
            query += ` AND (type != 'PURCHASE_VALIDATION' OR (type = 'PURCHASE_VALIDATION' AND details->>'status' = 'ACCEPTED'))`;
        }
        
        query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
        params.push(count, offset);
        
        const result = await client.query(query, params);
        
        const formattedEvents = result.rows.map(event => {
            // Aseguramos que details sea un objeto
            const details = typeof event.details === 'string' ? 
                JSON.parse(event.details) : event.details;
            
            // Formato de fecha
            const formattedDate = new Date(event.created_at).toLocaleString();
            
            return {
                ...event,
                details,
                formatted_date: formattedDate
            };
        });
        
        res.json({ data: formattedEvents });
    } catch (error) {
        console.error("Error obteniendo eventos:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.get('/check-request', async (req, res) => {
    try {
        const { id } = req.query;
        
        if (!id) {
            return res.status(400).json({ error: "ID de solicitud no proporcionado" });
        }
        
        const query = `
            SELECT COUNT(*) as count 
            FROM purchase_requests 
            WHERE request_id = $1
        `;
        
        const result = await client.query(query, [id]);
        const belongs = result.rows[0].count > 0;
        
        console.log(`Verificación de request_id ${id}: ${belongs ? 'Pertenece a nosotros' : 'No pertenece a nosotros'}`);
        
        res.json({ 
            request_id: id,
            belongs_to_us: belongs 
        });
    } catch (error) {
        console.error("Error verificando solicitud:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});
// Agregar este endpoint de depuración después de los demás endpoints

// Endpoint de depuración de token JWT
app.get('/debug/token', conditionalAuth, async (req, res) => {
    try {
        // 1. Extraer el token del encabezado
        const authHeader = req.headers.authorization || '';
        const token = authHeader.replace('Bearer ', '');
        
        // 2. Decodificar manualmente el token para mostrar su contenido
        let decodedToken = null;
        try {
            const parts = token.split('.');
            if (parts.length === 3) {
                // Decodificar el payload (segunda parte del token)
                const payload = Buffer.from(parts[1], 'base64').toString('utf8');
                decodedToken = JSON.parse(payload);
            }
        } catch (err) {
            console.error("Error decodificando token:", err);
        }
        
        // 3. Verificar campos obligatorios para el registro
        const auth0Id = req.auth?.payload?.sub || req.auth?.sub || decodedToken?.sub;
        const email = req.auth?.payload?.email || req.auth?.email || decodedToken?.email;
        const name = req.auth?.payload?.name || req.auth?.name || decodedToken?.name;
        
        // 4. Comprobar si el usuario existe en la base de datos
        const client = await pool.connect();
        let userExists = false;
        
        try {
            const checkQuery = "SELECT * FROM users WHERE auth0_id = $1";
            const checkResult = await client.query(checkQuery, [auth0Id]);
            userExists = checkResult.rows.length > 0;
            
            if (userExists) {
                console.log("Usuario encontrado en la base de datos:", checkResult.rows[0]);
            } else {
                console.log("El usuario no existe en la base de datos");
            }
        } finally {
            client.release();
        }
        
        res.json({
            token_valid: !!req.auth,
            token_format: {
                has_req_auth: !!req.auth,
                req_auth_keys: req.auth ? Object.keys(req.auth) : [],
                req_auth_payload_keys: req.auth?.payload ? Object.keys(req.auth.payload) : []
            },
            user_info: {
                auth0_id: auth0Id,
                email: email,
                name: name
            },
            required_fields_present: {
                auth0_id: !!auth0Id,
                email: !!email,
                name: !!name
            },
            db_check: {
                user_exists: userExists
            },
            decoded_payload: decodedToken
        });
        
    } catch (error) {
        console.error("Error en endpoint de depuración:", error);
        res.status(500).json({ 
            error: "Error en depuración", 
            details: error.message,
            stack: error.stack
        });
    }
});

// Endpoint de estadísticas de compras (agregar antes de app.listen())
app.get('/api/purchases/stats', async (req, res) => {
    try {
        // Obtener total de compras
        const totalQuery = `SELECT COUNT(*) as total FROM purchase_requests`;
        const totalResult = await client.query(totalQuery);
        
        // Obtener estadísticas por status
        const statusQuery = `
            SELECT 
                status,
                COUNT(*) as count
            FROM purchase_requests 
            GROUP BY status
        `;
        const statusResult = await client.query(statusQuery);
        
        // Preparar respuesta
        const stats = {
            total: parseInt(totalResult.rows[0]?.total || 0),
            processed: 0,
            pending: 0,
            failed: 0
        };
        
        // Mapear resultados por status
        statusResult.rows.forEach(row => {
            const count = parseInt(row.count);
            switch(row.status?.toUpperCase()) {
                case 'ACCEPTED':
                    stats.processed = count;
                    break;
                case 'PENDING':
                    stats.pending = count;
                    break;
                case 'REJECTED':
                case 'ERROR':
                    stats.failed = count;
                    break;
            }
        });
        
        res.json(stats);
    } catch (error) {
        console.error('Error obteniendo estadísticas de compras:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor',
            details: error.message 
        });
    }
});

// AGREGAR ANTES DE: app.listen(port, '0.0.0.0',() => {
// (línea ~720)

// Endpoint para consultar estimaciones
app.get('/estimation/:jobId', async (req, res) => {
    try {
        const { jobId } = req.params;
        
        console.log(`Consultando estimación para job: ${jobId}`);
        
        const response = await fetch(`${WORKERS_API_URL}/job/${jobId}`);
        const result = await response.json();
        
        if (response.ok) {
            res.json(result);
        } else {
            res.status(response.status).json(result);
        }
    } catch (error) {
        console.error('Error getting estimation:', error);
        res.status(500).json({ error: 'Error obteniendo estimación' });
    }
});

// Endpoint para verificar estado del JobMaster (RF04)
app.get('/workers/health', async (req, res) => {
    try {
        const response = await fetch(`${WORKERS_API_URL}/heartbeat`, {
            timeout: 5000
        });
        const result = await response.json();
        
        res.json({
            workers_available: response.ok && result.healthy === true,
            status: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error checking workers health:', error);
        res.json({
            workers_available: false,
            error: 'Workers no disponibles',
            timestamp: new Date().toISOString()
        });
    }
});

// Endpoint para obtener estimación de una compra específica
app.get('/purchase/:requestId/estimation', conditionalAuth, conditionalSyncUser, async (req, res) => {
    try {
        const { requestId } = req.params;
        
        // Buscar el job_id asociado a esta compra
        const purchaseQuery = `
            SELECT estimation_job_id, user_id, symbol, quantity, price 
            FROM purchase_requests 
            WHERE request_id = $1 AND user_id = $2
        `;
        
        const purchaseResult = await client.query(purchaseQuery, [requestId, req.userId]);
        
        if (purchaseResult.rows.length === 0) {
            return res.status(404).json({ error: 'Compra no encontrada' });
        }
        
        const purchase = purchaseResult.rows[0];
        
        if (!purchase.estimation_job_id) {
            return res.json({
                status: 'no_estimation',
                message: 'Estimación no generada para esta compra'
            });
        }
        
        // Consultar el estado de la estimación
        const response = await fetch(`${WORKERS_API_URL}/job/${purchase.estimation_job_id}`);
        const estimationResult = await response.json();
        
        if (response.ok) {
            res.json({
                ...estimationResult,
                purchase_info: {
                    symbol: purchase.symbol,
                    quantity: purchase.quantity,
                    price: purchase.price
                }
            });
        } else {
            res.status(response.status).json(estimationResult);
        }
        
    } catch (error) {
        console.error('Error getting purchase estimation:', error);
        res.status(500).json({ error: 'Error obteniendo estimación de compra' });
    }
});
// NUEVAS RUTAS PARA SUBASTAS (RF04) - TEMPORALMENTE SIN AUTENTICACIÓN
// Crear una subasta (SIN AUTH TEMPORAL)
app.post('/auctions', auctionController.createAuction);

// Obtener subastas activas (PÚBLICO - no requiere auth)
app.get('/auctions', auctionController.getActiveAuctions);

// Hacer una oferta en una subasta (SIN AUTH TEMPORAL)
app.post('/auctions/:auction_id/bid', auctionController.placeBid);

// Cerrar una subasta (SIN AUTH TEMPORAL)
app.post('/auctions/:auction_id/close', auctionController.closeAuction);

// Procesar subastas externas (desde MQTT)
app.post('/auctions/external', auctionController.processExternalAuction);

// Procesar ofertas externas del formato del enunciado (desde MQTT)
app.post('/external-offers', async (req, res) => {
    try {
        const offerData = req.body;
        const pool = req.app.locals.pool;
        
        console.log("Procesando oferta externa:", offerData);
        
        // Insertar o actualizar la oferta externa en la base de datos
        const insertQuery = `
            INSERT INTO external_auctions (auction_id, group_id, symbol, quantity, timestamp, status)
            VALUES ($1, $2, $3, $4, $5, 'ACTIVE')
            ON CONFLICT (auction_id) 
            DO UPDATE SET 
                group_id = EXCLUDED.group_id,
                symbol = EXCLUDED.symbol,
                quantity = EXCLUDED.quantity,
                timestamp = EXCLUDED.timestamp,
                updated_at = CURRENT_TIMESTAMP
            RETURNING *
        `;
        
        const result = await pool.query(insertQuery, [
            offerData.auction_id,
            offerData.group_id,
            offerData.symbol,
            offerData.quantity,
            offerData.timestamp
        ]);
        
        console.log(`Oferta externa guardada: ${offerData.symbol} del grupo ${offerData.group_id}`);
        
        res.json({ 
            status: "success", 
            message: "Oferta externa procesada",
            offer: result.rows[0]
        });
    } catch (error) {
        console.error("Error procesando oferta externa:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// NUEVAS RUTAS PARA INTERCAMBIOS (RF05) - TEMPORALMENTE SIN AUTENTICACIÓN
// Proponer un intercambio (SIN AUTH TEMPORAL)
app.post('/exchanges', exchangeController.proposeExchange);

// Responder a un intercambio (aceptar/rechazar) (SIN AUTH TEMPORAL)
app.post('/exchanges/:exchange_id/respond', exchangeController.respondToExchange);

// Obtener intercambios pendientes (SIN AUTH TEMPORAL)
app.get('/exchanges/pending', exchangeController.getPendingExchanges);

// Obtener historial de intercambios (SIN AUTH TEMPORAL)
app.get('/exchanges/history', exchangeController.getExchangeHistory);

// Procesar propuestas externas (desde MQTT)
app.post('/exchanges/proposal', exchangeController.processExternalProposal);

// Procesar respuestas externas (desde MQTT)
app.post('/exchanges/response', exchangeController.processExternalResponse);

// Endpoint simple de health check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        service: 'StockMarketU API'
    });
});

// ===============================================
// RUTAS DE ADMINISTRADOR (REQUIEREN AUTENTICACIÓN DE ADMIN)
// ===============================================

// Promover usuario a administrador (solo configuración inicial)
// ===============================================
// RUTAS DE ADMIN MOVIDAS A adminRoutes.js
// ===============================================

// ===============================================
// ENDPOINTS DE PRUEBA SIN AUTENTICACIÓN
// ===============================================

// Crear subasta de prueba
app.post('/test/auctions', async (req, res) => {
    try {
        const { symbol, quantity, starting_price, duration_minutes } = req.body;
        
        if (!symbol || !quantity || !starting_price || !duration_minutes) {
            return res.status(400).json({ 
                error: "Faltan parámetros requeridos",
                required: ["symbol", "quantity", "starting_price", "duration_minutes"]
            });
        }
        
        const pool = req.app.locals.pool;
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Verificar stocks disponibles
            const stockQuery = `SELECT SUM(quantity) as total_quantity FROM stocks WHERE symbol = $1 AND quantity > 0`;
            const stockResult = await client.query(stockQuery, [symbol]);
            
            if (!stockResult.rows[0] || stockResult.rows[0].total_quantity < quantity) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "No hay suficientes acciones disponibles" });
            }
            
            // Crear subasta
            const auctionId = uuidv4();
            const endTime = new Date(Date.now() + duration_minutes * 60 * 1000);
            const GROUP_ID = process.env.GROUP_ID || "1";
            
            const insertQuery = `
                INSERT INTO auctions (id, group_id, symbol, quantity, starting_price, current_price, end_time, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
                RETURNING *
            `;
            
            const auctionResult = await client.query(insertQuery, [
                auctionId, GROUP_ID, symbol, quantity, starting_price, starting_price, endTime
            ]);
            
            // Reservar acciones
            await client.query(`
                UPDATE stocks SET quantity = quantity - $1 
                WHERE symbol = $2 AND id = (SELECT id FROM stocks WHERE symbol = $2 AND quantity > 0 ORDER BY timestamp DESC LIMIT 1)
            `, [quantity, symbol]);
            
            await client.query('COMMIT');
            
            res.status(201).json({
                status: "success",
                message: "Subasta de prueba creada",
                auction: auctionResult.rows[0]
            });
            
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error("Error en subasta de prueba:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Hacer oferta de prueba
app.post('/test/auctions/:auction_id/bid', async (req, res) => {
    try {
        const { auction_id } = req.params;
        const { bid_amount } = req.body;
        const GROUP_ID = process.env.GROUP_ID || "1";
        
        if (!bid_amount || bid_amount <= 0) {
            return res.status(400).json({ error: "El monto de la oferta debe ser positivo" });
        }
        
        const pool = req.app.locals.pool;
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Verificar subasta
            const auctionQuery = `SELECT * FROM auctions WHERE id = $1 AND status = 'ACTIVE' AND end_time > NOW()`;
            const auctionResult = await client.query(auctionQuery, [auction_id]);
            
            if (auctionResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: "Subasta no encontrada o ya cerrada" });
            }
            
            const auction = auctionResult.rows[0];
            
            if (bid_amount <= auction.current_price) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    error: "La oferta debe ser mayor al precio actual",
                    current_price: auction.current_price
                });
            }
            
            // Insertar oferta
            const bidId = uuidv4();
            await client.query(`
                INSERT INTO auction_bids (id, auction_id, bidder_group_id, bid_amount)
                VALUES ($1, $2, $3, $4)
            `, [bidId, auction_id, GROUP_ID, bid_amount]);
            
            // Actualizar precio actual
            await client.query(`
                UPDATE auctions SET current_price = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
            `, [bid_amount, auction_id]);
            
            await client.query('COMMIT');
            
            res.json({
                status: "success",
                message: "Oferta de prueba realizada",
                bid: { id: bidId, auction_id: auction_id, bid_amount: bid_amount }
            });
            
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error("Error en oferta de prueba:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Proponer intercambio de prueba
app.post('/test/exchanges', async (req, res) => {
    try {
        const { target_group_id, offered_symbol, offered_quantity, requested_symbol, requested_quantity } = req.body;
        const GROUP_ID = process.env.GROUP_ID || "1";
        
        if (!target_group_id || !offered_symbol || !offered_quantity || !requested_symbol || !requested_quantity) {
            return res.status(400).json({ 
                error: "Faltan parámetros requeridos",
                required: ["target_group_id", "offered_symbol", "offered_quantity", "requested_symbol", "requested_quantity"]
            });
        }
        
        const pool = req.app.locals.pool;
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // Verificar stocks disponibles
            const stockQuery = `SELECT SUM(quantity) as total_quantity FROM stocks WHERE symbol = $1 AND quantity > 0`;
            const stockResult = await client.query(stockQuery, [offered_symbol]);
            
            if (!stockResult.rows[0] || stockResult.rows[0].total_quantity < offered_quantity) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "No hay suficientes acciones para ofrecer" });
            }
            
            // Crear intercambio
            const exchangeId = uuidv4();
            const insertQuery = `
                INSERT INTO exchanges (id, origin_group_id, target_group_id, offered_symbol, offered_quantity, requested_symbol, requested_quantity, status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING')
                RETURNING *
            `;
            
            const exchangeResult = await client.query(insertQuery, [
                exchangeId, parseInt(GROUP_ID), target_group_id, offered_symbol, offered_quantity, requested_symbol, requested_quantity
            ]);
            
            // Reservar acciones ofrecidas
            await client.query(`
                UPDATE stocks SET quantity = quantity - $1 
                WHERE symbol = $2 AND id = (SELECT id FROM stocks WHERE symbol = $2 AND quantity > 0 ORDER BY timestamp DESC LIMIT 1)
            `, [offered_quantity, offered_symbol]);
            
            await client.query('COMMIT');
            
            res.status(201).json({
                status: "success",
                message: "Intercambio de prueba propuesto",
                exchange: exchangeResult.rows[0]
            });
            
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error("Error en intercambio de prueba:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// ===============================================
// ENDPOINTS DE PRUEBA PARA COMPRAS Y BILLETERA
// ===============================================

// Ver saldo de prueba
app.get('/test/wallet/balance', async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const TEST_USER_ID = 1;
        
        const walletQuery = `SELECT balance FROM wallet WHERE user_id = $1`;
        const walletResult = await pool.query(walletQuery, [TEST_USER_ID]);
        
        const balance = walletResult.rows[0]?.balance || 0;
        
        res.json({ 
            balance: balance,
            user_id: TEST_USER_ID,
            message: "Saldo de usuario de prueba"
        });
    } catch (error) {
        console.error("Error obteniendo saldo de prueba:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Depositar dinero de prueba
app.post('/test/wallet/deposit', async (req, res) => {
    try {
        const { amount } = req.body;
        const pool = req.app.locals.pool;
        const TEST_USER_ID = 1;
        
        if (!amount || amount <= 0) {
            return res.status(400).json({ error: "Monto inválido" });
        }
        
        const updateQuery = `
            UPDATE wallet 
            SET balance = balance + $2, updated_at = CURRENT_TIMESTAMP
            WHERE user_id = $1
            RETURNING balance
        `;
        
        const result = await pool.query(updateQuery, [TEST_USER_ID, amount]);
        
        res.json({
            status: "success",
            message: `Depósito de $${amount} realizado`,
            new_balance: result.rows[0].balance,
            user_id: TEST_USER_ID
        });
    } catch (error) {
        console.error("Error en depósito de prueba:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Comprar acciones de prueba
app.post('/test/stocks/buy', async (req, res) => {
    try {
        const { symbol, quantity } = req.body;
        const pool = req.app.locals.pool;
        const client = await pool.connect();
        const TEST_USER_ID = 1;
        
        if (!symbol || !quantity || quantity <= 0) {
            return res.status(400).json({ error: "Solicitud de compra inválida" });
        }
        
        try {
            await client.query('BEGIN');
            
            // Obtener precio actual de la acción
            const stockQuery = `
                SELECT * FROM stocks 
                WHERE symbol = $1 
                ORDER BY timestamp DESC 
                LIMIT 1
            `;
            
            const stockResult = await client.query(stockQuery, [symbol]);
            
            if (stockResult.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: "Acción no encontrada" });
            }
            
            const stock = stockResult.rows[0];
            
            if (stock.quantity < quantity) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: "No hay suficientes acciones disponibles" });
            }
            
            const totalCost = stock.price * quantity;
            
            // Verificar saldo del usuario
            const balanceQuery = `SELECT balance FROM wallet WHERE user_id = $1`;
            const balanceResult = await client.query(balanceQuery, [TEST_USER_ID]);
            
            if (balanceResult.rows.length === 0 || balanceResult.rows[0].balance < totalCost) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    error: `Saldo insuficiente. Necesitas $${totalCost} pero tienes $${balanceResult.rows[0]?.balance || 0}` 
                });
            }
            
            // Actualizar saldo
            await client.query(`
                UPDATE wallet 
                SET balance = balance - $2 
                WHERE user_id = $1
            `, [TEST_USER_ID, totalCost]);
            
            // Actualizar inventario
            await client.query(`
                UPDATE stocks 
                SET quantity = quantity - $1 
                WHERE id = $2
            `, [quantity, stock.id]);
            
            // Registrar compra
            const purchaseId = uuidv4();
            await client.query(`
                INSERT INTO purchase_requests (request_id, user_id, symbol, quantity, price, status, created_at)
                VALUES ($1, $2, $3, $4, $5, 'ACCEPTED', CURRENT_TIMESTAMP)
            `, [purchaseId, TEST_USER_ID, symbol, quantity, stock.price]);
            
            await client.query('COMMIT');
            
            res.json({
                status: "success",
                message: `Compra exitosa: ${quantity} acciones de ${symbol}`,
                purchase: {
                    id: purchaseId,
                    symbol: symbol,
                    quantity: quantity,
                    price: stock.price,
                    total_cost: totalCost
                }
            });
            
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error("Error en compra de prueba:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Ver mis compras de prueba
app.get('/test/purchases', async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        const TEST_USER_ID = 1;
        
        const purchasesQuery = `
            SELECT pr.*, s.long_name
            FROM purchase_requests pr
            LEFT JOIN stocks s ON pr.symbol = s.symbol
            WHERE pr.user_id = $1 AND pr.status = 'ACCEPTED'
            ORDER BY pr.created_at DESC
        `;
        
        const result = await pool.query(purchasesQuery, [TEST_USER_ID]);
        
        res.json({
            status: "success",
            purchases: result.rows,
            user_id: TEST_USER_ID
        });
    } catch (error) {
        console.error("Error obteniendo compras de prueba:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Endpoint para verificar configuración de Auth0
app.get('/auth0/config', (req, res) => {
    res.json({
        domain: process.env.AUTH0_DOMAIN,
        audience: process.env.AUTH0_AUDIENCE,
        client_id_configured: !!process.env.AUTH0_CLIENT_ID,
        client_secret_configured: !!process.env.AUTH0_CLIENT_SECRET,
        frontend_should_use: {
            domain: process.env.AUTH0_DOMAIN,
            clientId: process.env.AUTH0_CLIENT_ID,
            audience: process.env.AUTH0_AUDIENCE,
            scope: "openid profile email offline_access"
        }
    });
});

// Endpoint temporal de administración para agregar dinero a billeteras
app.post('/admin/add-money', async (req, res) => {
    try {
        const { email, amount } = req.body;
        
        if (!email || !amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
            return res.status(400).json({ 
                error: "Email y monto válido son requeridos",
                example: { email: "usuario@ejemplo.com", amount: 1000000000 }
            });
        }
        
        const amountValue = parseFloat(amount);
        
        // Buscar el usuario por email
        const userQuery = `SELECT id FROM users WHERE email = $1`;
        const userResult = await client.query(userQuery, [email]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ 
                error: `Usuario con email ${email} no encontrado`,
                suggestion: "El usuario debe haber iniciado sesión al menos una vez para existir en la base de datos"
            });
        }
        
        const userId = userResult.rows[0].id;
        
        // Verificar si ya tiene billetera
        const walletCheckQuery = `SELECT balance FROM wallet WHERE user_id = $1`;
        const walletCheckResult = await client.query(walletCheckQuery, [userId]);
        
        if (walletCheckResult.rows.length === 0) {
            // Crear billetera si no existe
            await client.query(`
                INSERT INTO wallet (user_id, balance, created_at, updated_at)
                VALUES ($1, $2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            `, [userId, amountValue]);
            
            console.log(`💰 Billetera creada para ${email} con $${amountValue}`);
        } else {
            // Actualizar billetera existente
            const updateQuery = `
                UPDATE wallet
                SET balance = balance + $2, updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $1
                RETURNING balance
            `;
            
            const updateResult = await client.query(updateQuery, [userId, amountValue]);
            const newBalance = updateResult.rows[0].balance;
            
            console.log(`💰 $${amountValue} agregados a ${email}. Nuevo balance: $${newBalance}`);
        }
        
        // Obtener balance final
        const finalBalanceQuery = `SELECT balance FROM wallet WHERE user_id = $1`;
        const finalBalanceResult = await client.query(finalBalanceQuery, [userId]);
        const finalBalance = finalBalanceResult.rows[0].balance;
        
        // Registrar evento
        await logEvent('ADMIN_WALLET_DEPOSIT', { 
            target_email: email,
            target_user_id: userId,
            amount: amountValue, 
            new_balance: finalBalance,
            admin_action: true
        });
        
        res.json({ 
            success: true,
            message: `$${amountValue.toLocaleString()} agregados exitosamente a ${email}`,
            user_email: email,
            user_id: userId,
            amount_added: amountValue,
            new_balance: finalBalance
        });
        
    } catch (error) {
        console.error("Error agregando dinero a billetera:", error);
        res.status(500).json({ 
            error: "Error interno del servidor", 
            details: error.message 
        });
    }
});

app.listen(port, '0.0.0.0',() => {
    console.log(`Servidor ejecutándose en http://localhost:${port}`);
});
