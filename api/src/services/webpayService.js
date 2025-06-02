import pkg from 'transbank-sdk';
const { WebpayPlus, Options, IntegrationCommerceCodes, IntegrationApiKeys, Environment } = pkg;

export class TransbankService {

  static getWebpayOptions() {
    const commerceCode = process.env.TRANSBANK_COMMERCE_CODE || IntegrationCommerceCodes.WEBPAY_PLUS;
    const apiKey = process.env.TRANSBANK_API_KEY || IntegrationApiKeys.WEBPAY;
    const environment = process.env.TRANSBANK_ENVIRONMENT === 'production' ? Environment.Production : Environment.Integration;

    return new Options(commerceCode, apiKey, environment);
  }


  //Crear transacción de Webpay
  static async createTransaction(buyOrder, sessionId, amount, returnUrl) {
    try {
      const webpayPlus = new WebpayPlus.Transaction(this.getWebpayOptions());
      
      const response = await webpayPlus.create(
        buyOrder,
        sessionId,
        amount,
        returnUrl
      );
      
      return {
        success: true,
        token: response.token,
        url: response.url
      };
    } catch (error) {
      console.error('Error creando transacción Transbank:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Confirmar transacción de Webpay
  static async confirmTransaction(token) {
    try {
      const webpayPlus = new WebpayPlus.Transaction(this.getWebpayOptions());
      const response = await webpayPlus.commit(token);
      
      return {
        success: true,
        data: response
      };
    } catch (error) {
      console.error('Error confirmando transacción Transbank:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Obtener estado de transacción de Webpay
  static async getTransactionStatus(token) {
    try {
      const webpayPlus = new WebpayPlus.Transaction(this.getWebpayOptions());
      const response = await webpayPlus.status(token);
      
      return {
        success: true,
        data: response
      };
    } catch (error) {
      console.error('Error obteniendo estado de transacción:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}