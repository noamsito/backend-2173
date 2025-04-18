const models = require('./app/models'); // Ajusta la ruta según tu estructura

async function clearStocks() {
  try {
    await models.stocks.destroy({ where: {} });
    console.log('Datos de la tabla stocks eliminados.');
    process.exit(0);
  } catch (error) {
    console.error('Error al eliminar datos:', error);
    process.exit(1);
  }
}

clearStocks();