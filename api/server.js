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
import { isAdmin, requireAdmin } from './auth-integration.js';

const Pool = pg.Pool;
const app = express();
const port = 3000;


dotenv.config();
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:80';

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

// Crear middleware de sincronización de usuarios
const syncUser = createSyncUserMiddleware(pool);
const GROUP_ID = process.env.GROUP_ID || "1";

// CORREGIR: Configurar middleware de autenticación Auth0 con las variables correctas
const checkJwt = auth({
    audience: process.env.AUTH0_AUDIENCE || 'https://stockmarket-api/',
    issuerBaseURL: process.env.AUTH0_DOMAIN ? `https://${process.env.AUTH0_DOMAIN}` : 'https://dev-ouxdigl1l6bn6n3r.us.auth0.com/',
    tokenSigningAlg: 'RS256',
});
// ✅ AÑADIR middleware de manejo de errores DESPUÉS del checkJwt
const handleAuthError = (error, req, res, next) => {
    console.error('🚨 Error de autenticación JWT:', {
        error: error.message,
        status: error.status,
        headers: req.headers.authorization ? 'Token presente' : 'Sin token',
        path: req.path,
        auth0_domain: process.env.AUTH0_DOMAIN,
        auth0_audience: process.env.AUTH0_AUDIENCE,
        issuer_url: process.env.AUTH0_DOMAIN ? `https://${process.env.AUTH0_DOMAIN}` : 'https://dev-ouxdigl1l6bn6n3r.us.auth0.com'
    });
    
    if (error.name === 'UnauthorizedError') {
        return res.status(401).json({
            error: 'Token de autenticación inválido o expirado',
            details: error.message,
            path: req.path,
            auth_error: true
        });
    }
    
    next(error);
};

// Webpay routes
app.use('/webpay', webpayRoutes);

// CORS configuration
app.use(cors({
    origin: ['http://localhost:80', 'http://localhost', 'http://localhost:5173', 
        process.env.FRONTEND_URL, 'http://antonioescobar.lat',
        'http://frontend-grupo1-iic2173.s3-website-us-east-1.amazonaws.com/',
        'http://frontend-grupo1-iic2173.s3-website-us-east-1.amazonaws.com'].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware de debugging
app.use('/api/purchases', (req, res, next) => {
    console.log(`🔍 ${req.method} ${req.path} - Origin: ${req.get('Origin')}`);
    next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api/purchases', purchaseRoutes);


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
        const isAdmin = req.isAdmin || req.auth?.payload?.['https://stockmarket-app/roles']?.includes('admin');
        let query = `
            SELECT DISTINCT ON (s.symbol) 
                s.symbol, 
                s.price, 
                s.long_name, 
                s.quantity, 
                s.timestamp,
                CASE 
                    WHEN s.symbol LIKE '%_r' THEN 'resale'
                    ELSE 'original'
                END as stock_type
            FROM stocks s
            WHERE s.quantity > 0
        `;

        query += ` ORDER BY s.symbol, s.timestamp DESC`;
        
        const values = [];
        let paramIndex = 1;
        let havingClause = '';
        
        // Construir filtros (aplicar después del UNION)
        if (symbol) {
            havingClause += havingClause ? ' AND ' : ' AND ';
            havingClause += `s.symbol ILIKE $${paramIndex}`;
            values.push(`%${symbol}%`);
            paramIndex++;
        }
        
        if (name) {
            havingClause += havingClause ? ' AND ' : ' AND ';
            havingClause += `s.long_name ILIKE $${paramIndex}`;
            values.push(`%${name}%`);
            paramIndex++;
        }
        
        if (minPrice) {
            havingClause += havingClause ? ' AND ' : ' AND ';
            havingClause += `s.price >= $${paramIndex}`;
            values.push(parseFloat(minPrice));
            paramIndex++;
        }
        
        if (maxPrice) {
            havingClause += havingClause ? ' AND ' : ' AND ';
            havingClause += `s.price <= $${paramIndex}`;
            values.push(parseFloat(maxPrice));
            paramIndex++;
        }
        
        if (minQuantity) {
            havingClause += havingClause ? ' AND ' : ' AND ';
            havingClause += `s.quantity >= $${paramIndex}`;
            values.push(parseInt(minQuantity));
            paramIndex++;
        }
        
        if (maxQuantity) {
            havingClause += havingClause ? ' AND ' : ' AND ';
            havingClause += `s.quantity <= $${paramIndex}`;
            values.push(parseInt(maxQuantity));
            paramIndex++;
        }
        
        if (date) {
            havingClause += havingClause ? ' AND ' : ' AND ';
            havingClause += `s.timestamp::date = $${paramIndex}`;
            values.push(date);
            paramIndex++;
        }
        
        // Envolver en subquery para aplicar filtros, ordenar y paginar
        const finalQuery = `
            SELECT * FROM (${query}) combined_stocks
            ${havingClause}
            ORDER BY timestamp DESC 
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `;
        values.push(count, offset);

        const result = await client.query(finalQuery, values);


        // ✅ FORMATEO MEJORADO - Consultar información de descuento para reventas
        const formattedStocks = await Promise.all(result.rows.map(async (stock) => {
            const baseStock = {
                ...stock,
                is_resale: stock.symbol.endsWith('_r'),
                original_symbol: stock.symbol.replace('_r', ''),
                purchase_id: stock.purchase_id? stock.purchase_id : null,
            };
            
            // Si es reventa, obtener información adicional de descuento
            if (baseStock.is_resale) {
                try {
                    const originalSymbol = stock.symbol.replace('_r', '');
                    const discountQuery = `
                        SELECT discount_percentage, original_price
                        FROM resale_stocks 
                        WHERE symbol = $1 
                        ORDER BY created_at DESC 
                        LIMIT 1
                    `;
                    
                    const discountResult = await client.query(discountQuery, [originalSymbol]);
                    
                    if (discountResult.rows.length > 0) {
                        const discountData = discountResult.rows[0];
                        
                        baseStock.discount_info = {
                            discount_percentage: discountData.discount_percentage,
                            original_price: discountData.original_price,
                            savings: (discountData.original_price - stock.price).toFixed(2)
                        };
                    } else {
                        baseStock.discount_info = null;
                    }
                } catch (discountError) {
                    console.error("Error obteniendo información de descuento:", discountError);
                    baseStock.discount_info = null;
                }
            } else {
                baseStock.discount_info = null;
            }
            
            return baseStock;
        }));
        res.json({ status: "success", data: formattedStocks });
    } catch (error) {
        console.error("Error fetching stocks:", error);
        res.status(500).json({ error: "Error fetching stocks" });
    }
});


// Endpoint de detalle de stock existente (antiguo)
app.get('/stocks/:symbol', async (req, res) => {
    const { symbol } = req.params;
    const { price, quantity, date } = req.query;

    try {
        // Unir stocks originales con reventas para el símbolo específico
        const isResale = symbol.endsWith('_r');
        let query = `
            SELECT 
                symbol, price, long_name, quantity, timestamp,
                CASE 
                    WHEN symbol LIKE '%_r' THEN 'resale'
                    ELSE 'original'
                END as stock_type
            FROM stocks
            WHERE symbol = $1 AND quantity > 0
            ORDER BY timestamp DESC
        `;
        
        const values = [symbol];
        let index = 2;
        
        // Aplicar filtros adicionales
        if (price) {
            query += ` AND price <= $${index}`;
            values.push(parseFloat(price));
            index++;
        }

        if (quantity) {
            query += ` AND quantity >= $${index}`;
            values.push(parseInt(quantity));
            index++;
        }

        if (date) {
            query += ` AND timestamp::date = $${index}`;
            values.push(date);
            index++;
        }

        // Limitar resultados
        query += ` LIMIT 1`;

        const result = await client.query(query, values);

        if (result.rows.length === 0) {
            return res.status(404).json({ 
                error: price || quantity || date 
                    ? "No stocks found with the filters" 
                    : "Stock not found" 
            });
        }

        // Formatear respuesta incluyendo información de reventa
        const stock = result.rows[0];

        let discountInfo = null;
        if (isResale) {
            // Buscar información de descuento en resale_stocks
            const originalSymbol = symbol.replace('_r', '');
            const discountQuery = `
                SELECT discount_percentage, original_price
                FROM resale_stocks 
                WHERE symbol = $1 
                ORDER BY created_at DESC 
                LIMIT 1
            `;
            
            const discountResult = await client.query(discountQuery, [originalSymbol]);
            
            if (discountResult.rows.length > 0) {
                const discountData = discountResult.rows[0];
                discountInfo = {
                    discount_percentage: discountData.discount_percentage,
                    original_price: discountData.original_price,
                    savings: (discountData.original_price - stock.price).toFixed(2)
                };
            }
        }

        const formattedStock = {
            ...stock,
            is_resale: isResale,
            original_symbol: isResale ? symbol.replace('_r', '') : symbol,
            discount_info: discountInfo
        };

        res.json({ status: "success", data: formattedStock });
    } catch (error) {
        console.error("Error fetching stock details:", error);
        res.status(500).json({ error: "Error fetching stock details" });
    }
});


// Endpoints de perfil y registro existentes
// ...existing code...

// Endpoint para obtener información del usuario actual
app.get('/user/profile', checkJwt, syncUser, async (req, res) => {
    try {
        const client = await pool.connect();
        
        try {
            const userQuery = `
                SELECT id, email, name, is_admin, last_login 
                FROM users 
                WHERE id = $1
            `;
            
            const result = await client.query(userQuery, [req.userId]);
            
            if (result.rows.length === 0) {
                return res.status(404).json({ error: "Usuario no encontrado" });
            }
            
            const user = result.rows[0];
            
            // Verificar admin desde token también
            const rolesFromToken = req.auth?.payload?.['https://stockmarket-app/roles'] || [];
            const isAdminFromToken = rolesFromToken.includes('admin') || rolesFromToken.includes('administrator');
            
            // Usar el valor más permisivo (si cualquiera de los dos dice que es admin)
            const isAdmin = user.is_admin || isAdminFromToken || req.isAdmin;
            
            console.log('DEBUG Profile - DB admin:', user.is_admin);
            console.log('DEBUG Profile - Token admin:', isAdminFromToken);
            console.log('DEBUG Profile - Req admin:', req.isAdmin);
            console.log('DEBUG Profile - Final admin:', isAdmin);
            
            res.json({
                id: user.id,
                email: user.email,
                name: user.name,
                isAdmin: isAdmin,
                lastLogin: user.last_login
            });
            
        } finally {
            client.release();
        }
    } catch (error) {
        console.error('Error obteniendo perfil:', error);
        res.status(500).json({ error: 'Error obteniendo información del usuario' });
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
// Comprar acciones (versión corregida para WebPay)
app.post('/stocks/buy', checkJwt, handleAuthError, syncUser, async (req, res) => {
    try {
        const { symbol, quantity } = req.body;

        if (!symbol || !quantity || quantity <= 0) {
            return res.status(400).json({ error: "Solicitud de compra inválida" });
        }

        // ✅ VERIFICAR AUTENTICACIÓN ANTES DE CONTINUAR
        if (!req.userId) {
            console.error("❌ Usuario no autenticado correctamente");
            return res.status(401).json({ 
                error: "Usuario no autenticado",
                details: "Token de autenticación requerido"
            });
        }

        const isResale = symbol.endsWith('_r');
        const isAdmin = req.isAdmin || req.auth?.payload?.['https://stockmarket-app/roles']?.includes('admin');

        console.log(`Procesando solicitud de compra: ${quantity} acciones de ${symbol}`);

        let stock;
        let stockQuery;
        let totalCost;

        if (isResale) {

            console.log(`Procesando compra de reventa: ${symbol}`);

            const stockQuery = `
                SELECT * FROM stocks 
                WHERE symbol = $1 AND quantity >= $2
                ORDER BY timestamp DESC 
                LIMIT 1
            `;

            const stockResult = await client.query(stockQuery, [symbol, quantity]);

            if (stockResult.rows.length === 0) {
                return res.status(404).json({ error: "Acción de reventa no encontrada o cantidad insuficiente" });
            }

            stock = stockResult.rows[0];
            totalCost = stock.price * quantity;
            // TODO: lógica especifica para compra de reventa (usuarios regulares)
            console.log(`Reventa encontrada: ${stock.long_name}, precio: $${stock.price}, disponible: ${stock.quantity}`);
        } else {
            if (!isAdmin) {
                return res.status(403).json({ error: "No tienes permiso para comprar acciones originales" });
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
            
            stock = stockResult.rows[0];
            
            if (stock.quantity < quantity) {
                return res.status(400).json({ error: "No hay suficientes acciones disponibles" });
            }
            
            totalCost = stock.price * quantity;
        }

        // ✅ SIN VERIFICACIÓN DE WALLET - El pago se valida via WebPay
        console.log(`💰 Total a pagar: $${totalCost} (será validado por WebPay)`);
        
        // Generar UUID para la solicitud
        const requestId = uuidv4();
        const shortRequestId = requestId.split('-')[0]; 
        const buyOrder = `${symbol}-${shortRequestId}`;
        const sessionId = `session-${req.userId}-${Date.now()}`;
        const returnUrl = process.env.TRANSBANK_RETURN_URL || 'http://localhost:3000/webpay/return';

        // 1. CREAR TRANSACCIÓN WEBPAY
        const webpayResult = await TransbankService.createTransaction(
            buyOrder,
            sessionId,
            totalCost,
            returnUrl
        );
            
        if (!webpayResult.success) {
            console.error("Error al crear transacción webpay:", webpayResult.error);
            return res.status(500).json({
                error: "Error al procesar el pago",
                details: webpayResult.error
            });
        }

        console.log(`Transacción WebPay creada exitosamente: ${webpayResult.token}`);

        // 2. GUARDAR TRANSACCIÓN EN BASE DE DATOS
        const webpayTransactionQuery = `
            INSERT INTO webpay_transactions
            (user_id, buy_order, session_id, token_ws, amount, status, symbol, quantity, request_id, created_at)
            VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, $8, NOW())
            RETURNING id
        `;
            
        await client.query(webpayTransactionQuery, [
            req.userId,
            buyOrder,
            sessionId,
            webpayResult.token,
            totalCost,
            symbol,
            quantity,
            requestId
        ]);

        // 3. CREAR SOLICITUD DE COMPRA EN PURCHASE_REQUESTS
        const purchaseQuery = `
            INSERT INTO purchase_requests 
            (request_id, user_id, symbol, quantity, price, status, is_resale) 
            VALUES ($1, $2, $3, $4, $5, 'PENDING', $6)
            RETURNING id
        `;
            
        await client.query(purchaseQuery, [
            requestId, 
            req.userId,
            symbol, 
            quantity, 
            stock.price,
            isResale
        ]);

        // 4. RESERVAR ACCIONES TEMPORALMENTE
        console.log(`📊 Acciones disponibles: ${stock.quantity}, solicitadas: ${quantity}`);

        console.log(`💾 Solicitud de compra creada: ${requestId}, esperando confirmación de pago WebPay`);
        // 6. REGISTRAR EVENTO
        await logEvent('PURCHASE_REQUEST', {
            request_id: requestId,
            user_id: req.userId,
            symbol: symbol,
            quantity: quantity,
            price: stock.price,
            group_id: GROUP_ID,
            webpay_token: webpayResult.token,
            deposit_token: webpayResult.token,
            purchase_type: isResale ? 'resale' : 'original',
            is_admin_purchase: isAdmin
        });
        
        // 7. RETORNAR DATOS PARA REDIRECCIÓN A WEBPAY
        res.json({
            message: isResale ? 
                "Transacción de pago para reventa creada exitosamente" : 
                "Transacción de pago creada exitosamente",
            requiresPayment: true,
            webpayUrl: webpayResult.url,
            webpayToken: webpayResult.token,
            request_id: requestId,
            purchase_type: isResale ? 'resale' : 'original',
            stock_info: {
                symbol: stock.symbol,
                long_name: stock.long_name,
                quantity: quantity,
                price: stock.price,
                total_cost: totalCost
            }
        });
            
    } catch (error) {
        console.error("Error procesando compra:", error);
        // ✅ MEJOR MANEJO DE ERRORES DE AUTENTICACIÓN
        if (error.message?.includes('jwt') || error.message?.includes('token') || error.message?.includes('Unauthorized')) {
            return res.status(401).json({
                error: "Token de autenticación inválido o expirado",
                details: "Por favor, inicia sesión nuevamente",
                auth_error: true
            });
        }
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
app.get('/purchase/:requestId/estimation', checkJwt, syncUser, async (req, res) => {
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

// Endpoint para crear reventa de acciones (solo administradores)
app.post('/admin/stocks/resale', checkJwt, syncUser, requireAdmin, async (req, res) => {
    try {
        const { purchase_id, quantity, discount_percentage } = req.body;
        console.log('DEBUGGGGGGGGGGGGGGGGGGGGGGGG')
        console.log('purchase_id:', purchase_id);
        
        // Validaciones
        if (!purchase_id || !quantity || quantity <= 0) {
            return res.status(400).json({ error: "Datos de reventa inválidos" });
        }
        
        if (!discount_percentage || discount_percentage < 0 || discount_percentage > 10) {
            return res.status(400).json({ 
                error: "El descuento debe estar entre 0% y 10%" 
            });
        }
        
        // Verificar que la compra existe y pertenece al admin
        const purchaseQuery = `
            SELECT pr.*, s.long_name 
            FROM purchase_requests pr
            LEFT JOIN stocks s ON pr.symbol = s.symbol
            WHERE pr.id = $1 AND pr.user_id = $2 AND pr.status = 'ACCEPTED'
            ORDER BY s.timestamp DESC
            LIMIT 1
        `;
        
        const purchaseResult = await client.query(purchaseQuery, [purchase_id, req.userId]);
        
        if (purchaseResult.rows.length === 0) {
            return res.status(404).json({ 
                error: "Compra no encontrada o no autorizada" 
            });
        }
        
        const purchase = purchaseResult.rows[0];

        // Calcular precio de reventa
        const originalPrice = parseFloat(purchase.price);
        const discountAmount = originalPrice * (discount_percentage / 100);
        const resalePrice = originalPrice - discountAmount;

        // Crear stock con symbol modificado
        const resaleSymbol = `${purchase.symbol}_r`;
        
        // Verificar si ya hay una reventa para esta compra
        const existingResaleQuery = `
            SELECT quantity FROM stocks 
            WHERE symbol = $1 
            ORDER BY timestamp DESC
            LIMIT 1
        `;

        const existingResale = await client.query(existingResaleQuery, [resaleSymbol]);
        const alreadyForSale = existingResale.rows[0]?.quantity || 0;

        if (existingResale.rows.length > 0) {
            // Actualizar stock existente (sumar cantidad)
            const newQuantity = existingResale.rows[0].quantity + quantity;
            
            await client.query(`
                INSERT INTO stocks (symbol, price, long_name, quantity, timestamp)
                VALUES ($1, $2, $3, $4, NOW())
            `, [resaleSymbol, resalePrice, purchase.long_name, newQuantity]);
            
        } else {
            // Crear nueva stock de reventa
            await client.query(`
                INSERT INTO stocks (symbol, price, long_name, quantity, timestamp)
                VALUES ($1, $2, $3, $4, NOW())
            `, [resaleSymbol, resalePrice, purchase.long_name, quantity]);
        }

        // Mantener registro en resale_stocks para tracking (opcional)
        await client.query(`
            INSERT INTO resale_stocks 
            (original_purchase_id, admin_user_id, symbol, quantity, original_price, 
             discount_percentage, resale_price, long_name, available_quantity)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
            purchase_id, req.userId, purchase.symbol, quantity, originalPrice,
            discount_percentage, resalePrice, purchase.long_name, quantity
        ]);
        
        console.log(`Reventa creada: ${quantity} acciones de ${purchase.symbol} con ${discount_percentage}% descuento`);
        
        // Registrar evento
        await logEvent('ADMIN_RESALE', {
            purchase_id: purchase_id,
            admin_id: req.userId,
            symbol: resaleSymbol,
            original_symbol: purchase.symbol,
            quantity: quantity,
            original_price: originalPrice,
            discount_percentage: discount_percentage,
            resale_price: resalePrice
        });
        
        res.json({
            message: "Reventa creada exitosamente",
            symbol: purchase.symbol,
            quantity: quantity,
            original_price: originalPrice,
            discount_percentage: discount_percentage,
            resale_price: resalePrice,
            savings: discountAmount.toFixed(2)
        });
        
    } catch (error) {
        console.error("Error creando reventa:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

// Endpoint para actualizar descuento de reventa (solo administradores)
app.patch('/admin/stocks/resale/:resale_id', checkJwt, syncUser, requireAdmin, async (req, res) => {
    try {
        const { resale_id } = req.params;
        const { discount_percentage } = req.body;
        console.log('DEBUGGGGGGGGGGGGGGGGGGGGGGGG')
        console.log('resale_id:', resale_id);
        
        // Validaciones
        if (!discount_percentage || discount_percentage < 0 || discount_percentage > 10) {
            return res.status(400).json({ 
                error: "El descuento debe estar entre 0% y 10%" 
            });
        }
        
        // Verificar que la reventa existe (cualquier admin puede editarla)
        const resaleQuery = `
            SELECT rs.*, pr.symbol, pr.price as original_price 
            FROM resale_stocks rs
            JOIN purchase_requests pr ON rs.original_purchase_id = pr.id
            WHERE rs.original_purchase_id = $1
        `;
        
        const resaleResult = await client.query(resaleQuery, [resale_id]);
        
        if (resaleResult.rows.length === 0) {
            return res.status(404).json({ 
                error: "Reventa no encontrada" 
            });
        }
        
        const resale = resaleResult.rows[0];
        
        // Calcular nuevo precio de reventa
        const originalPrice = parseFloat(resale.original_price);
        const newDiscountAmount = originalPrice * (discount_percentage / 100);
        const newResalePrice = originalPrice - newDiscountAmount;
        
        // Symbol de la reventa
        const resaleSymbol = `${resale.symbol}_r`;
        
        // 1. Actualizar en resale_stocks
        await client.query(`
            UPDATE resale_stocks 
            SET discount_percentage = $1, 
                resale_price = $2,
                updated_at = NOW()
            WHERE original_purchase_id = $3
        `, [discount_percentage, newResalePrice, resale_id]);
        
        // 2. Crear nueva entrada en stocks con el precio actualizado
        await client.query(`
            INSERT INTO stocks (symbol, price, long_name, quantity, timestamp)
            VALUES ($1, $2, $3, $4, NOW())
        `, [resaleSymbol, newResalePrice, resale.long_name, resale.available_quantity]);
        
        console.log(`Descuento actualizado para ${resale.symbol}: ${discount_percentage}%`);
        
        // Registrar evento
        await logEvent('ADMIN_RESALE_UPDATE', {
            purchase_id: resale_id,
            admin_id: req.userId,
            symbol: resale.symbol,
            old_discount: resale.discount_percentage,
            new_discount: discount_percentage,
            old_price: resale.resale_price,
            new_price: newResalePrice
        });
        
        // ✅ RESPUESTA COMPLETA para que el frontend actualice la UI
        res.json({
            status: "success",
            message: "Descuento actualizado exitosamente",
            data: {
                purchase_id: resale_id,
                symbol: resale.symbol,
                resale_symbol: resaleSymbol,
                old_discount: resale.discount_percentage,
                new_discount: discount_percentage,
                old_price: resale.resale_price,
                new_price: newResalePrice,
                original_price: originalPrice,
                savings: newDiscountAmount.toFixed(2),
                quantity: resale.available_quantity,
                long_name: resale.long_name
            }
        });
        
    } catch (error) {
        console.error("Error actualizando descuento:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.listen(port, '0.0.0.0',() => {
    console.log(`Servidor ejecutándose en http://localhost:${port}`);
});