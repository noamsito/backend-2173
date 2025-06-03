// src/handlers/generateBoleta.js
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import PDFDocument from 'pdfkit';
import { v4 as uuidv4 } from 'uuid';

const s3Client = new S3Client({ region: process.env.AWS_REGION });

export const handler = async (event, context) => {
  console.log('Generando boleta PDF - Event:', JSON.stringify(event, null, 2));
  
  try {
    // Parse del body
    const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    
    // Validación de datos requeridos
    const { userId, userName, userEmail, purchaseId, stockSymbol, quantity, pricePerShare, totalAmount } = body;
    
    if (!userId || !userName || !stockSymbol || !quantity || !pricePerShare) {
      return {
        statusCode: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
        },
        body: JSON.stringify({
          error: 'Datos requeridos faltantes',
          required: ['userId', 'userName', 'stockSymbol', 'quantity', 'pricePerShare']
        })
      };
    }

    // Generar ID único para la boleta
    const boletaId = uuidv4();
    const timestamp = new Date().toISOString();
    const fechaBoleta = new Date().toLocaleDateString('es-CL');
    
    // Crear PDF
    const pdfBuffer = await createPDFBoleta({
      boletaId,
      userId,
      userName,
      userEmail: userEmail || 'email@ejemplo.com',
      purchaseId: purchaseId || boletaId,
      stockSymbol,
      quantity,
      pricePerShare,
      totalAmount: totalAmount || (quantity * pricePerShare),
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
        stockSymbol,
        quantity: String(quantity),
        purchaseId: String(purchaseId || boletaId),
        generatedAt: timestamp
      }
    };

    await s3Client.send(new PutObjectCommand(uploadParams));

    // URL pública de descarga
    const downloadUrl = `https://${process.env.BUCKET_NAME}.s3.amazonaws.com/${s3Key}`;

    console.log(`Boleta generada exitosamente: ${boletaId}`);

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
          stockSymbol,
          quantity,
          totalAmount: totalAmount || (quantity * pricePerShare),
          generatedAt: timestamp
        }
      })
    };

  } catch (error) {
    console.error('Error generando boleta:', error);
    
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

// Función para crear el PDF
async function createPDFBoleta(data) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ margin: 50 });
      const chunks = [];

      doc.on('data', chunk => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      // Header
      doc.fontSize(20).text('BOLETA DE COMPRA DE ACCIONES', { align: 'center' });
      doc.fontSize(14).text(data.grupoNombre, { align: 'center' });
      doc.moveDown();

      // Información de la boleta
      doc.fontSize(12);
      doc.text(`Boleta ID: ${data.boletaId}`, 50, doc.y);
      doc.text(`Fecha: ${data.fechaBoleta}`, 350, doc.y - 15);
      doc.text(`Compra ID: ${data.purchaseId}`, 50, doc.y);
      doc.moveDown();

      // Línea separadora
      doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
      doc.moveDown();

      // Información del usuario
      doc.fontSize(14).text('INFORMACIÓN DEL CLIENTE', { underline: true });
      doc.fontSize(12);
      doc.text(`Usuario ID: ${data.userId}`);
      doc.text(`Nombre: ${data.userName}`);
      doc.text(`Email: ${data.userEmail}`);
      doc.moveDown();

      // Información de la compra
      doc.fontSize(14).text('DETALLE DE LA COMPRA', { underline: true });
      doc.fontSize(12);
      
      // Tabla de detalles
      const tableTop = doc.y + 10;
      doc.text('Concepto', 50, tableTop);
      doc.text('Detalle', 200, tableTop);
      doc.text('Monto', 400, tableTop, { align: 'right' });
      
      // Línea de la tabla
      doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();
      
      let currentY = tableTop + 25;
      
      doc.text('Símbolo de Acción:', 50, currentY);
      doc.text(data.stockSymbol, 200, currentY);
      currentY += 20;
      
      doc.text('Cantidad:', 50, currentY);
      doc.text(String(data.quantity), 200, currentY);
      currentY += 20;
      
      doc.text('Precio por Acción:', 50, currentY);
      doc.text(`$${data.pricePerShare.toFixed(2)}`, 200, currentY);
      doc.text(`$${data.pricePerShare.toFixed(2)}`, 400, currentY, { align: 'right' });
      currentY += 20;
      
      // Línea separadora
      doc.moveTo(50, currentY).lineTo(550, currentY).stroke();
      currentY += 10;
      
      // Total
      doc.fontSize(14);
      doc.text('TOTAL:', 300, currentY);
      doc.text(`$${data.totalAmount.toFixed(2)}`, 400, currentY, { align: 'right' });
      
      doc.moveDown(2);
      
      // Footer
      doc.fontSize(10);
      doc.text('Esta boleta es generada automáticamente por el sistema.', { align: 'center' });
      doc.text(`Sistema de Trading - ${data.grupoNombre}`, { align: 'center' });
      doc.text(`Generado el ${new Date().toLocaleString('es-CL')}`, { align: 'center' });

      doc.end();

    } catch (error) {
      reject(error);
    }
  });
}

// src/handlers/getBoletaStatus.js
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION });

export const handler = async (event, context) => {
  try {
    const { boletaId } = event.pathParameters;
    
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

    // Intentar obtener metadata del objeto
    try {
      const headCommand = new HeadObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: s3Key
      });
      
      const headResult = await s3Client.send(headCommand);
      
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
    console.error('Error obteniendo estado de boleta:', error);
    
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

// src/handlers/healthCheck.js
export const handler = async (event, context) => {
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
      environment: process.env.STAGE || 'dev'
    })
  };
};