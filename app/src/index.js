const app = require('./app');
const mqttEmitter = require('./mqtt-client');  // Importamos el emisor de eventos
const PORT = process.env.PORT || 3000;

// Iniciar el servidor
app.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT}`);
});

// Escuchar el evento "mqtt_message" para imprimir el mensaje recibido
mqttEmitter.on('mqtt_message', (data) => {
  console.log(`Mensaje recibido desde MQTT en index.js -> Tópico: ${data.topic}, Mensaje: ${data.message}`);
});