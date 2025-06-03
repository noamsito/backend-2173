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
