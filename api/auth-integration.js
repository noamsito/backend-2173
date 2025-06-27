import { ManagementClient } from 'auth0';
import dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

// Configuración del cliente de Management API de Auth0
const auth0Management = new ManagementClient({
  domain: process.env.AUTH0_DOMAIN || 'dev-ouxdigl1l6bn6n3r.us.auth0.com',
  clientId: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  scope: 'read:users update:users'
});

/**
 * Obtiene información de usuario desde Auth0 userinfo endpoint
 * @param {string} token - Token de acceso 
 * @returns {Promise<Object|null>} - Datos del usuario o null en caso de error
 */
async function getUserInfoFromAuth0(token) {
  try {
    const userInfoURL = 'https://dev-ouxdigl1l6bn6n3r.us.auth0.com/userinfo';
    const response = await fetch(userInfoURL, {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    if (!response.ok) {
      throw new Error(`Error obteniendo userinfo: ${response.status}`);
    }

    const userInfo = await response.json();
    console.log("Información de usuario obtenida de Auth0:", userInfo);
    return userInfo;
  } catch (error) {
    console.error("Error obteniendo userinfo:", error);
    return null;
  }
}

/**
 * Intenta extraer el ID de Auth0 de un token JWT
 * @param {string} token - Token JWT
 * @returns {string|null} - ID de Auth0 o null si no se pudo extraer
 */
function extractAuth0IdFromToken(token) {
  try {
    if (!token) return null;
    
    // Quitar 'Bearer ' si existe
    const tokenStr = token.replace(/^Bearer\s+/i, '');
    
    // Los tokens JWT tienen 3 partes separadas por puntos: header.payload.signature
    const parts = tokenStr.split('.');
    if (parts.length !== 3) return null;
    
    // La segunda parte es el payload codificado en base64
    const payload = Buffer.from(parts[1], 'base64').toString('utf8');
    const decodedPayload = JSON.parse(payload);
    
    return decodedPayload?.sub;
  } catch (error) {
    console.error('Error extrayendo sub del token:', error);
    return null;
  }
}

// Función para verificar si es admin
export function isAdmin(req) {
  const roles = req.auth?.payload?.['https://stockmarket-app/roles'] || [];
  return roles.includes('admin') || roles.includes('administrator');
}

// Middleware para verificar permisos de administrador
export function requireAdmin(req, res, next) {
  if (!isAdmin(req)) {
    return res.status(403).json({ 
      error: "Acceso denegado. Se requieren permisos de administrador." 
    });
  }
  next();
}

/**
 * Middleware para sincronizar usuarios de Auth0 con la base de datos local
 * @param {Object} pool - Pool de conexión a PostgreSQL
 * @returns {Function} - Middleware de Express
 */
// ...existing code...

export function createSyncUserMiddleware(pool) {
  return async (req, res, next) => {
    try {
      // Extraer token sin el prefijo "Bearer"
      const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
      
      // Extraer ID de Auth0 del token JWT
      let auth0Id = req.auth?.payload?.sub || req.auth?.sub;

      // Verificar roles de admin con múltiples variaciones
      const roles = req.auth?.payload?.['https://stockmarket-app/roles'] || 
                   req.auth?.payload?.roles || 
                   req.auth?.payload?.['https://stockmarket-app/app_metadata']?.roles || 
                   [];
      
      const isUserAdmin = roles.includes('admin') || 
                         roles.includes('administrator') || 
                         roles.includes('Admin') ||
                         req.auth?.payload?.['https://stockmarket-app/app_metadata']?.roles?.includes('admin');

      console.log('DEBUG - Token completo:', JSON.stringify(req.auth?.payload, null, 2));
      console.log('DEBUG - Roles encontrados:', roles);
      console.log('DEBUG - Es admin:', isUserAdmin);
      
      // Si no tenemos auth0Id desde req.auth, intentamos extraerlo manualmente del token
      if (!auth0Id && req.headers.authorization) {
        auth0Id = extractAuth0IdFromToken(req.headers.authorization);
      }
      
      // Si aún no tenemos ID, verificamos si viene en el body como respaldo
      if (!auth0Id && req.body && req.body.auth0Id) {
        auth0Id = req.body.auth0Id;
      }
    
      
      if (!auth0Id) {
        return res.status(401).json({ 
          error: "Token de autenticación inválido o no contiene ID de usuario",
          token_info: {
            present: !!req.headers.authorization,
            auth_content: req.auth ? Object.keys(req.auth) : "No auth object"
          }
        });
      }
      
      // Debug log para depósitos
      if (req.path === '/wallet/deposit') {
        console.log("Intentando depositar", req.body?.amount || "N/A", "para el usuario", auth0Id);
      }
      
      const client = await pool.connect();
      
      try {
        // Verificar si el usuario ya existe
        const checkQuery = `SELECT id, is_admin FROM users WHERE auth0_id = $1`;
        
        const checkResult = await client.query(checkQuery, [auth0Id]);

        if (checkResult.rows.length === 0) {
          // El usuario no existe en nuestra base de datos
          console.log("Usuario no encontrado, intentando crear uno nuevo");
          
          // 1. Obtener datos básicos del token
          let userEmail = req.auth?.payload?.email;
          let userName = req.auth?.payload?.name;
          
          // 2. Si no tenemos email/name en el token, obtenerlos desde userinfo endpoint
          if ((!userEmail || !userName) && token) {
            // Obtener información adicional del endpoint userinfo
            const userInfo = await getUserInfoFromAuth0(token);
            
            if (userInfo) {
              userEmail = userInfo.email || userEmail;
              userName = userInfo.name || userInfo.nickname || userName;
            }
          }
          
          // 3. Si tenemos req.body con datos del usuario (desde el frontend), usarlos como respaldo
          if (!userEmail && req.body && req.body.email) {
            userEmail = req.body.email;
            userName = req.body.name || userName;
          }
          
          // 4. Verificar si tenemos suficiente información
          if (!userEmail) {
            return res.status(400).json({ 
              error: "Datos insuficientes para crear el usuario",
              details: "No se pudo obtener el email del usuario. Por favor, actualiza tu perfil en Auth0." 
            });
          }
          
          console.log("Creando usuario con:", { auth0Id, email: userEmail, name: userName || "Usuario", isAdmin: isUserAdmin });
          
          // 5. Crear el usuario en nuestra base de datos
          await client.query('BEGIN');
          
          const insertQuery = `
            INSERT INTO users (auth0_id, email, name, last_login, is_admin)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP, $4)
            RETURNING id
          `;
          
          const insertResult = await client.query(insertQuery, [
            auth0Id, userEmail, userName || "Usuario", isUserAdmin
          ]);
          
          req.userId = insertResult.rows[0].id;
          
          // 6. Crear wallet vacía para el nuevo usuario
          const createWalletQuery = `
            INSERT INTO wallet (user_id, balance)
            VALUES ($1, 0)
          `;
          
          await client.query(createWalletQuery, [req.userId]);
          await client.query('COMMIT');
          
          console.log(`Usuario creado con ID: ${req.userId}, Admin: ${isUserAdmin}`);
        } else {
          // Usuario ya existe
          req.userId = checkResult.rows[0].id;
          
          // Actualizar último login y rol si es necesario
          await client.query(
            `UPDATE users SET last_login = CURRENT_TIMESTAMP, is_admin = $2 WHERE id = $1`,
            [req.userId, isUserAdmin]
          );
          
          console.log(`Usuario existente actualizado: ${req.userId}, Admin: ${isUserAdmin}`);
        }

        // Agregar información de admin al request
        req.isAdmin = isUserAdmin;
        
        next();
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Error en middleware de sincronización:", error);
      res.status(500).json({ 
        error: "Error interno al sincronizar usuario con Auth0" 
      });
    }
  };
}