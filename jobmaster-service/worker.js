// backend-2173/jobmaster-service/worker.js
import { Worker } from 'bullmq';
import dotenv from 'dotenv';
import { processEstimation } from './estimation.js';

// Configuración de entorno
dotenv.config();

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME = 'estimations';
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY) || 5;

// Worker que procesa los jobs de estimación
const worker = new Worker(QUEUE_NAME, async (job) => {
  console.log(`Procesando job ${job.id} con datos:`, job.data);
  
  try {
    // Procesa la estimación
    const result = await processEstimation(job.data);
    console.log(`Job ${job.id} completado exitosamente`);
    return result;
  } catch (error) {
    console.error(`Error en job ${job.id}:`, error);
    throw error;
  }
}, {
  connection: {
    host: 'localhost',
    port: 6379
  },
  concurrency: CONCURRENCY
});

// Event listeners
worker.on('completed', (job) => {
  console.log(`✅ Job ${job.id} completado`);
});

worker.on('failed', (job, err) => {
  console.error(`❌ Job ${job.id} falló:`, err.message);
});

worker.on('error', (err) => {
  console.error('❌ Worker error:', err);
});

console.log(`Worker iniciado. Concurrencia: ${CONCURRENCY}`);
console.log(`Escuchando cola "${QUEUE_NAME}" en Redis localhost:6379`);