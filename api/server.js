import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import { auth } from 'express-oauth2-jwt-bearer';
import { v4 as uuidv4 } from 'uuid';
import { createSyncUserMiddleware } from './auth-integration.js';
import mqtt from 'mqtt';
import axios from 'axios'; // Añade esta línea

const Pool = pg.Pool;

const app = express();
const port = 3000;

dotenv.config();

// Configuración de la base de datos - MOVER ESTO ANTES DE USAR pool
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
});

// Crear middleware de sincronización de usuarios - AHORA pool YA ESTÁ DEFINIDO
const syncUser = createSyncUserMiddleware(pool);
const GROUP_ID = process.env.GROUP_ID || "1";

// Configurar middleware de autenticación Auth0
const checkJwt = auth({
    audience: 'https://stockmarket-api/',
    issuerBaseURL: 'https://dev-ouxdigl1l6bn6n3r.us.auth0.com/',
    tokenSigningAlg: 'RS256'
});


app.use(cors({
    origin: ['http://localhost:80', 'http://localhost', 'http://localhost:5173', 
        process.env.FRONTEND_URL, 'http://antonioescobar.lat',
        'http://frontend-grupo1-iic2173.s3-website-us-east-1.amazonaws.com/',
        'http://frontend-grupo1-iic2173.s3-website-us-east-1.amazonaws.com'].filter(Boolean),
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));


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
        
        console.log(`Procesando solicitud de compra: ${quantity} acciones de ${symbol}`);
        
        
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
            req.userId,
            symbol, 
            quantity, 
            stock.price
        ]);
        
        console.log(`Solicitud de compra registrada: ID ${requestId}`);
        
        // Reservar temporalmente la cantidad de acciones
        await client.query(`
            UPDATE stocks 
            SET quantity = quantity - $1 
            WHERE id = $2
        `, [quantity, stock.id]);
        
        console.log(`Reservadas ${quantity} acciones de ${symbol} temporalmente`);
        
        // Crear el mensaje para el broker MQTT
        const message = {
            request_id: requestId,
            group_id: GROUP_ID,
            quantity: quantity,
            symbol: symbol,
            operation: "BUY"
        };
        
        // Publicar solicitud de compra al broker MQTT
        await axios.post('http://mqtt-client:3000/publish', {
            topic: 'stocks/requests',
            message: message
        });
        
        console.log(`Solicitud enviada al broker MQTT: ${requestId}`);
        
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
                pr.price, 
                pr.status, 
                pr.reason,
                pr.created_at,
                ls.long_name
            FROM purchase_requests pr
            JOIN latest_stocks ls ON pr.symbol = ls.symbol
            WHERE pr.user_id = $1
            ORDER BY pr.created_at DESC
        `;
        
        const purchasesResult = await client.query(purchasesQuery, [req.userId]);
        
        console.log(`Obtenidas ${purchasesResult.rows.length} compras para el usuario ${req.userId}`);
        
        res.json({ data: purchasesResult.rows });
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

// Validación de compra (para las respuestas del broker)
app.post('/purchase-validation', async (req, res) => {
    try {
        const validation = req.body;
        
        if (!validation.request_id) {
            return res.status(400).json({ error: "Datos de validación inválidos" });
        }
        
        // Registrar para depuración
        console.log(`Procesando validación para request_id: ${validation.request_id}, status: ${validation.status}`);
        
        // Verificar si ya hemos procesado una validación final para este request_id
        const checkQuery = `
            SELECT status 
            FROM purchase_requests 
            WHERE request_id = $1
            AND status IN ('ACCEPTED', 'REJECTED')
        `;
        
        const checkResult = await client.query(checkQuery, [validation.request_id]);
        
        // Si ya existe una validación final, no procesar esta
        if (checkResult.rows.length > 0) {
            console.log(`Validación duplicada para request_id ${validation.request_id}, ignorando`);
            return res.json({ 
                status: "ignored", 
                message: `La solicitud ${validation.request_id} ya ha sido validada con estado ${checkResult.rows[0].status}`
            });
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
            console.log(`No se encontró la solicitud ${validation.request_id} en nuestra base de datos`);
            return res.status(404).json({ error: "Solicitud de compra no encontrada" });
        }
        
        const purchase = updateResult.rows[0];
        const totalCost = purchase.price * purchase.quantity;
        
        // Registrar evento de validación
        await logEvent('PURCHASE_VALIDATION', {
            request_id: validation.request_id,
            status: validation.status,
            reason: validation.reason,
            symbol: purchase.symbol,
            quantity: purchase.quantity,
            price: purchase.price
        });
        
        // Si la compra fue aceptada, descontar de la billetera
        if (validation.status === 'ACCEPTED') {
            await client.query(`
                UPDATE wallet 
                SET balance = balance - $1,
                    updated_at = CURRENT_TIMESTAMP
                WHERE user_id = $2
            `, [totalCost, purchase.user_id]);
            
            console.log(`Compra aceptada: descontado $${totalCost} de la wallet del usuario ${purchase.user_id}`);
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
                
                console.log(`Compra rechazada: devueltas ${purchase.quantity} acciones de ${purchase.symbol} al inventario`);
            }
        }
        
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
app.get('/debug/token', checkJwt, async (req, res) => {
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

app.listen(port, () => {
    console.log(`Servidor ejecutándose en http://localhost:${port}`);
});