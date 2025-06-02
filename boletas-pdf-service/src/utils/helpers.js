/**
 * Formatea la respuesta para API Gateway
 * @param {number} statusCode - Código de estado HTTP
 * @param {Object} body - Cuerpo de la respuesta
 * @returns {Object} - Respuesta formateada
 */
function formatResponse(statusCode, body) {
    return {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
      },
      body: JSON.stringify(body, null, 2)
    };
  }
  
  /**
   * Valida los datos requeridos para generar una boleta
   * @param {Object} data - Datos a validar
   * @returns {Object} - Resultado de la validación
   */
  function validateBoletaData(data) {
    const requiredFields = [
      'purchaseId',
      'userEmail', 
      'symbol',
      'quantity',
      'pricePerShare',
      'totalAmount',
      'purchaseDate'
    ];
  
    const missing = requiredFields.filter(field => {
      const value = data[field];
      return value === undefined || value === null || value === '';
    });
  
    // Validaciones adicionales
    const errors = [];
  
    if (data.quantity && (!Number.isInteger(Number(data.quantity)) || Number(data.quantity) <= 0)) {
      errors.push('quantity must be a positive integer');
    }
  
    if (data.pricePerShare && (isNaN(Number(data.pricePerShare)) || Number(data.pricePerShare) <= 0)) {
      errors.push('pricePerShare must be a positive number');
    }
  
    if (data.totalAmount && (isNaN(Number(data.totalAmount)) || Number(data.totalAmount) <= 0)) {
      errors.push('totalAmount must be a positive number');
    }
  
    if (data.userEmail && !isValidEmail(data.userEmail)) {
      errors.push('userEmail must be a valid email address');
    }
  
    return {
      isValid: missing.length === 0 && errors.length === 0,
      missing,
      errors
    };
  }
  
  /**
   * Valida si un email tiene formato correcto
   * @param {string} email - Email a validar
   * @returns {boolean} - True si es válido
   */
  function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }
  
  /**
   * Genera un nombre de archivo único para una boleta
   * @param {string} boletaId - ID de la boleta
   * @param {string} purchaseId - ID de la compra
   * @returns {string} - Nombre del archivo
   */
  function generateFileName(boletaId, purchaseId) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `boletas/${boletaId}_${purchaseId}_${timestamp}.pdf`;
  }
  
  /**
   * Extrae el ID de boleta desde un nombre de archivo
   * @param {string} fileName - Nombre del archivo
   * @returns {string|null} - ID de la boleta o null
   */
  function extractBoletaIdFromFileName(fileName) {
    const match = fileName.match(/boletas\/([^_]+)/);
    return match ? match[1] : null;
  }
  
  /**
   * Calcula el hash MD5 de un buffer (para verificación de integridad)
   * @param {Buffer} buffer - Buffer a hashear
   * @returns {string} - Hash MD5
   */
  function calculateMD5(buffer) {
    const crypto = require('crypto');
    return crypto.createHash('md5').update(buffer).digest('hex');
  }
  
  /**
   * Sanitiza datos de usuario para prevenir injection
   * @param {Object} data - Datos a sanitizar
   * @returns {Object} - Datos sanitizados
   */
  function sanitizeUserData(data) {
    const sanitized = {};
    
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        // Remover caracteres potencialmente peligrosos
        sanitized[key] = value
          .replace(/[<>\"']/g, '')
          .trim()
          .substring(0, 1000); // Límite de longitud
      } else {
        sanitized[key] = value;
      }
    }
    
    return sanitized;
  }
  
  /**
   * Genera metadata para la boleta
   * @param {Object} data - Datos de la compra
   * @returns {Object} - Metadata formateada
   */
  function generateBoletaMetadata(data) {
    return {
      'boleta-id': data.boletaId,
      'purchase-id': data.purchaseId,
      'user-email': data.userEmail,
      'symbol': data.symbol,
      'quantity': data.quantity.toString(),
      'total-amount': data.totalAmount.toString(),
      'generated-at': new Date().toISOString(),
      'service-version': '1.0.0'
    };
  }
  
  module.exports = {
    formatResponse,
    validateBoletaData,
    isValidEmail,
    generateFileName,
    extractBoletaIdFromFileName,
    calculateMD5,
    sanitizeUserData,
    generateBoletaMetadata
  };