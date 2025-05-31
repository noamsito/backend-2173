// src/models/PriceHistory.js
const { DataTypes } = require('sequelize');
const sequelize = require('../../db/db');

const PriceHistory = sequelize.define('PriceHistory', {
  id: { type: DataTypes.UUID, primaryKey: true, defaultValue: DataTypes.UUIDV4 },
  symbol: { type: DataTypes.STRING, allowNull: false },
  price: { type: DataTypes.FLOAT, allowNull: false },
  timestamp: { type: DataTypes.DATE, allowNull: false }
}, { tableName: 'price_history', timestamps: false });

module.exports = PriceHistory;