import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import { auth } from 'express-oauth2-jwt-bearer';

const Pool = pg.Pool;

const app = express();
const port = 3000;

dotenv.config();

// Configurar middleware de autenticación Auth0
const checkJwt = auth({
    audience: 'https://stockmarket-api/',
    issuerBaseURL: 'https://dev-ouxdigl1l6bn6n3r.us.auth0.com/',
    tokenSigningAlg: 'RS256'
});

// Resto de la configuración de DB
const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
});

app.use(cors({
    origin: ['http://localhost:80', 'http://localhost', 'http://localhost:5173'],
    credentials: true
  }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const client = await pool.connect();

try {
    if (client) {
        console.log("Successfully connected to the database.");
    } else {
        throw new Error("Failed to connect to the database.");
    }
} catch (error) {
    console.error("Error connecting to the database:", error);
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
        }else if (kind === 'UPDATE') {
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
            SELECT * FROM stocks
            ORDER BY timestamp DESC
            LIMIT $1 OFFSET $2;
        `;
        const result = await client.query(query, [count, offset]);
        res.json({ status: "success", data: result.rows });
    } catch (error) {
        console.error("Error fetching stocks:", error);
        res.status(500).json({ error: "Error fetching stocks" });
    }
});

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
        console.error("Error fetching stock details:", error, "Values:", values);
        res.status(500).json({ error: "Error fetching stock details" });
    }
});

app.get('/user/profile', checkJwt, async (req, res) => {
    try {
        // El token ya está verificado por el middleware checkJwt
        // auth0Id está disponible en req.auth.sub
        const auth0Id = req.auth.sub;
        
        // Buscar usuario en la base de datos
        const userQuery = `SELECT * FROM users WHERE auth0_id = $1`;
        const userResult = await client.query(userQuery, [auth0Id]);
        
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: "Usuario no encontrado" });
        }
        
        const user = userResult.rows[0];
        // No devolvemos información sensible
        delete user.password;
        
        res.json({ status: "success", data: user });
    } catch (error) {
        console.error("Error obteniendo perfil de usuario:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.post('/users/register', checkJwt, async (req, res) => {
    try {
        const { name, email } = req.body;
        const auth0Id = req.auth.sub; // ID de Auth0 del token JWT
        
        // Verificar si el usuario ya existe
        const checkQuery = `SELECT * FROM users WHERE auth0_id = $1`;
        const checkResult = await client.query(checkQuery, [auth0Id]);
        
        if (checkResult.rows.length > 0) {
            return res.status(409).json({ error: "El usuario ya existe" });
        }
        
        // Insertar nuevo usuario
        const insertQuery = `
            INSERT INTO users (auth0_id, email, name, last_login)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            RETURNING id, email, name, created_at;
        `;
        
        const insertResult = await client.query(insertQuery, [auth0Id, email, name]);
        
        res.status(201).json({ 
            status: "success", 
            message: "Usuario registrado correctamente", 
            data: insertResult.rows[0]
        });
        
    } catch (error) {
        console.error("Error registrando usuario:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});