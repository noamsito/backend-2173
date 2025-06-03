// api/src/services/boletaService.js
import axios from 'axios';

class BoletaService {
  constructor() {
    this.lambdaUrl = process.env.BOLETAS_LAMBDA_URL || 'https://api.antonioescobar.amazonaws.com/dev';
    this.timeout = 30000; // 30 segundos
  }

  /**
   * Genera una boleta PDF para una compra
   * @param {Object} purchaseData - Datos de la compra
   * @returns {Promise<Object>} - Resultado con URL de descarga
   */
  async generateBoleta(purchaseData) {
    try {
      console.log('Generando boleta para compra:', purchaseData.purchaseId);

      const response = await axios.post(`${this.lambdaUrl}/generate-boleta`, {
        userId: purchaseData.userId,
        userName: purchaseData.userName,
        userEmail: purchaseData.userEmail,
        purchaseId: purchaseData.purchaseId,
        stockSymbol: purchaseData.stockSymbol,
        quantity: purchaseData.quantity,
        pricePerShare: purchaseData.pricePerShare,
        totalAmount: purchaseData.totalAmount,
        purchaseDate: purchaseData.purchaseDate
      }, {
        timeout: this.timeout,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.status === 201) {
        console.log('Boleta generada exitosamente:', response.data.boletaId);
        return {
          success: true,
          boletaId: response.data.boletaId,
          downloadUrl: response.data.downloadUrl,
          s3Key: response.data.s3Key
        };
      } else {
        throw new Error(`Error generando boleta: Status ${response.status}`);
      }

    } catch (error) {
      console.error('Error llamando al servicio de boletas:', error.message);
      
      // Manejar diferentes tipos de errores
      if (error.code === 'ECONNABORTED') {
        throw new Error('Timeout generando boleta');
      } else if (error.response) {
        throw new Error(`Error del servicio de boletas: ${error.response.data?.error || error.message}`);
      } else {
        throw new Error(`Error de conexión al servicio de boletas: ${error.message}`);
      }
    }
  }

  /**
   * Obtiene el estado de una boleta
   * @param {string} boletaId - ID de la boleta
   * @returns {Promise<Object>} - Estado de la boleta
   */
  async getBoletaStatus(boletaId) {
    try {
      const response = await axios.get(`${this.lambdaUrl}/boleta/${boletaId}`, {
        timeout: this.timeout
      });

      return response.data;

    } catch (error) {
      console.error('Error obteniendo estado de boleta:', error.message);
      
      if (error.response?.status === 404) {
        return {
          boletaId,
          status: 'not_found',
          error: 'Boleta no encontrada'
        };
      }
      
      throw error;
    }
  }

  /**
   * Verifica si el servicio está disponible
   * @returns {Promise<boolean>} - True si está disponible
   */
  async isServiceAvailable() {
    try {
      const response = await axios.get(`${this.lambdaUrl}/health`, {
        timeout: 5000
      });
      
      return response.status === 200 && response.data?.status === 'healthy';
      
    } catch (error) {
      console.warn('Servicio de boletas no disponible:', error.message);
      return false;
    }
  }
}

export default new BoletaService();

// api/server.js - Agregar estos endpoints a tu server.js existente

// Importar el servicio de boletas (agregar al inicio del archivo)
import BoletaService from './src/services/boletaService.js';

// Agregar después de los endpoints existentes, antes de app.listen()

// Endpoint para generar boleta de una compra (RF05)
app.post('/purchases/:purchaseId/boleta', checkJwt, syncUser, async (req, res) => {
    try {
        const { purchaseId } = req.params;
        
        // Obtener datos de la compra
        const purchaseQuery = `
            SELECT pr.*, u.name as user_name, u.email as user_email, s.long_name
            FROM purchase_requests pr
            JOIN users u ON pr.user_id = u.id
            LEFT JOIN stocks s ON pr.symbol = s.symbol
            WHERE pr.request_id = $1 AND pr.user_id = $2 AND pr.status = 'ACCEPTED'
            ORDER BY s.timestamp DESC
            LIMIT 1
        `;
        
        const result = await client.query(purchaseQuery, [purchaseId, req.userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                error: "Compra no encontrada o no autorizada para generar boleta" 
            });
        }
        
        const purchase = result.rows[0];
        const totalAmount = purchase.quantity * purchase.price;
        
        // Preparar datos para el servicio de boletas
        const purchaseData = {
            userId: req.userId,
            userName: purchase.user_name || 'Usuario',
            userEmail: purchase.user_email || 'email@ejemplo.com',
            purchaseId: purchase.request_id,
            stockSymbol: purchase.symbol,
            quantity: purchase.quantity,
            pricePerShare: purchase.price,
            totalAmount: totalAmount,
            purchaseDate: purchase.created_at
        };
        
        // Generar boleta
        const boletaResult = await BoletaService.generateBoleta(purchaseData);
        
        if (boletaResult.success) {
            // Guardar referencia de la boleta en la base de datos
            await client.query(`
                UPDATE purchase_requests 
                SET boleta_id = $1, boleta_url = $2, updated_at = CURRENT_TIMESTAMP
                WHERE request_id = $3
            `, [boletaResult.boletaId, boletaResult.downloadUrl, purchaseId]);
            
            res.json({
                success: true,
                boletaId: boletaResult.boletaId,
                downloadUrl: boletaResult.downloadUrl,
                message: "Boleta generada exitosamente"
            });
        } else {
            throw new Error("Error generando boleta");
        }
        
    } catch (error) {
        console.error("Error generando boleta:", error);
        res.status(500).json({ 
            error: "Error generando boleta",
            details: error.message 
        });
    }
});

// Endpoint para descargar boleta existente
app.get('/purchases/:purchaseId/boleta', checkJwt, syncUser, async (req, res) => {
    try {
        const { purchaseId } = req.params;
        
        // Verificar que la compra pertenezca al usuario
        const purchaseQuery = `
            SELECT boleta_id, boleta_url, status
            FROM purchase_requests
            WHERE request_id = $1 AND user_id = $2 AND status = 'ACCEPTED'
        `;
        
        const result = await client.query(purchaseQuery, [purchaseId, req.userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ 
                error: "Compra no encontrada o no autorizada" 
            });
        }
        
        const purchase = result.rows[0];
        
        if (!purchase.boleta_id || !purchase.boleta_url) {
            return res.status(404).json({ 
                error: "Boleta no generada para esta compra",
                can_generate: true
            });
        }
        
        // Verificar estado de la boleta
        const boletaStatus = await BoletaService.getBoletaStatus(purchase.boleta_id);
        
        if (boletaStatus.status === 'available') {
            res.json({
                boletaId: purchase.boleta_id,
                downloadUrl: purchase.boleta_url,
                status: 'available',
                metadata: boletaStatus.metadata
            });
        } else {
            res.status(404).json({
                error: "Boleta no disponible",
                boletaId: purchase.boleta_id,
                status: boletaStatus.status
            });
        }
        
    } catch (error) {
        console.error("Error obteniendo boleta:", error);
        res.status(500).json({ 
            error: "Error obteniendo boleta",
            details: error.message 
        });
    }
});

// Endpoint de estado del servicio de boletas (RF04)
app.get('/boletas/service-status', async (req, res) => {
    try {
        const isAvailable = await BoletaService.isServiceAvailable();
        
        res.json({
            service_name: "Servicio de Boletas PDF",
            status: isAvailable ? "available" : "unavailable",
            lambda_url: process.env.BOLETAS_LAMBDA_URL || "not_configured",
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error("Error verificando estado del servicio de boletas:", error);
        res.status(500).json({
            service_name: "Servicio de Boletas PDF",
            status: "error",
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// Actualizar endpoint de compras para incluir información de boletas
app.get('/purchases', checkJwt, syncUser, async (req, res) => {
    try {
        // Obtener compras del usuario con información de boletas
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
                pr.price, 
                pr.status, 
                pr.reason,
                pr.created_at,
                pr.boleta_id,
                pr.boleta_url,
                ls.long_name,
                CASE 
                    WHEN pr.boleta_id IS NOT NULL THEN true 
                    ELSE false 
                END as has_boleta
            FROM purchase_requests pr
            JOIN latest_stocks ls ON pr.symbol = ls.symbol
            WHERE pr.user_id = $1
            ORDER BY pr.created_at DESC
        `;
        
        const purchasesResult = await client.query(purchasesQuery, [req.userId]);
        
        console.log(`Obtenidas ${purchasesResult.rows.length} compras para el usuario ${req.userId}`);
        
        res.json({ data: purchasesResult.rows });
    } catch (error) {
        console.error("Error obteniendo compras:", error);
        res.status(500).json({ error: "Error interno del servidor" });
    }
});