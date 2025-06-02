import { TransbankService } from "../services/webpayService.js";
import { Pool } from 'pg';
import axios from 'axios';

const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
});


export class WebpayController {
  /**
   * Iniciar transacción de pago
   */
  static async initTransaction(req, res) {
    try {
      const { amount, orderId, userId } = req.body;
      
      // Validar datos requeridos
      if (!amount || !orderId || !userId) {
        return res.status(400).json({
          error: 'Faltan datos requeridos: amount, orderId, userId'
        });
      }

      // Crear orden única y sesión
      const buyOrder = `order-${orderId}-${Date.now()}`;
      const sessionId = `session-${userId}-${Date.now()}`;
      const returnUrl = process.env.TRANSBANK_RETURN_URL || 'http://localhost:3000/webpay/return';

      // Crear transacción en Transbank
      const result = await TransbankService.createTransaction(
        buyOrder,
        sessionId,
        amount,
        returnUrl
      );

      if (!result.success) {
        return res.status(500).json({
          error: 'Error al crear transacción',
          details: result.error
        });
      }

      // Guardar información de la transacción (opcional)
      // Aquí podrías guardar en base de datos: buyOrder, sessionId, token, etc.

      res.json({
        success: true,
        token: result.token,
        url: result.url,
        buyOrder,
        sessionId
      });

    } catch (error) {
      console.error('Error en initTransaction:', error);
      res.status(500).json({
        error: 'Error interno del servidor',
        details: error.message
      });
    }
  }

  


   //Manejar retorno de Webpay

  static async handleReturn(req, res) {
    try {
      const { token_ws } = req.body || req.query;

      console.log('=== WEBPAY RETURN ===');
      console.log('Method:', req.method);
      console.log('Token recibido:', token_ws);
      console.log('Body completo:', req.body);
      console.log('Query completo:', req.query);
      console.log('=====================');

      // *** DETECTAR CANCELACIÓN ***
      if (!token_ws || token_ws.trim() === '') {
        console.log('❌ Cancelación detectada: token vacío o nulo');
        return res.redirect(`http://localhost:80/stocks/cancelado?status=cancelled&message=Compra cancelada por el usuario`);
      }

      console.log(`✅ Procesando token válido: ${token_ws}`);

      const client = await pool.connect();
      
      try {
        // Buscar la transacción en la base de datos
        const transactionQuery = `
          SELECT * FROM webpay_transactions 
          WHERE token_ws = $1 AND status = 'pending'
        `;
        
        const transactionResult = await client.query(transactionQuery, [token_ws]);
        
        if (transactionResult.rows.length === 0) {
          console.log(`❌ Token no encontrado: ${token_ws}`);
          return res.redirect(`http://localhost:80/stocks/cancelado?status=cancelled&message=Token de transacción no encontrado`);
        }
        
        const transaction = transactionResult.rows[0];
        
        // Confirmar la transacción con Transbank
        const confirmResult = await TransbankService.confirmTransaction(token_ws);
        
        if (!confirmResult.success) {
          console.error('❌ Error confirmando:', confirmResult.error);
          
          // Marcar como fallida (También maneja errores de servidor)
          await client.query(`
            UPDATE webpay_transactions 
            SET status = 'failed', updated_at = NOW() 
            WHERE token_ws = $1
          `, [token_ws]);
          
          return res.redirect(`http://localhost:80/stocks/${transaction.symbol}?status=error&message=Error al confirmar el pago`);
        }
        
        const paymentData = confirmResult.data;
        
        // Verificar el estado del pago
        if (paymentData.status === 'AUTHORIZED' && paymentData.response_code === 0) {
          console.log(`✅ Pago autorizado: ${token_ws}`);

          // Procesar compra
          const purchaseSuccess = await WebpayController.processSuccessfulPurchase(client, transaction);
          if (purchaseSuccess.success) {
          
            await client.query(`
              UPDATE webpay_transactions 
              SET status = 'completed', authorization_code = $1, updated_at = NOW() 
              WHERE token_ws = $2
            `, [paymentData.authorization_code, token_ws]);
            console.log(`✅ Transacción completada: ${transaction.symbol}`);
          
            return res.redirect(`http://localhost:80/my-purchases?status=success&message=¡Compra de ${transaction.quantity} acciones de ${transaction.symbol} realizada exitosamente!`);
          
          } else {
            await client.query(`
              UPDATE webpay_transactions
              SET status = 'failed', updated_at = NOW()
              WHERE token_ws = $1
            `, [token_ws]);
            return res.redirect(`http://localhost:80/stocks/cancelado?status=cancelled&message=Error procesando la compra después del pago`);
          }
          
        } else {
          console.log(`❌ Pago rechazado: ${token_ws}, code: ${paymentData.response_code}`);
          await client.query(`
            UPDATE webpay_transactions 
            SET status = 'failed', updated_at = NOW() 
            WHERE token_ws = $1
          `, [token_ws]);
          
          return res.redirect(`http://localhost:80/stocks/${transaction.symbol}?status=failed&message=Pago rechazado por el banco`);
        }
      } finally {
        client.release();
      }
      
    } catch (error) {
      console.error('💥 Error en webpay return:', error);
      
      // En cualquier error, tratar como cancelación
      return res.redirect(`http://localhost:80/stocks/cancelado?status=cancelled&message=Error procesando el pago - transacción cancelada`);
    }
  }

  static async processSuccessfulPurchase(client, transaction) {
    try {
      const { user_id, symbol, quantity, request_id, amount } = transaction;
      
      console.log(`🔄 Procesando compra exitosa: ${quantity} acciones de ${symbol} para usuario ${user_id}`);
      
      // 1. ACTUALIZAR SOLICITUD DE COMPRA (ya existe desde el flujo inicial)
      const updatePurchaseQuery = `
        UPDATE purchase_requests 
        SET status = 'ACCEPTED',
            updated_at = CURRENT_TIMESTAMP
        WHERE request_id = $1
        RETURNING id
      `;
      
      await client.query(updatePurchaseQuery, [request_id]);
      console.log(`✅ Solicitud de compra actualizada a ACCEPTED: ${request_id}`);
      
      // 2. DESCONTAR DINERO DE LA WALLET
      await client.query(`
        UPDATE wallet 
        SET balance = balance - $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $2
      `, [amount, user_id]);
      
      console.log(`💰 Descontado $${amount} de la wallet del usuario ${user_id}`);
      
      // 3. ENVIAR VALIDACIÓN POR MQTT (según enunciado)
      const validationMessage = {
        request_id: request_id,
        timestamp: new Date().toISOString(),
        status: "ACCEPTED",
        reason: "Pago procesado exitosamente via WebPay"
      };
      
      try {
        await axios.post('http://mqtt-client:3000/publish', {
          topic: 'stocks/validation',
          message: validationMessage
        });
        
        console.log(`📡 Validación enviada por stocks/validation: ${request_id}`);
      } catch (mqttError) {
        console.error('❌ Error enviando validación al broker MQTT:', mqttError);
        // No fallar la compra por esto
      }
      
      // 4. REGISTRAR EVENTO DE COMPRA EXITOSA
      await client.query(`
        INSERT INTO events (type, details)
        VALUES ($1, $2)
      `, [
        'PURCHASE_VALIDATION',
        JSON.stringify({
          request_id: request_id,
          status: 'ACCEPTED',
          symbol: symbol,
          quantity: quantity,
          price: amount / quantity,
          user_id: user_id,
          payment_method: 'webpay',
          event_text: `Compraste ${quantity} acciones de ${symbol} por un total de $${amount.toFixed(2)}.`
        })
      ]);
      
      return { success: true };
      
    } catch (error) {
      console.error('❌ Error procesando compra exitosa:', error);
      return { success: false, error: error.message };
    }
  }
  
  /*
  static async handleReturn(req, res) {
    try {
      const { token_ws } = req.body || req.query;

      if (!token_ws) {
        return res.status(400).json({
          error: 'Token de transacción no encontrado'
        });
      }

      // Confirmar transacción con Transbank
      const result = await TransbankService.confirmTransaction(token_ws);

      if (!result.success) {
        return res.status(500).json({
          error: 'Error al confirmar transacción',
          details: result.error
        });
      }

      const transaction = result.data;
      const finalUrl = process.env.TRANSBANK_FINAL_URL || 'http://localhost:80/payment/result';

      // Verificar estado de la transacción
      if (transaction.status === 'AUTHORIZED') {
        // Pago exitoso
        console.log('Pago autorizado:', {
          buyOrder: transaction.buy_order,
          amount: transaction.amount,
          authorizationCode: transaction.authorization_code
        });

        // Aquí actualizarías tu base de datos con el pago exitoso
        
        // Redirigir al frontend con éxito
        res.redirect(`${finalUrl}?status=success&buyOrder=${transaction.buy_order}&amount=${transaction.amount}`);
      } else {
        // Pago rechazado
        console.log('Pago rechazado:', transaction);
        res.redirect(`${finalUrl}?status=failed&reason=rejected`);
      }

    } catch (error) {
      console.error('Error en handleReturn:', error);
      const finalUrl = process.env.TRANSBANK_FINAL_URL || 'http://localhost:80/payment/result';
      res.redirect(`${finalUrl}?status=error&reason=server_error`);
    }
  } */


  //Obtener estado de transacción

  static async getTransactionStatus(req, res) {
    try {
      const { token } = req.params;

      if (!token) {
        return res.status(400).json({
          error: 'Token de transacción requerido'
        });
      }

      const result = await TransbankService.getTransactionStatus(token);

      if (!result.success) {
        return res.status(500).json({
          error: 'Error al obtener estado de transacción',
          details: result.error
        });
      }

      res.json({
        success: true,
        transaction: result.data
      });

    } catch (error) {
      console.error('Error en getTransactionStatus:', error);
      res.status(500).json({
        error: 'Error interno del servidor',
        details: error.message
      });
    }
  }
};
