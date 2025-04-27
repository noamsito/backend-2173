// auth0-integration.js
import { ManagementClient } from 'auth0';
import dotenv from 'dotenv';

dotenv.config();

// Configuración del cliente de Management API de Auth0
const auth0Management = new ManagementClient({
  domain: process.env.AUTH0_DOMAIN || 'dev-ouxdigl1l6bn6n3r.us.auth0.com',
  clientId: process.env.AUTH0_CLIENT_ID,
  clientSecret: process.env.AUTH0_CLIENT_SECRET,
  scope: 'read:users update:users'
});

/**
 * Obtiene el perfil completo de un usuario desde Auth0
 * @param {string} auth0Id - ID de Auth0 del usuario
 * @returns {Promise<Object|null>} - Datos del perfil o null en caso de error
 */
export async function getAuth0UserProfile(auth0Id) {
  try {
    const user = await auth0Management.getUser({ id: auth0Id });
    return user;
  } catch (error) {
    console.error('Error obteniendo perfil de Auth0:', error);
    return null;
  }
}

/**
 * Middleware para sincronizar usuarios de Auth0 con la base de datos local
 * @param {Object} pool - Pool de conexión a PostgreSQL
 * @returns {Function} - Middleware de Express
 */
export function createSyncUserMiddleware(pool) {
  return async (req, res, next) => {
    try {
      // Extraer ID de Auth0 del token JWT (normaliza el acceso)
      const auth0Id = req.auth?.sub || req.auth?.payload?.sub;
      
      if (!auth0Id) {
        return res.status(401).json({ 
          error: "Token de autenticación inválido o no contiene ID de usuario" 
        });
      }
      
      const client = await pool.connect();
      
      try {
        // Verificar si el usuario ya existe
        const checkQuery = `SELECT id FROM users WHERE auth0_id = $1`;
        const checkResult = await client.query(checkQuery, [auth0Id]);
        
        if (checkResult.rows.length === 0) {
          // El usuario no existe en nuestra base de datos
          
          // 1. Obtener datos básicos del token
          const email = req.auth?.payload?.email || req.auth?.email;
          const name = req.auth?.payload?.name || req.auth?.name || "Usuario";
          
          // 2. Si no tenemos email en el token, intentar obtenerlo de Auth0
          let userEmail = email;
          let userName = name;
          
          if (!userEmail) {
            // Intentar obtener datos desde Auth0 Management API
            const auth0User = await getAuth0UserProfile(auth0Id);
            
            if (auth0User) {
              userEmail = auth0User.email;
              userName = auth0User.name || userName;
            }
          }
          
          // 3. Verificar si tenemos suficiente información
          if (!userEmail) {
            return res.status(400).json({ 
              error: "Datos insuficientes para crear el usuario",
              details: "No se pudo obtener el email del usuario desde Auth0" 
            });
          }
          
          // 4. Crear el usuario en nuestra base de datos
          await client.query('BEGIN');
          
          const insertQuery = `
            INSERT INTO users (auth0_id, email, name, last_login)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            RETURNING id
          `;
          
          const insertResult = await client.query(insertQuery, [
            auth0Id, userEmail, userName
          ]);
          
          req.userId = insertResult.rows[0].id;
          
          // 5. Crear wallet vacía para el nuevo usuario
          const createWalletQuery = `
            INSERT INTO wallet (user_id, balance)
            VALUES ($1, 0)
          `;
          
          await client.query(createWalletQuery, [req.userId]);
          await client.query('COMMIT');
          
          console.log(`Usuario sincronizado desde Auth0: ${auth0Id} -> ${req.userId}`);
        } else {
          // Usuario ya existe
          req.userId = checkResult.rows[0].id;
          
          // Actualizar último login
          await client.query(
            `UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1`,
            [req.userId]
          );
        }
        
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