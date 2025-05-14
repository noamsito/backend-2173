require('dotenv').config();

const express = require('express');
const mqtt = require('mqtt');
const { v4: uuidv4 } = require('uuid');

// Read and log broker URL after dotenv.config()
const BROKER_URL = process.env.BROKER_URL;
console.log('🔍 Usando BROKER_URL =', BROKER_URL);

const app = express();
const PORT = process.env.PORT || 4000;

// In-memory store for job states and results
const jobs = {};

// Connect to MQTT broker
const client = mqtt.connect(BROKER_URL);
client.on('connect', () => {
  console.log('✅ MQTT conectado a', BROKER_URL);
  // Subscribe to validation topic
  client.subscribe('stocks/validation', (err) => {
    if (err) {
      console.error('Subscription error:', err);
    } else {
      console.log('Suscrito a stocks/validation');
    }
  });
});
client.on('error', (err) => {
  console.error('❌ Error MQTT:', err);
});

// Listen for validation messages from workers
client.on('message', (topic, message) => {
  if (topic === 'stocks/validation') {
    try {
      const { job_id, status, result } = JSON.parse(message.toString());
      if (jobs[job_id]) {
        jobs[job_id] = { status, result };
        console.log(`🔔 Job ${job_id} actualizado:`, status);
      }
    } catch (err) {
      console.error('Invalid validation message:', err);
    }
  }
});

app.use(express.json());

// Health check endpoint
app.get('/heartbeat', (req, res) => {
  res.json({ alive: true });
});

// Create a new job and publish to workers
app.post('/job', (req, res) => {
  const job_id = uuidv4();
  jobs[job_id] = { status: 'pending' };
  const payload = { job_id, data: req.body };

  console.log('🔔 Publicando a stocks/requests:', payload);

  client.publish('stocks/requests', JSON.stringify(payload), (err) => {
    if (err) {
      console.error('Publish error:', err);
      return res.status(500).json({ error: 'Failed to queue job' });
    }
    res.status(202).json({ job_id });
  });
});

// Query job status and result
app.get('/job/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json({ job_id: req.params.id, ...job });
});

// Start the service
app.listen(PORT, () => {
  console.log(`JobMaster listening on port ${PORT}`);
});
