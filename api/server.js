import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';

const Pool = pg.Pool;

const app = express();
const port = 3000;

dotenv.config();
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'admin123',
    database: process.env.DB_NAME || 'stock_data',
    port: parseInt(process.env.DB_PORT || '5432'),
});

app.use(cors());
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

// const createTableQuery = `
//     CREATE TABLE IF NOT EXISTS stocks (
//         id SERIAL PRIMARY KEY,
//         symbol VARCHAR(50),
//         price FLOAT,
//         short_name VARCHAR(100),
//         long_name VARCHAR(255),
//         quantity INT,
//         timestamp TIMESTAMP
//     );
// `;

// client.query(createTableQuery)
//     .then(() => console.log("Table 'stocks' is ready."))
//     .catch((err) => console.error("Error creating table:", err));

    
app.post('/stocks', async (req, res) => {
    const { topic, message } = req.body;

    if (!topic || !message) {
        return res.status(400).json({ error: "Datos incompletos" });
    }

    try {
        const stockData = JSON.parse(message);

        const insertQuery = `
            INSERT INTO stocks (symbol, price, short_name, long_name, quantity, timestamp)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING *;
        `;

        const values = [
            stockData.symbol,
            stockData.price,
            stockData.shortName,
            stockData.longName,
            stockData.quantity,
            stockData.timestamp,
        ];

        const result = await client.query(insertQuery, values);

        console.log("New stock data saved to database:", result.rows[0]);
        res.json({ status: "success", data: result.rows[0] });
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

app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});