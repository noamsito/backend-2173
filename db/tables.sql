DO
$$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'stock_data') THEN
        CREATE DATABASE stock_data;
    END IF;
END
$$;

\c stock_data;

CREATE TABLE IF NOT EXISTS stocks (
    id SERIAL PRIMARY KEY,
    symbol VARCHAR(50),
    price FLOAT,
    long_name VARCHAR(255),
    quantity INT,
    timestamp TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    auth0_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    email VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wallet (
    id SERIAL PRIMARY KEY, 
    user_id INTEGER REFERENCES users(id) UNIQUE,
    balance FLOAT DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS purchase_requests (
    id SERIAL PRIMARY KEY,
    request_id UUID NOT NULL UNIQUE,
    user_id INTEGER REFERENCES users(id),
    symbol VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL,
    price FLOAT NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS events (
    id SERIAL PRIMARY KEY,
    type VARCHAR(50) NOT NULL,
    details JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);