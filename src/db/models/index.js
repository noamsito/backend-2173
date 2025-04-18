'use strict';
const fs        = require('fs');
const path      = require('path');
const Sequelize = require('sequelize');
require('dotenv').config();

const basename  = path.basename(__filename);
const db        = {};

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER,
  process.env.DB_PASSWORD,
  {
    host:    process.env.DB_HOST,
    port:    process.env.DB_PORT,
    dialect: 'postgres',
    logging: false,
  }
);

// Carga todos los modelos .js de este directorio
fs
  .readdirSync(__dirname)
  .filter(file =>
    file !== basename && file.slice(-3) === '.js'
  )
  .forEach(file => {
    const define = require(path.join(__dirname, file));
    const model  = define(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

// Inicializa asociaciones
Object.values(db)
  .filter(model => typeof model.associate === 'function')
  .forEach(model => model.associate(db));

db.sequelize = sequelize;
db.Sequelize = Sequelize;

module.exports = db;