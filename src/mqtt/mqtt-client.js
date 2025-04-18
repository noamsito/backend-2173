require('dotenv').config();
const mqtt = require('mqtt');
const EventEmitter = require('events');

class MqttClient extends EventEmitter {
  constructor() {
    super();
    this.client = null;
  }

  async connect() {
    const brokerUrl = `mqtt://${process.env.MQTT_HOST}:${process.env.MQTT_PORT}`;
    const options = {
      username:       process.env.MQTT_USER,
      password:       process.env.MQTT_PASSWORD,
      keepalive:      30,
      reconnectPeriod:1000,
      protocolVersion:4,
      clean:          true
    };

    this.client = mqtt.connect(brokerUrl, options);

    this.client.on('connect', () => {
      console.log('✅ Conectado a MQTT');
      const topics = ['stocks/updates', 'stocks/requests'];
      this.client.subscribe(topics, (err, granted) => {
        if (err) {
          console.error('❌ Error al suscribir:', err);
        } else {
          console.log('🔔 Suscrito a:', granted.map(g => g.topic).join(', '));
        }
      });
    });

    this.client.on('message', (topic, payload) => {
      const msg = payload.toString();
      console.log(`🟢 Mensaje en ${topic}: ${msg}`);
      try {
        const data = JSON.parse(msg);
        if (topic === 'stocks/updates') {
          this.emit('market_update', data);
        } else if (topic === 'stocks/requests') {
          this.emit('request_response', data);
        }
      } catch (e) {
        console.error('❌ JSON inválido:', msg);
      }
    });

    this.client.on('error', err => {
      console.error('❌ Error MQTT:', err.message);
    });
    this.client.on('close',   ()  => console.log('🔌 Desconectado de MQTT'));
    this.client.on('reconnect',() => console.log('⏳ Reintentando conexión MQTT…'));
    this.client.on('offline',  ()  => console.log('🚫 Cliente MQTT offline'));
  }

  publishRequest(req) {
    if (!this.client || !this.client.connected) {
      throw new Error('MQTT no conectado');
    }
    const payload = JSON.stringify(req);
    this.client.publish('stocks/requests', payload, { qos: 1 }, err => {
      if (err) {
        console.error('❌ Publish error:', err);
      } else {
        console.log('📤 Enviada solicitud:', req.request_id);
      }
    });
  }
}

module.exports = new MqttClient();