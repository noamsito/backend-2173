// src/models/Estimate.js
import { DataTypes } from 'sequelize';
import sequelize from '../../db/db.js';
import Purchase from './Purchase.js';

const Estimate = sequelize.define('Estimate', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4
  },
  purchaseId: {
    type: DataTypes.UUID,
    allowNull: false,
    references: {
      model: Purchase,
      key: 'id'
    }
  },
  slope: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  intercept: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  predictedPrice: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  expectedGain: {
    type: DataTypes.FLOAT,
    allowNull: false
  }
}, {
  tableName: 'estimates',
  timestamps: false
});

// Si quieres que Sequelize genere la tabla automáticamente:
// Estimate.sync();

export default Estimate;