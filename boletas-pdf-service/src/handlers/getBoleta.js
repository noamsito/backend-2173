const { S3Client, GetObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { formatResponse } = require('../utils/helpers');

const s3Client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * Handler para obtener información de una boleta
 * Puede redirigir directamente al archivo o devolver metadata
 */
exports.handler = async (event) => {
  console.log('Get boleta event:', JSON.stringify(event, null, 2));
  
  try {
    const { boletaId } = event.pathParameters || {};
    const { download } = event.queryStringParameters || {};
    
    if (!boletaId) {
      return formatResponse(400, { 
        error: 'Missing boletaId parameter' 
      });
    }

    const fileName = `boletas/${boletaId}.pdf`;
    console.log(`Looking for boleta: ${fileName}`);

    try {
      // Verificar si el archivo existe
      const headParams = {
        Bucket: process.env.BUCKET_NAME,
        Key: fileName
      };
      
      const headResult = await s3Client.send(new HeadObjectCommand(headParams));
      console.log('File exists:', headResult);

      // Si se solicita descarga directa, redirigir
      if (download === 'true') {
        const publicUrl = `https://${process.env.BUCKET_NAME}.s3.amazonaws.com/${fileName}`;
        
        return {
          statusCode: 302,
          headers: {
            'Location': publicUrl,
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Allow-Methods': 'GET, OPTIONS'
          }
        };
      }

      // Devolver información de la boleta
      const publicUrl = `https://${process.env.BUCKET_NAME}.s3.amazonaws.com/${fileName}`;
      
      return formatResponse(200, {
        success: true,
        boletaId,
        downloadUrl: publicUrl,
        fileName,
        metadata: {
          contentType: headResult.ContentType,
          contentLength: headResult.ContentLength,
          lastModified: headResult.LastModified,
          boletaId: headResult.Metadata?.['boleta-id'],
          purchaseId: headResult.Metadata?.['purchase-id'],
          userEmail: headResult.Metadata?.['user-email'],
          generatedAt: headResult.Metadata?.['generated-at']
        }
      });

    } catch (s3Error) {
      if (s3Error.name === 'NotFound' || s3Error.$metadata?.httpStatusCode === 404) {
        return formatResponse(404, { 
          error: 'Boleta not found',
          boletaId 
        });
      }
      throw s3Error;
    }

  } catch (error) {
    console.error('Error getting boleta:', error);
    
    return formatResponse(500, {
      error: 'Internal server error',
      message: error.message
    });
  }
};