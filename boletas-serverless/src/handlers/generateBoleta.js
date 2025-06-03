// boletas-serverless/src/handlers/generateBoleta.js
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import PDFDocument from 'pdfkit';
import { v4 as uuidv4 } from 'uuid';

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

export const handler = async (event, context) => {
  console.log('🎯 Generando boleta PDF - Event:', JSON.stringify(event, null, 2));
  
  try {
    // Manejar CORS preflight
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
        },
        body: ''
      };
    }

    // Parse del body
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    
    // Validación de datos requeridos según el enunciado
    const { 
      userId, 
      userName, 
      userEmail, 
      purchaseId, 
      stockSymbol, 
      quantity, 
      pricePerShare, 
      totalAmount 
    } = body;
    
    console.log('📝 Datos recibidos:', { userId, userName, stockSymbol, quantity, pricePerShare });
    
    if (!userId || !userName || !stockSymbol || !quantity || !pricePerShare) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'Datos requeridos faltantes',
          required: ['userId', 'userName', 'stockSymbol', 'quantity', 'pricePerShare'],
          received: { userId, userName, stockSymbol, quantity, pricePerShare }
        })
      };
    }

    // Generar ID único para la boleta
    const boletaId = uuidv4();
    const timestamp = new Date().toISOString();
    const fechaBoleta = new Date().toLocaleDateString('es-CL');
    const totalCalculado = totalAmount || (quantity * pricePerShare);
    
    console.log(`📄 Generando boleta ${boletaId} para usuario ${userId}`);
    
    // Crear PDF usando los datos
    const pdfBuffer = await createPDFBoleta({
      boletaId,
      userId,
      userName,
      userEmail: userEmail || `usuario${userId}@stockmarket.cl`,
      purchaseId: purchaseId || boletaId,
      stockSymbol: stockSymbol.toUpperCase(),
      quantity,
      pricePerShare,
      totalAmount: totalCalculado,
      fechaBoleta,
      grupoNombre: process.env.GRUPO_NOMBRE || 'Grupo 1 - IIC2173'
    });

    // Subir a S3
    const s3Key = `boletas/${boletaId}.pdf`;
    const uploadParams = {
      Bucket: process.env.BUCKET_NAME,
      Key: s3Key,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      ACL: 'public-read',
      Metadata: {
        userId: String(userId),
        userName: userName,
        stockSymbol: stockSymbol.toUpperCase(),
        quantity: String(quantity),
        pricePerShare: String(pricePerShare),
        totalAmount: String(totalCalculado),
        purchaseId: String(purchaseId || boletaId),
        generatedAt: timestamp
      }
    };

    console.log(`☁️ Subiendo a S3: ${s3Key}`);
    await s3Client.send(new PutObjectCommand(uploadParams));

    // URL pública de descarga
    const downloadUrl = `https://${process.env.BUCKET_NAME}.s3.amazonaws.com/${s3Key}`;

    console.log(`✅ Boleta generada exitosamente: ${boletaId} - URL: ${downloadUrl}`);

    return {
      statusCode: 201,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
      },
      body: JSON.stringify({
        success: true,
        boletaId,
        downloadUrl,
        s3Key,
        metadata: {
          userId,
          userName,
          stockSymbol: stockSymbol.toUpperCase(),
          quantity,
          pricePerShare,
          totalAmount: totalCalculado,
          generatedAt: timestamp
        }
      })
    };

  } catch (error) {
    console.error('❌ Error generando boleta:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Error interno del servidor',
        details: error.message,
        timestamp: new Date().toISOString()
      })
    };
  }
};

// Función para crear el PDF mejorada
async function createPDFBoleta(data) {
  return new Promise((resolve, reject) => {
    try {
      console.log('🎨 Creando PDF para:', data.stockSymbol);
      
      const doc = new PDFDocument({ 
        margin: 50,
        size: 'A4'
      });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => {
        console.log('✅ PDF creado exitosamente');
        resolve(Buffer.concat(chunks));
      });
      doc.on('error', reject);

      // HEADER CON ESTILO
      doc.fontSize(24)
         .fillColor('#2563eb')
         .text('BOLETA DE COMPRA DE ACCIONES', { align: 'center' });
      
      doc.fontSize(16)
         .fillColor('#374151')
         .text(data.grupoNombre, { align: 'center' });
      
      doc.moveDown(0.5);
      
      // Línea decorativa
      doc.strokeColor('#e5e7eb')
         .lineWidth(2)
         .moveTo(50, doc.y)
         .lineTo(550, doc.y)
         .stroke();
      
      doc.moveDown();

      // INFORMACIÓN DE LA BOLETA
      doc.fontSize(12)
         .fillColor('#374151');
      
      const infoY = doc.y;
      doc.text(`Boleta ID: ${data.boletaId}`, 50, infoY);
      doc.text(`Fecha: ${data.fechaBoleta}`, 350, infoY);
      doc.text(`Compra ID: ${data.purchaseId}`, 50, infoY + 20);
      doc.text(`Hora: ${new Date().toLocaleTimeString('es-CL')}`, 350, infoY + 20);
      
      doc.y = infoY + 50;
      doc.moveDown();

      // INFORMACIÓN DEL CLIENTE
      doc.fontSize(14)
         .fillColor('#1f2937')
         .text('INFORMACIÓN DEL CLIENTE', { underline: true });
      
      doc.fontSize(12)
         .fillColor('#374151');
      doc.text(`Usuario ID: ${data.userId}`);
      doc.text(`Nombre: ${data.userName}`);
      doc.text(`Email: ${data.userEmail}`);
      doc.moveDown();

      // DETALLE DE LA COMPRA
      doc.fontSize(14)
         .fillColor('#1f2937')
         .text('DETALLE DE LA TRANSACCIÓN', { underline: true });
      
      doc.moveDown(0.5);
      
      // Tabla de detalles con mejor formato
      const tableTop = doc.y;
      const col1 = 50;
      const col2 = 200;
      const col3 = 350;
      const col4 = 450;
      
      // Headers de la tabla
      doc.fontSize(11)
         .fillColor('#6b7280')
         .text('Concepto', col1, tableTop)
         .text('Detalle', col2, tableTop)
         .text('Precio Unit.', col3, tableTop)
         .text('Total', col4, tableTop);
      
      // Línea separadora
      doc.strokeColor('#d1d5db')
         .lineWidth(1)
         .moveTo(col1, tableTop + 15)
         .lineTo(520, tableTop + 15)
         .stroke();
      
      let currentY = tableTop + 25;
      
      // Datos de la compra
      doc.fontSize(12)
         .fillColor('#374151');
      
      doc.text('Acción:', col1, currentY)
         .text(data.stockSymbol, col2, currentY)
         .text('', col3, currentY)
         .text('', col4, currentY);
      currentY += 20;
      
      doc.text('Cantidad:', col1, currentY)
         .text(String(data.quantity), col2, currentY)
         .text(`$${data.pricePerShare.toFixed(2)}`, col3, currentY)
         .text(`$${(data.quantity * data.pricePerShare).toFixed(2)}`, col4, currentY);
      currentY += 30;
      
      // Línea separadora antes del total
      doc.strokeColor('#d1d5db')
         .moveTo(col3, currentY)
         .lineTo(520, currentY)
         .stroke();
      currentY += 15;
      
      // TOTAL con énfasis
      doc.fontSize(14)
         .fillColor('#1f2937');
      doc.text('TOTAL PAGADO:', col3, currentY);
      doc.fontSize(16)
         .fillColor('#059669')
         .text(`$${data.totalAmount.toFixed(2)}`, col4, currentY);
      
      doc.y = currentY + 40;
      doc.moveDown(2);
      
      // INFORMACIÓN ADICIONAL
      doc.fontSize(10)
         .fillColor('#6b7280');
      
      doc.text('INFORMACIÓN LEGAL:', { underline: true });
      doc.moveDown(0.3);
      doc.text('• Esta boleta constituye comprobante de la transacción realizada.');
      doc.text('• La operación fue procesada a través del sistema de trading autorizado.');
      doc.text('• Para consultas, contacte a soporte@stockmarket.cl');
      
      doc.moveDown();
      
      // FOOTER
      doc.strokeColor('#e5e7eb')
         .lineWidth(1)
         .moveTo(50, doc.y)
         .lineTo(550, doc.y)
         .stroke();
      
      doc.moveDown(0.5);
      
      doc.fontSize(9)
         .fillColor('#9ca3af')
         .text('Esta boleta es generada automáticamente por el sistema.', { align: 'center' });
      doc.text(`Sistema de Trading - ${data.grupoNombre}`, { align: 'center' });
      doc.text(`Generado el ${new Date().toLocaleString('es-CL')}`, { align: 'center' });
      doc.text(`Documento válido sin firma digital`, { align: 'center' });

      doc.end();

    } catch (error) {
      console.error('❌ Error creando PDF:', error);
      reject(error);
    }
  });
}

// Handler para obtener estado de boleta
export const getBoletaStatusHandler = async (event, context) => {
  try {
    const { boletaId } = event.pathParameters || {};
    
    console.log(`🔍 Consultando estado de boleta: ${boletaId}`);
    
    if (!boletaId) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          error: 'ID de boleta requerido'
        })
      };
    }

    // Verificar si existe en S3
    const s3Key = `boletas/${boletaId}.pdf`;
    const downloadUrl = `https://${process.env.BUCKET_NAME}.s3.amazonaws.com/${s3Key}`;

    try {
      const headCommand = new HeadObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: s3Key
      });
      
      const headResult = await s3Client.send(headCommand);
      
      console.log(`✅ Boleta encontrada: ${boletaId}`);
      
      return {
        statusCode: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        },
        body: JSON.stringify({
          boletaId,
          status: 'available',
          downloadUrl,
          metadata: headResult.Metadata,
          lastModified: headResult.LastModified,
          size: headResult.ContentLength
        })
      };

    } catch (s3Error) {
      if (s3Error.name === 'NotFound') {
        console.log(`❌ Boleta no encontrada: ${boletaId}`);
        return {
          statusCode: 404,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          },
          body: JSON.stringify({
            boletaId,
            status: 'not_found',
            error: 'Boleta no encontrada'
          })
        };
      }
      throw s3Error;
    }

  } catch (error) {
    console.error('❌ Error obteniendo estado de boleta:', error);
    
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({
        error: 'Error interno del servidor',
        details: error.message
      })
    };
  }
};

// Handler de health check
export const healthCheckHandler = async (event, context) => {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'boletas-pdf-service',
      version: '1.0.0',
      environment: process.env.STAGE || 'dev',
      region: process.env.AWS_REGION || 'us-east-1',
      bucket: process.env.BUCKET_NAME
    })
  };
};