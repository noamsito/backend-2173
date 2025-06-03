-- migration_boletas.sql
-- Migración para agregar soporte de boletas a las tablas existentes

BEGIN;

-- Agregar columnas para boletas en purchase_requests
ALTER TABLE purchase_requests 
ADD COLUMN IF NOT EXISTS boleta_id UUID,
ADD COLUMN IF NOT EXISTS boleta_url TEXT,
ADD COLUMN IF NOT EXISTS boleta_generated_at TIMESTAMP;

-- Crear índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_purchase_requests_boleta_id 
ON purchase_requests(boleta_id) 
WHERE boleta_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchase_requests_user_status 
ON purchase_requests(user_id, status);

-- Crear tabla para tracking de boletas generadas
CREATE TABLE IF NOT EXISTS boletas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    boleta_id UUID NOT NULL UNIQUE,
    purchase_request_id UUID REFERENCES purchase_requests(request_id),
    user_id INTEGER REFERENCES users(id),
    
    -- Información de la boleta
    s3_key TEXT NOT NULL,
    download_url TEXT NOT NULL,
    file_size BIGINT,
    
    -- Información de la compra
    stock_symbol VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL,
    price_per_share DECIMAL(10, 2) NOT NULL,
    total_amount DECIMAL(10, 2) NOT NULL,
    
    -- Metadatos
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    download_count INTEGER DEFAULT 0,
    last_downloaded_at TIMESTAMP,
    
    -- Estado de la boleta
    status VARCHAR(20) DEFAULT 'generated', -- generated, downloaded, expired
    expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '1 year'),
    
    -- Auditoría
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para la tabla boletas
CREATE INDEX IF NOT EXISTS idx_boletas_user_id ON boletas(user_id);
CREATE INDEX IF NOT EXISTS idx_boletas_purchase_request_id ON boletas(purchase_request_id);
CREATE INDEX IF NOT EXISTS idx_boletas_status ON boletas(status);
CREATE INDEX IF NOT EXISTS idx_boletas_generated_at ON boletas(generated_at);

-- Función para actualizar updated_at automáticamente
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger para actualizar updated_at en boletas
DROP TRIGGER IF EXISTS update_boletas_updated_at ON boletas;
CREATE TRIGGER update_boletas_updated_at 
    BEFORE UPDATE ON boletas 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- Vista para facilitar consultas de compras con boletas
CREATE OR REPLACE VIEW purchases_with_boletas AS
SELECT 
    pr.id,
    pr.request_id,
    pr.user_id,
    pr.symbol,
    pr.quantity,
    pr.price,
    pr.status as purchase_status,
    pr.created_at as purchase_date,
    pr.updated_at as purchase_updated,
    
    -- Información del usuario
    u.name as user_name,
    u.email as user_email,
    
    -- Información de la acción
    s.long_name as stock_name,
    
    -- Información de la boleta
    b.boleta_id,
    b.download_url,
    b.file_size,
    b.download_count,
    b.generated_at as boleta_generated_at,
    b.last_downloaded_at,
    b.status as boleta_status,
    b.expires_at as boleta_expires_at,
    
    -- Campos calculados
    (pr.quantity * pr.price) as total_amount,
    CASE 
        WHEN b.boleta_id IS NOT NULL THEN true 
        ELSE false 
    END as has_boleta,
    CASE 
        WHEN b.expires_at < CURRENT_TIMESTAMP THEN true 
        ELSE false 
    END as boleta_expired
    
FROM purchase_requests pr
JOIN users u ON pr.user_id = u.id
LEFT JOIN boletas b ON pr.request_id = b.purchase_request_id
LEFT JOIN (
    SELECT DISTINCT ON (symbol) symbol, long_name, price, timestamp
    FROM stocks
    ORDER BY symbol, timestamp DESC
) s ON pr.symbol = s.symbol
WHERE pr.status = 'ACCEPTED';

-- Función para limpiar boletas expiradas
CREATE OR REPLACE FUNCTION cleanup_expired_boletas()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    -- Marcar boletas expiradas
    UPDATE boletas 
    SET status = 'expired', updated_at = CURRENT_TIMESTAMP
    WHERE expires_at < CURRENT_TIMESTAMP 
    AND status != 'expired';
    
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- Función para registrar descarga de boleta
CREATE OR REPLACE FUNCTION register_boleta_download(boleta_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
    UPDATE boletas 
    SET 
        download_count = download_count + 1,
        last_downloaded_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE boleta_id = boleta_uuid
    AND status = 'generated'
    AND expires_at > CURRENT_TIMESTAMP;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Insertar datos de ejemplo para testing (solo en desarrollo)
-- Comentar esta sección en producción
/*
DO $$
BEGIN
    -- Solo insertar si estamos en un entorno de desarrollo
    IF current_database() LIKE '%dev%' OR current_database() LIKE '%test%' THEN
        
        -- Verificar si hay compras ACCEPTED sin boletas
        INSERT INTO boletas (
            boleta_id,
            purchase_request_id,
            user_id,
            s3_key,
            download_url,
            stock_symbol,
            quantity,
            price_per_share,
            total_amount,
            status
        )
        SELECT 
            gen_random_uuid(),
            pr.request_id,
            pr.user_id,
            'boletas/example-' || pr.request_id || '.pdf',
            'https://example-bucket.s3.amazonaws.com/boletas/example-' || pr.request_id || '.pdf',
            pr.symbol,
            pr.quantity,
            pr.price,
            (pr.quantity * pr.price),
            'generated'
        FROM purchase_requests pr
        WHERE pr.status = 'ACCEPTED'
        AND NOT EXISTS (
            SELECT 1 FROM boletas b 
            WHERE b.purchase_request_id = pr.request_id
        )
        LIMIT 3; -- Solo crear 3 ejemplos
        
        RAISE NOTICE 'Datos de ejemplo insertados para development';
    END IF;
END $$;
*/

-- Verificar que la migración se aplicó correctamente
DO $$
BEGIN
    -- Verificar columnas agregadas
    IF NOT EXISTS (
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'purchase_requests' 
        AND column_name = 'boleta_id'
    ) THEN
        RAISE EXCEPTION 'Migración falló: columna boleta_id no existe';
    END IF;
    
    -- Verificar tabla boletas
    IF NOT EXISTS (
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_name = 'boletas'
    ) THEN
        RAISE EXCEPTION 'Migración falló: tabla boletas no existe';
    END IF;
    
    -- Verificar vista
    IF NOT EXISTS (
        SELECT table_name 
        FROM information_schema.views 
        WHERE table_name = 'purchases_with_boletas'
    ) THEN
        RAISE EXCEPTION 'Migración falló: vista purchases_with_boletas no existe';
    END IF;
    
    RAISE NOTICE 'Migración de boletas completada exitosamente';
END $$;

COMMIT;

-- Script adicional para rollback si es necesario
-- rollback_boletas.sql
/*
BEGIN;

-- Eliminar vista
DROP VIEW IF EXISTS purchases_with_boletas;

-- Eliminar funciones
DROP FUNCTION IF EXISTS cleanup_expired_boletas();
DROP FUNCTION IF EXISTS register_boleta_download(UUID);
DROP FUNCTION IF EXISTS update_updated_at_column() CASCADE;

-- Eliminar tabla boletas
DROP TABLE IF EXISTS boletas;

-- Eliminar columnas de purchase_requests
ALTER TABLE purchase_requests 
DROP COLUMN IF EXISTS boleta_id,
DROP COLUMN IF EXISTS boleta_url,
DROP COLUMN IF EXISTS boleta_generated_at;

COMMIT;
*/