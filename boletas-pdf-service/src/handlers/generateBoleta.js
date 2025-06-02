const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const { generateBoletaPDF } = require('../services/pdfGenerator');
const { formatResponse, validateBoletaData } = require('../utils/helpers');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Handler para generar boleta PDF
 * Recibe datos de compra y genera PDF almacenándolo en S3
 */
exports.handler = async (event) => {
  console.log('Event received:', JSON.stringify(event, null, 2));
  
  try {
    // Parsear el body
    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (error) {
      return formatResponse(400, { 
        error: 'Invalid JSON in request body',
        details: error.message 
      });
    }

    // Validar datos requeridos
    const validation = validateBoletaData(body);
    if (!validation.isValid) {
      return formatResponse(400, { 
        error: 'Missing required fields',
        missing: validation.missing,
        received: Object.keys(body)
      });
    }

    const { 
      purchaseId, 
      userEmail, 
      userName, 
      symbol, 
      quantity, 
      pricePerShare, 
      totalAmount,
      purchaseDate,
      requestId 
    } = body;

    // Generar ID único para la boleta
    const boletaId = uuidv4();
    const fileName = `boletas/${boletaId}.pdf`;

    console.log(`Generating boleta for purchase ${purchaseId}, file: ${fileName}`);

    // Generar PDF
    const pdfBuffer = await generateBoletaPDF({
      boletaId,
      purchaseId,
      userEmail,
      userName,
      symbol,
      quantity,
      pricePerShare,
      totalAmount,
      purchaseDate,
      requestId,
      groupName: process.env.GROUP_NAME || 'Grupo1'
    });

    // Subir a S3
    const uploadParams = {
      Bucket: process.env.BUCKET_NAME,
      Key: fileName,
      Body: pdfBuffer,
      ContentType: 'application/pdf',
      ContentDisposition: `attachment; filename="boleta-${boletaId}.pdf"`,
      Metadata: {
        'boleta-id': boletaId,
        'purchase-id': purchaseId,
        'user-email': userEmail,
        'generated-at': new Date().toISOString()
      }
    };

    const uploadResult = await s3Client.send(new PutObjectCommand(uploadParams));
    console.log('Upload successful:', uploadResult);

    // Construir URL pública
    const publicUrl = `https://${process.env.BUCKET_NAME}.s3.amazonaws.com/${fileName}`;

    // Respuesta exitosa
    return formatResponse(200, {
      success: true,
      boletaId,
      downloadUrl: publicUrl,
      fileName,
      metadata: {
        purchaseId,
        userEmail,
        symbol,
        quantity,
        totalAmount,
        generatedAt: new Date().toISOString(),
        size: pdfBuffer.length
      }
    });

  } catch (error) {
    console.error('Error generating boleta:', error);
    
    return formatResponse(500, {
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
};