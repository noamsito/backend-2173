const { v4: uuidv4 } = require('uuid');
const mqttClient      = require('../mqtt/mqtt-client');

async function createOrder(ctx) {
  const { symbol, quantity } = ctx.request.body;

  const request = {
    request_id: uuidv4(),
    group_id:   process.env.GROUP_ID,
    symbol,
    quantity,
    operation:  'BUY'
  };

  try {
    mqttClient.publishRequest(request);
    ctx.status = 202;
    ctx.body = {
      message:    'Solicitud enviada, pendiente de validación',
      request_id: request.request_id
    };
  } catch (err) {
    console.error('Error enviando solicitud:', err);
    ctx.status = 500;
    ctx.body = { message: 'No fue posible enviar la solicitud' };
  }
}

module.exports = { createOrder };