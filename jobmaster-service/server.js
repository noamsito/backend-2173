// backend-2173/jobmaster-service/server.js
import express from 'express';
import dotenv from 'dotenv';
import { Queue } from 'bullmq'; // Importación directa con destructuring
import { v4 as uuidv4 } from 'uuid';

// Configuración de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const QUEUE_NAME = 'estimations';

// Middleware JSON
app.use(express.json());

// Solo la cola (QueueScheduler ya no es necesario en versiones recientes)
const queue = new Queue(QUEUE_NAME, { 
  connection: { 
    host: 'localhost',
    port: 6379
  }
});

// Endpoint de healthcheck
app.get('/heartbeat', (_req, res) => res.json({ status: 'ok' }));

// Encolar jobs
app.post('/job', async (req, res) => {
  const { purchaseId, symbol, quantity } = req.body;
  if (!purchaseId || !symbol || typeof quantity !== 'number') {
    return res.status(400).json({ error: 'Faltan campos purchaseId, symbol o quantity válidos' });
  }
  try {
    const jobId = uuidv4();
    await queue.add(QUEUE_NAME, { purchaseId, symbol, quantity }, { jobId });
    return res.status(202).json({ jobId, status: 'queued' });
  } catch (err) {
    console.error('Error encolando job:', err);
    return res.status(500).json({ error: 'No se pudo encolar el job' });
  }
});

// Consultar estado de job
app.get('/job/:id', async (req, res) => {
  const jobId = req.params.id;
  try {
    const job = await queue.getJob(jobId);
    if (!job) return res.status(404).json({ error: 'Job no encontrado' });
    const state = await job.getState();
    const result = state === 'completed' ? job.returnvalue : null;
    return res.json({ jobId, state, result });
  } catch (err) {
    console.error('Error obteniendo job:', err);
    return res.status(500).json({ error: 'No se pudo consultar el job' });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`JobMaster listening on http://localhost:${PORT}`);
  console.log(`→ Redis at ${REDIS_URL}, queue "${QUEUE_NAME}"`);
});