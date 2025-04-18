const fs = require('fs');
const mqtt = require('mqtt');
const axios = require('axios');
const EventEmitter = require('events');

class MqttEmitter extends EventEmitter {}
const mqttEmitter = new MqttEmitter();

// Datos de conexión
const brokerAddress = "broker.iic2173.org";
const brokerPort = 9000;
const username = "students";
const password = "iic2173-2025-1-students";

// Construir la URL de conexión
const connectUrl = `mqtt://${brokerAddress}:${brokerPort}`;

// Opciones de conexión (incluyendo las credenciales)
const options = {
  username: username,
  password: password,
};

// Conectar al broker MQTT
const client = mqtt.connect(connectUrl, options);

// Configurar eventos
client.on('connect', () => {
  console.log('Conectado al broker MQTT');
  
  // Suscribirse al tópico 'stocks/info'
  client.subscribe('stocks/info', (err) => {
    if (err) {
      console.error('Error al suscribirse al tópico stocks/info:', err);
    } else {
      console.log('Suscripción exitosa al tópico stocks/info');
    }
  });
});

// Evento para recibir mensajes
client.on('message', (topic, message) => {
  if (topic === 'stocks/info') {
    const mensaje = message.toString();
    console.log(`Mensaje recibido en ${topic}: ${mensaje}`);
    // Emitir el evento para que index.js pueda escucharlo
    mqttEmitter.emit('mqtt_message', { topic, message: mensaje });
    
    // (Opcional) Realizar una petición con axios
    let stockData;
  try {
    stockData = JSON.parse(mensaje);
  } catch (err) {
    console.error("Error al parsear el mensaje JSON:", err);
    return;
  }
  axios.post('http://localhost:3000/stocks', stockData)
    .catch(err => console.error("Error en axios:", err));
    }
});

client.on('error', (err) => {
  console.error('Error en la conexión:', err);
});

client.on('close', () => {
  console.log('Desconectado del broker MQTT');
});

// Exportar el emisor para que otros módulos puedan escucharlo
module.exports = mqttEmitter;