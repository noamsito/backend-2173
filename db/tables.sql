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

-- ACTUALIZAR: purchases para que sea compatible con users.id (INTEGER)
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id),  -- Cambiar a INTEGER para coincidir con users.id
  symbol VARCHAR(20) NOT NULL,
  quantity INTEGER NOT NULL,
  price_at_purchase FLOAT NOT NULL,
  status VARCHAR(20) DEFAULT 'PENDING',  -- AGREGAR ESTA LÍNEA
  created_at TIMESTAMP DEFAULT NOW()
);


-- Tabla de transacciones de Webpay
CREATE TABLE IF NOT EXISTS webpay_transactions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,  -- Cambiar de VARCHAR a INTEGER si es necesario
    buy_order VARCHAR(255) UNIQUE NOT NULL,
    session_id VARCHAR(255) NOT NULL,
    token_ws VARCHAR(255),
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(50) DEFAULT 'pending',
    symbol VARCHAR(10),
    quantity INTEGER,
    request_id VARCHAR(255),
    authorization_code VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para reventa de stocks
CREATE TABLE IF NOT EXISTS resale_stocks (
    id SERIAL PRIMARY KEY,
    original_purchase_id INTEGER REFERENCES purchase_requests(id),
    admin_user_id INTEGER REFERENCES users(id),
    symbol VARCHAR(10) NOT NULL,
    quantity INTEGER NOT NULL,
    original_price DECIMAL(10,2) NOT NULL,
    discount_percentage DECIMAL(5,2) NOT NULL CHECK (discount_percentage >= 0 AND discount_percentage <= 10),
    resale_price DECIMAL(10,2) NOT NULL,
    long_name VARCHAR(255),
    available_quantity INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- AGREGAR AL FINAL: Columna status a purchases también (para compatibilidad con Sequelize)
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'PENDING';

-- Crear índice para mejorar consultas por status en purchases
CREATE INDEX IF NOT EXISTS idx_purchases_status ON purchases(status);

-- Actualizar registros existentes que no tengan status en purchases
UPDATE purchases SET status = 'PENDING' WHERE status IS NULL;

-- AGREGAR AL FINAL: Columna status si no existe (para compatibilidad con el monitor)
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'PENDING';

-- Crear índice para mejorar consultas por status
CREATE INDEX IF NOT EXISTS idx_purchase_requests_status ON purchase_requests(status);

-- Actualizar registros existentes que no tengan status
UPDATE purchase_requests SET status = 'PENDING' WHERE status IS NULL;

-- Webpay
CREATE INDEX IF NOT EXISTS idx_webpay_user_id ON webpay_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_webpay_token ON webpay_transactions(token_ws);
CREATE INDEX IF NOT EXISTS idx_webpay_request_id ON webpay_transactions(request_id);
CREATE INDEX IF NOT EXISTS idx_webpay_status ON webpay_transactions(status);

-- Database connection settings
\set DB_NAME 'stock_data'
\set DB_USER 'postgres'
\set DB_PASSWORD 'tu_password'
\set DB_HOST 'localhost'
\set DB_PORT '5432'

-- AGREGAR AL FINAL DE db/tables.sql

-- Columna para tracking de jobs de estimación
ALTER TABLE purchase_requests 
ADD COLUMN IF NOT EXISTS estimation_job_id VARCHAR(255);

-- Índice para consultas rápidas de estimaciones
CREATE INDEX IF NOT EXISTS idx_purchase_requests_estimation_job 
ON purchase_requests(estimation_job_id);

-- Comentario para tracking
COMMENT ON COLUMN purchase_requests.estimation_job_id IS 'ID del job de estimación en el sistema de workers';

-- Agregar columna a users para identificar administradores
ALTER TABLE users ADD COLUMN is_admin BOOLEAN DEFAULT FALSE;

-- Agregar columna para identificar reventas en purchase_requests
ALTER TABLE purchase_requests ADD COLUMN is_resale BOOLEAN DEFAULT FALSE;

ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS is_resale BOOLEAN DEFAULT FALSE;
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS reason TEXT;
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;