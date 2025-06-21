// jobmaster-service/server.js - REEMPLAZAR TODO EL CONTENIDO
import express from 'express';
import dotenv from 'dotenv';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

app.use(express.json());

// Configurar Cola - Compatible con worker.js existente
const estimacionesQueue = new Queue('estimaciones', {
  connection: {
    host: REDIS_URL.includes('redis://') ? REDIS_URL.split('://')[1].split(':')[0] : 'localhost',
    port: REDIS_URL.includes('redis://') ? parseInt(REDIS_URL.split(':')[2] || '6379') : 6379
  }
});

// Storage en memoria para resultados
const jobResults = new Map();
const jobStatus = new Map();

console.log(`JobMaster iniciando en puerto ${PORT}`);
console.log(`Conectando a Redis: ${REDIS_URL}`);

// ENDPOINTS REQUERIDOS POR EL ENUNCIADO

/**
 * GET /heartbeat
 * Indica si el servicio está operativo (devuelve true)
 */
app.get('/heartbeat', (req, res) => {
  res.json({ 
    healthy: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    queue: {
      name: 'estimaciones',
      connection: REDIS_URL
    }
  });
});

/**
 * POST /job
 * Recibe los datos necesarios para el cálculo y entrega un id del job creado
 */
app.post('/job', async (req, res) => {
  try {
    const jobData = req.body;
    
    // Validación según el enunciado
    if (!jobData.userId || !jobData.stocksPurchased) {
      return res.status(400).json({
        error: 'Datos requeridos: userId, stocksPurchased'
      });
    }

    const jobId = uuidv4();

    // Preparar datos para el worker (compatible con worker.js existente)
    const jobPayload = {
      jobId,
      userId: jobData.userId,
      stocksPurchased: jobData.stocksPurchased,
      requestedAt: new Date().toISOString(),
      ...jobData
    };

    console.log(`Creando job ${jobId} para usuario ${jobData.userId}`);

    // Agregar job a la cola
    const job = await estimacionesQueue.add('calcular-estimacion', jobPayload, {
      jobId,
      delay: 0,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 2000,
      },
    });

    // Guardar estado inicial
    jobStatus.set(jobId, {
      id: jobId,
      status: 'pending',
      createdAt: new Date().toISOString(),
      data: jobPayload
    });

    console.log(`Job ${jobId} creado exitosamente`);

    res.status(201).json({
      jobId,
      status: 'created',
      message: 'Job creado exitosamente',
      estimatedTime: '30-60 segundos'
    });

  } catch (error) {
    console.error('Error creando job:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message
    });
  }
});

/**
 * GET /job/:id
 * :id representa el id de un job creado
 */
app.get('/job/:id', async (req, res) => {
  try {
    const jobId = req.params.id;

    console.log(`Consultando job: ${jobId}`);

    // Buscar en resultados completados
    if (jobResults.has(jobId)) {
      const result = jobResults.get(jobId);
      return res.json({
        jobId,
        status: 'completed',
        result,
        completedAt: result.completedAt
      });
    }

    // Buscar en estado actual
    if (jobStatus.has(jobId)) {
      const status = jobStatus.get(jobId);
      return res.json(status);
    }

    // Buscar en Bull queue
    const job = await estimacionesQueue.getJob(jobId);
    
    if (!job) {
      return res.status(404).json({
        error: 'Job no encontrado',
        jobId
      });
    }

    const state = await job.getState();
    const response = {
      jobId,
      status: state,
      progress: job.progress(),
      createdAt: new Date(job.timestamp).toISOString(),
      data: job.data
    };

    if (job.failedReason) {
      response.error = job.failedReason;
      response.attempts = job.attemptsMade;
    }

    res.json(response);

  } catch (error) {
    console.error('Error obteniendo job:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      details: error.message
    });
  }
});

// Endpoint adicional para estadísticas
app.get('/stats', async (req, res) => {
  try {
    const waiting = await estimacionesQueue.getWaiting();
    const active = await estimacionesQueue.getActive();
    const completed = await estimacionesQueue.getCompleted();
    const failed = await estimacionesQueue.getFailed();

    res.json({
      queue: {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length
      },
      results: {
        stored: jobResults.size,
        inStatus: jobStatus.size
      },
      uptime: process.uptime(),
      memory: process.memoryUsage()
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Event listeners para la cola
estimacionesQueue.on('completed', (job, result) => {
  console.log(`Job ${job.data.jobId} completado exitosamente`);
  
  // Guardar resultado
  jobResults.set(job.data.jobId, {
    ...result,
    completedAt: new Date().toISOString()
  });
  
  // Actualizar estado
  jobStatus.set(job.data.jobId, {
    id: job.data.jobId,
    status: 'completed',
    completedAt: new Date().toISOString(),
    result
  });
});

estimacionesQueue.on('failed', (job, err) => {
  console.error(`Job ${job.data.jobId} falló:`, err.message);
  
  jobStatus.set(job.data.jobId, {
    id: job.data.jobId,
    status: 'failed',
    error: err.message,
    failedAt: new Date().toISOString(),
    attempts: job.attemptsMade
  });
});

estimacionesQueue.on('active', (job) => {
  console.log(`Job ${job.data.jobId} iniciado`);
  
  jobStatus.set(job.data.jobId, {
    id: job.data.jobId,
    status: 'active',
    startedAt: new Date().toISOString(),
    progress: 0
  });
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Cerrando JobMaster...');
  await estimacionesQueue.close();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('Cerrando JobMaster...');
  await estimacionesQueue.close();
  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`JobMaster corriendo en puerto ${PORT}`);
  console.log(`Endpoints disponibles:`);
  console.log(`  GET  /heartbeat - Verificar estado`);
  console.log(`  POST /job - Crear job de estimación`);
  console.log(`  GET  /job/:id - Consultar estado de job`);
  console.log(`  GET  /stats - Estadísticas del sistema`);
});