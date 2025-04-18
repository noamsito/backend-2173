require('dotenv').config();
const app           = require('./app');
const mqttClient    = require('./mqtt/mqtt-client');
const { sequelize } = require('./db/models');
const StockService  = require('./stocks/stocks.service');

const PORT = process.env.PORT || 3000;

(async () => {
  await mqttClient.connect();

  // Crea la tabla si falta
  await sequelize.sync();

  // Al recibir cada update de mercado, guárdalo
  mqttClient.on('market_update', async data => {
    try {
      await StockService.saveMarketUpdate(data);
      console.log('💾 Market update guardado:', data.symbol, data.price);
    } catch (err) {
      console.error('❌ Error guardando update:', err);
    }
  });

  app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
  });
})();