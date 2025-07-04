// cors-configuration.js
// Configuración CORS actualizada para api/server.js

import cors from 'cors';

// Lista completa de orígenes permitidos
const allowedOrigins = [
  // Desarrollo local
  'http://localhost',       // Sin puerto (puerto 80 por defecto)
  'http://localhost:80',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1',       // Sin puerto (puerto 80 por defecto)
  'http://127.0.0.1:80',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
  
  // Producción - Dominios personalizados
  'https://api.antonioescobar.lat',
  'https://boletas-api.antonioescobar.lat',
  'http://antonioescobar.lat',
  'https://antonioescobar.lat',

  'https://r12c7vfhig.execute-api.us-east-1.amazonaws.com',
  
  // S3 Frontend
  'http://frontend-grupo1-iic2173.s3-website-us-east-1.amazonaws.com',
  'https://frontend-grupo1-iic2173.s3-website-us-east-1.amazonaws.com',
  
  // Variables de entorno
  process.env.FRONTEND_URL,
  process.env.DOMAIN_URL,
  process.env.API_GATEWAY_URL, // Nueva variable
].filter(Boolean); // Remover valores undefined

export const apiGatewayMiddleware = (req, res, next) => {
  // Headers específicos para API Gateway
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400');
  
  // Log para debugging
  console.log(`API Gateway request: ${req.method} ${req.path}`);
  console.log(`Origin: ${req.get('Origin') || 'no-origin'}`);
  
  next();
};

// Configuración CORS optimizada
export const corsOptions = {
  origin: function (origin, callback) {
    console.log(`🔍 CORS Check - Origin received: "${origin}"`);
    console.log(`🔍 CORS Check - Type: ${typeof origin}`);
    console.log(`🔍 CORS Check - Allowed origins:`, allowedOrigins);
    
    // Permitir requests sin origin (aplicaciones móviles, Postman, etc.)
    if (!origin) {
      console.log(`✅ CORS Allow - No origin (mobile/postman)`);
      return callback(null, true);
    }
    
    // Verificar si el origin está en la lista permitida
    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log(`✅ CORS Allow - Origin found in allowed list`);
      callback(null, true);
    } else {
      console.warn(`🚫 CORS blocked origin: "${origin}"`);
      console.log(`🔍 Exact match check:`, allowedOrigins.map(allowed => `"${allowed}" === "${origin}": ${allowed === origin}`));
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Access-Control-Request-Method',
    'Access-Control-Request-Headers'
  ],
  exposedHeaders: [
    'Content-Length',
    'X-Kuma-Revision'
  ],
  maxAge: 86400 // 24 horas
};

// Middleware CORS personalizado para casos especiales
export const customCorsMiddleware = (req, res, next) => {
  const origin = req.headers.origin;
  
  // Logging para debugging
  console.log(`🌐 CORS Request from: ${origin || 'no-origin'}`);
  console.log(`📋 Method: ${req.method}`);
  console.log(`🎯 Path: ${req.path}`);
  
  // Headers adicionales para WebPay y aplicaciones específicas
  if (origin && allowedOrigins.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
  }
  
  // Headers específicos para preflight OPTIONS
  if (req.method === 'OPTIONS') {
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS,PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, Accept, Origin');
    res.header('Access-Control-Max-Age', '86400');
    return res.sendStatus(200);
  }
  
  next();
};

// Configuración para rutas específicas
export const webpayCorsmiddleware = cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
});
