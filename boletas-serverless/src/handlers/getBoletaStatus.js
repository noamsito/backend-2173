import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';

const s3Client = new S3Client({ region: process.env.AWS_REGION });

export const handler = async (event, context) => {
  try {
    const { boletaId } = event.pathParameters;
    
    if (!boletaId) {
      return {
        statusCode: 400,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'ID de boleta requerido' })
      };
    }

    const s3Key = `boletas/${boletaId}.pdf`;
    const downloadUrl = `https://${process.env.BUCKET_NAME}.s3.amazonaws.com/${s3Key}`;

    try {
      const headCommand = new HeadObjectCommand({
        Bucket: process.env.BUCKET_NAME,
        Key: s3Key
      });
      
      const headResult = await s3Client.send(headCommand);
      
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
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
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ boletaId, status: 'not_found', error: 'Boleta no encontrada' })
        };
      }
      throw s3Error;
    }

  } catch (error) {
    console.error('Error obteniendo estado de boleta:', error);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: 'Error interno del servidor', details: error.message })
    };
  }
};
