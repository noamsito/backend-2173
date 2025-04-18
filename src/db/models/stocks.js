'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class stocks extends Model {
    static associate(models) {
      // relaciones si las hay
    }
  }
  stocks.init({
    symbol:    DataTypes.STRING,
    price:     DataTypes.FLOAT,
    shortName: DataTypes.STRING,
    longName:  DataTypes.STRING,
    quantity:  DataTypes.INTEGER,
    timestamp: DataTypes.DATE
  }, {
    sequelize,
    modelName: 'stocks',
    tableName: 'stocks',
    timestamps: true
  });
  return stocks;
};