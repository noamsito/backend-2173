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

-- NUEVAS TABLAS PARA SISTEMA DE SUBASTAS E INTERCAMBIOS (E3)

-- Tabla para subastas
CREATE TABLE IF NOT EXISTS auctions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id INTEGER NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    starting_price DECIMAL(10, 2) NOT NULL CHECK (starting_price > 0),
    current_price DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED', 'CANCELLED')),
    winner_group_id INTEGER,
    start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para ofertas en subastas
CREATE TABLE IF NOT EXISTS auction_bids (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
    bidder_group_id INTEGER NOT NULL,
    bid_amount DECIMAL(10, 2) NOT NULL CHECK (bid_amount > 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para intercambios entre grupos
CREATE TABLE IF NOT EXISTS exchanges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    origin_group_id INTEGER NOT NULL,
    target_group_id INTEGER NOT NULL,
    offered_symbol VARCHAR(10) NOT NULL,
    offered_quantity INTEGER NOT NULL CHECK (offered_quantity > 0),
    requested_symbol VARCHAR(10) NOT NULL,
    requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED')),
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla para propuestas de intercambio siguiendo el formato exacto del enunciado
CREATE TABLE IF NOT EXISTS auction_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auction_id UUID NOT NULL,
    proposer_group_id INTEGER NOT NULL,
    offered_symbol VARCHAR(10) NOT NULL,
    offered_quantity INTEGER NOT NULL CHECK (offered_quantity > 0),
    offered_timestamp TIMESTAMP NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (auction_id) REFERENCES auctions(id)
);

-- Tabla para solicitudes de compra grupal de administrador
CREATE TABLE IF NOT EXISTS group_purchase_requests (
    request_id UUID PRIMARY KEY,
    admin_user_id INTEGER NOT NULL,
    group_id INTEGER NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    price DECIMAL(12,2) NOT NULL,
    total_cost DECIMAL(12,2) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (admin_user_id) REFERENCES users(id)
);

-- Tabla para rastrear ofertas/subastas externas de otros grupos
CREATE TABLE IF NOT EXISTS external_auctions (
    auction_id UUID PRIMARY KEY,
    group_id INTEGER NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    quantity INTEGER NOT NULL,
    timestamp TIMESTAMP NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED', 'CANCELLED')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para mejorar performance
CREATE INDEX idx_auctions_group_id ON auctions(group_id);
CREATE INDEX idx_auctions_status ON auctions(status);
CREATE INDEX idx_auctions_symbol ON auctions(symbol);
CREATE INDEX idx_auction_bids_auction_id ON auction_bids(auction_id);
CREATE INDEX idx_exchanges_origin_group ON exchanges(origin_group_id);
CREATE INDEX idx_exchanges_target_group ON exchanges(target_group_id);
CREATE INDEX idx_exchanges_status ON exchanges(status);
CREATE INDEX idx_auction_proposals_auction_id ON auction_proposals(auction_id);
CREATE INDEX idx_auction_proposals_proposer_group ON auction_proposals(proposer_group_id);
CREATE INDEX idx_auction_proposals_status ON auction_proposals(status);
CREATE INDEX idx_group_purchase_requests_group_id ON group_purchase_requests(group_id);
CREATE INDEX idx_group_purchase_requests_admin_user ON group_purchase_requests(admin_user_id);
CREATE INDEX idx_group_purchase_requests_status ON group_purchase_requests(status);
CREATE INDEX idx_external_auctions_group_id ON external_auctions(group_id);
CREATE INDEX idx_external_auctions_status ON external_auctions(status);
CREATE INDEX idx_external_auctions_symbol ON external_auctions(symbol);