require('dotenv').config();                 // carga variables de entorno de .env
const app          = require('./app');
const mqttClient   = require('./mqtt/mqtt-client');

const PORT = process.env.PORT || 3000;

// Inicializa la conexión MQTT (dentro de mqtt-client.js exportas un método connect)
mqttClient.connect()
  .then(() => console.log('Conectado a MQTT'))
  .catch(err => console.error('Error MQTT:', err));

// Escucha el evento custom que emite mqtt-client.js
mqttClient.on('mqtt_message', ({ topic, message }) => {
  console.log(`MQTT → Tópico: ${topic}, Mensaje: ${message}`);
});

// Arranca el servidor HTTP
app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});