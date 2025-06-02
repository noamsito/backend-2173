import { Sequelize } from 'sequelize';

const sequelize = new Sequelize(
  process.env.DB_NAME || 'stock_data',
  process.env.DB_USER || 'postgres',
  process.env.DB_PASSWORD || 'tu_password',
  {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    dialect: 'postgres',
    logging: console.log, // Esto mostrará el SQL que se ejecuta
  }
);


export default sequelize;