// src/models/Purchase.js
import { DataTypes } from 'sequelize';
import sequelize from '../../db/db.js'; // Desde api/src/models/ ir a backend-2173/db/

const Purchase = sequelize.define('Purchase', {
  id: {
    type: DataTypes.UUID,
    primaryKey: true,
    defaultValue: DataTypes.UUIDV4,
    allowNull: false
  },
  userId: {
    type: DataTypes.INTEGER,
    allowNull: false,
    field: 'user_id'
  },
  symbol: {
    type: DataTypes.STRING,
    allowNull: false
  },
  quantity: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  priceAtPurchase: {
    type: DataTypes.FLOAT,
    allowNull: false,
    field: 'price_at_purchase'
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW,
    field: 'created_at',
    allowNull: false
  }
}, {
  tableName: 'purchases',
  timestamps: false
});

export default Purchase;