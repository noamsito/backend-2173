import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';

class EmailService {
  constructor() {
    this.sesClient = new SESClient({
      region: process.env.AWS_SES_REGION || 'us-east-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
      }
    });
    
    this.fromEmail = process.env.SES_FROM_EMAIL || 'noreply@your-domain.com';
  }

  async sendPurchaseConfirmation(userEmail, userName, purchaseData) {
    try {
      const { symbol, quantity, totalAmount, requestId } = purchaseData;
      
      const subject = `✅ Confirmación de Compra - ${symbol}`;
      
      const htmlBody = `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f4f4f4; }
            .container { max-width: 600px; margin: 0 auto; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header { text-align: center; background: #2E7D32; color: white; padding: 20px; margin: -30px -30px 30px -30px; border-radius: 10px 10px 0 0; }
            .success { background: #E8F5E8; border-left: 4px solid #4CAF50; padding: 15px; margin: 20px 0; }
            .details { background: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0; }
            .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>🎉 ¡Compra Exitosa!</h1>
              <p>StockMarketU - Grupo 1</p>
            </div>
            
            <div class="success">
              <strong>✅ Tu compra ha sido procesada exitosamente</strong>
            </div>
            
            <p>Hola <strong>${userName}</strong>,</p>
            
            <p>Te confirmamos que tu compra de acciones ha sido procesada y completada exitosamente.</p>
            
            <div class="details">
              <h3>📊 Detalles de tu Compra:</h3>
              <ul>
                <li><strong>Acción:</strong> ${symbol}</li>
                <li><strong>Cantidad:</strong> ${quantity} acciones</li>
                <li><strong>Monto Total:</strong> $${parseFloat(totalAmount).toFixed(2)}</li>
                <li><strong>ID de Transacción:</strong> ${requestId}</li>
                <li><strong>Fecha:</strong> ${new Date().toLocaleString('es-CL')}</li>
              </ul>
            </div>
            
            <p>Las acciones han sido agregadas a tu portafolio y ya puedes ver el detalle en tu panel de inversiones.</p>
            
            <p><strong>🔍 Próximos pasos:</strong></p>
            <ul>
              <li>Revisa tu portafolio actualizado en la plataforma</li>
              <li>Descarga tu boleta de compra</li>
              <li>Consulta las estimaciones de crecimiento</li>
            </ul>
            
            <div class="footer">
              <p>Este correo fue enviado automáticamente por StockMarketU</p>
              <p>Si tienes alguna pregunta, contacta a nuestro equipo de soporte</p>
              <p>© 2025 StockMarketU - Grupo 1 IIC2173</p>
            </div>
          </div>
        </body>
        </html>
      `;

      const textBody = `
        ¡Compra Exitosa!
        
        Hola ${userName},
        
        Tu compra ha sido procesada exitosamente:
        
        Acción: ${symbol}
        Cantidad: ${quantity} acciones
        Monto Total: $${parseFloat(totalAmount).toFixed(2)}        ID de Transacción: ${requestId}
        Fecha: ${new Date().toLocaleString('es-CL')}
        
        Las acciones han sido agregadas a tu portafolio.
        
        Saludos,
        Equipo StockMarketU
      `;

      const params = {
        Source: this.fromEmail,
        Destination: {
          ToAddresses: [userEmail]
        },
        Message: {
          Subject: {
            Data: subject,
            Charset: 'UTF-8'
          },
          Body: {
            Html: {
              Data: htmlBody,
              Charset: 'UTF-8'
            },
            Text: {
              Data: textBody,
              Charset: 'UTF-8'
            }
          }
        }
      };

      const command = new SendEmailCommand(params);
      const result = await this.sesClient.send(command);
      
      console.log(`✅ Email enviado exitosamente a ${userEmail}, MessageId: ${result.MessageId}`);
      return { success: true, messageId: result.MessageId };
      
    } catch (error) {
      console.error(`❌ Error enviando email a ${userEmail}:`, error);
      return { success: false, error: error.message };
    }
  }
}

export default new EmailService();