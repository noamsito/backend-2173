-- Script para insertar usuario de prueba en modo bypass
-- Este script debe ejecutarse cuando se usa BYPASS_AUTH=true

-- Insertar usuario de prueba si no existe (CON ROL DE ADMINISTRADOR)
INSERT INTO users (id, auth0_id, email, name, role, created_at, last_login)
VALUES (1, 'test-user-id', 'test@ejemplo.com', 'Administrador de Prueba', 'admin', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    name = EXCLUDED.name,
    role = 'admin',
    last_login = CURRENT_TIMESTAMP;

-- Crear o actualizar wallet para el usuario de prueba
INSERT INTO wallet (user_id, balance, created_at, updated_at)
VALUES (1, 10000000, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (user_id) DO UPDATE SET
    updated_at = CURRENT_TIMESTAMP;

-- Verificar los datos insertados
SELECT 'Usuario creado:' as info, u.*, w.balance as wallet_balance
FROM users u
LEFT JOIN wallet w ON u.id = w.user_id
WHERE u.id = 1; 