import { WebpayPlus } from 'transbank-sdk';
import { Options, IntegrationApiKeys, Environment, IntegrationCommerceCodes } from 'transbank-sdk';

// Configuración para testing
const commerceCode = IntegrationCommerceCodes.WEBPAY_PLUS;
const apiKey = IntegrationApiKeys.WEBPAY;

WebpayPlus.configureForTesting();

export class WebPayService {
  static async createTransaction(buyOrder, sessionId, amount, returnUrl) {
    try {
      const createRequest = {
        buy_order: buyOrder,
        session_id: sessionId,
        amount: amount,
        return_url: returnUrl
      };

      const response = await WebpayPlus.Transaction.create(
        createRequest.buy_order,
        createRequest.session_id,
        createRequest.amount,
        createRequest.return_url
      );

      return {
        success: true,
        token: response.token,
        url: response.url
      };
    } catch (error) {
      console.error('Error creating WebPay transaction:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  static async confirmTransaction(token) {
    try {
      const response = await WebpayPlus.Transaction.commit(token);
      
      return {
        success: true,
        vci: response.vci,
        amount: response.amount,
        status: response.status,
        buy_order: response.buy_order,
        session_id: response.session_id,
        card_detail: response.card_detail,
        accounting_date: response.accounting_date,
        transaction_date: response.transaction_date,
        authorization_code: response.authorization_code,
        payment_type_code: response.payment_type_code,
        response_code: response.response_code,
        installments_amount: response.installments_amount,
        installments_number: response.installments_number,
        balance: response.balance
      };
    } catch (error) {
      console.error('Error confirming WebPay transaction:', error);
      return {
        success: false,
        error: error.message,
        isAbandoned: error.message.includes('Invalid token') || 
                    error.message.includes('Token not found') ||
                    error.message.includes('expired')
      };
    }
  }

  static getTransactionResult(response) {
    if (!response.success) {
      return {
        type: response.isAbandoned ? 'ABANDONED' : 'ERROR',
        status: response.isAbandoned ? 'ABANDONED' : 'ERROR',
        message: response.isAbandoned ? 
          'El usuario abandonó o canceló el pago' : 
          `Error técnico: ${response.error}`,
        userMessage: response.isAbandoned ?
          'Has cancelado el pago. Puedes intentar nuevamente cuando desees.' :
          'Ocurrió un error técnico. Por favor, intenta nuevamente.'
      };
    }

    if (response.vci === 'TSY' && response.response_code === 0) {
      return {
        type: 'APPROVED',
        status: 'WEBPAY_APPROVED',
        message: 'Pago aprobado exitosamente',
        userMessage: '¡Pago exitoso! Tu compra ha sido procesada.',
        details: {
          authorization_code: response.authorization_code,
          card_detail: response.card_detail,
          amount: response.amount
        }
      };
    }

    if (response.response_code !== 0) {
      const rejectionReasons = {
        '-1': 'Rechazado por el banco',
        '-2': 'Tarjeta expirada',
        '-3': 'Fondos insuficientes',
        '-4': 'Tarjeta bloqueada',
        '-5': 'Error en los datos de la tarjeta',
        '-6': 'Límite de compra excedido',
        '-7': 'Tarjeta no válida para compras en línea',
        '-8': 'Rechazo general del banco'
      };

      const reason = rejectionReasons[response.response_code] || 
                    `Pago rechazado (código: ${response.response_code})`;

      return {
        type: 'REJECTED',
        status: 'WEBPAY_REJECTED',
        message: reason,
        userMessage: `Tu pago fue rechazado: ${reason}. Por favor, verifica los datos de tu tarjeta e intenta nuevamente.`,
        details: {
          response_code: response.response_code,
          amount: response.amount
        }
      };
    }

    return {
      type: 'UNCERTAIN',
      status: 'WEBPAY_UNCERTAIN',
      message: `Estado incierto: VCI=${response.vci}`,
      userMessage: 'El estado del pago no está claro. Por favor, revisa tu estado de cuenta o contacta soporte.',
      details: {
        vci: response.vci,
        response_code: response.response_code
      }
    };
  }

  static isApproved(response) {
    return response.vci === 'TSY' && response.response_code === 0;
  }

  static isRejected(response) {
    return response.response_code !== 0;
  }
}