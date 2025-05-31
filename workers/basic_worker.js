import amqp from 'amqplib';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

class BasicWorker {
  constructor() {
    this.workerId = `worker_${process.pid}_${Date.now()}`;
    this.rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
    this.apiBaseUrl = process.env.API_BASE_URL || 'http://api:3000';
    this.connection = null;
    this.channel = null;
  }

  log(message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] Worker ${this.workerId}: ${message}`);
  }

  async connectRabbitMQ() {
    try {
      this.connection = await amqp.connect(this.rabbitmqUrl);
      this.channel = await this.connection.createChannel();

      // Declarar colas
      await this.channel.assertQueue('stock_requests', { durable: true });
      await this.channel.assertQueue('purchase_processing', { durable: true });
      await this.channel.assertQueue('estimation_jobs', { durable: true });

      this.log('Conectado a RabbitMQ exitosamente');
      return true;
    } catch (error) {
      this.log(`Error conectando a RabbitMQ: ${error.message}`);
      throw error;
    }
  }

  async processPurchaseJob(jobData) {
    try {
      const { purchaseId, symbol, quantity, userId } = jobData;
      this.log(`Procesando compra: ${symbol} x${quantity} (ID: ${purchaseId})`);

      // Simular procesamiento asíncrono
      await this.simulateProcessing();

      // Obtener precio actual (simulado)
      const currentPrice = await this.getCurrentPrice(symbol);

      // Actualizar estado en la base de datos
      const updateUrl = `${this.apiBaseUrl}/api/purchases/${purchaseId}/status`;
      const response = await axios.patch(updateUrl, {
        status: 'processed',
        currentPrice,
        workerId: this.workerId,
        processedAt: new Date().toISOString()
      });

      if (response.status === 200) {
        this.log(`Compra procesada exitosamente: ${purchaseId}`);
        
        // Enviar job de estimación
        await this.queueEstimationJob(purchaseId);
      } else {
        throw new Error(`Error actualizando estado: ${response.status}`);
      }

    } catch (error) {
      this.log(`Error procesando compra: ${error.message}`);
      await this.markAsFailed(jobData.purchaseId, error.message);
    }
  }

  async processEstimationJob(jobData) {
    try {
      const { purchaseId } = jobData;
      this.log(`Calculando estimación para compra: ${purchaseId}`);

      // Obtener datos de la compra
      const purchaseResponse = await axios.get(`${this.apiBaseUrl}/api/purchases/${purchaseId}`);
      const purchase = purchaseResponse.data;

      // Calcular estimación lineal
      const estimation = await this.calculateLinearEstimation(purchase);

      // Guardar estimación
      const saveUrl = `${this.apiBaseUrl}/api/purchases/${purchaseId}/estimation`;
      await axios.post(saveUrl, estimation);

      this.log(`Estimación calculada para: ${purchaseId}`);

    } catch (error) {
      this.log(`Error calculando estimación: ${error.message}`);
    }
  }

  async calculateLinearEstimation(purchase) {
    const { symbol, quantity, priceAtPurchase } = purchase;
    
    // Obtener precio actual
    const currentPrice = await this.getCurrentPrice(symbol);
    
    // Cálculos básicos
    const totalInvested = quantity * priceAtPurchase;
    const currentValue = quantity * currentPrice;
    const gainLoss = currentValue - totalInvested;
    const gainLossPercentage = (gainLoss / totalInvested) * 100;

    // Proyección lineal simple (30 días)
    const changeRate = gainLossPercentage / 100;
    const estimatedPrice = currentPrice * (1 + changeRate * 0.5);
    const estimatedValue = quantity * estimatedPrice;

    // Determinar confianza basada en volatilidad
    const confidence = Math.abs(gainLossPercentage) > 20 ? 'low' : 
                      Math.abs(gainLossPercentage) > 10 ? 'medium' : 'high';

    return {
      currentPrice,
      totalInvested,
      currentValue,
      gainLoss,
      gainLossPercentage: parseFloat(gainLossPercentage.toFixed(2)),
      linearEstimation: {
        estimatedPrice: parseFloat(estimatedPrice.toFixed(2)),
        estimatedValue: parseFloat(estimatedValue.toFixed(2)),
        confidence,
        timeframe: '30 days'
      }
    };
  }

  async getCurrentPrice(symbol) {
    // Simular llamada a API externa (Alpha Vantage, Yahoo Finance, etc.)
    const mockPrices = {
      'AAPL': 175.30,
      'GOOGL': 142.56,
      'MSFT': 378.85,
      'TSLA': 248.12,
      'AMZN': 145.34,
      'NVDA': 456.78,
      'META': 234.56
    };

    // Simular variación de precio
    const basePrice = mockPrices[symbol] || 100 + Math.random() * 400;
    const variation = (Math.random() - 0.5) * 0.1; // ±5% variación
    return parseFloat((basePrice * (1 + variation)).toFixed(2));
  }

  async simulateProcessing() {
    // Simular tiempo de procesamiento (1-3 segundos)
    const delay = 1000 + Math.random() * 2000;
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  async queueEstimationJob(purchaseId) {
    const estimationJob = {
      type: 'estimation',
      purchaseId,
      queuedAt: new Date().toISOString()
    };

    await this.channel.sendToQueue(
      'estimation_jobs',
      Buffer.from(JSON.stringify(estimationJob)),
      { persistent: true }
    );

    this.log(`Job de estimación encolado para: ${purchaseId}`);
  }

  async markAsFailed(purchaseId, error) {
    try {
      const updateUrl = `${this.apiBaseUrl}/api/purchases/${purchaseId}/status`;
      await axios.patch(updateUrl, {
        status: 'failed',
        error,
        workerId: this.workerId,
        processedAt: new Date().toISOString()
      });
    } catch (updateError) {
      this.log(`Error marcando como fallido: ${updateError.message}`);
    }
  }

  async processMessage(msg) {
    const jobData = JSON.parse(msg.content.toString());
    this.log(`Job recibido: ${jobData.type || 'unknown'}`);

    try {
      switch (jobData.type) {
        case 'purchase':
          await this.processPurchaseJob(jobData);
          break;
        case 'estimation':
          await this.processEstimationJob(jobData);
          break;
        default:
          this.log(`Tipo de job desconocido: ${jobData.type}`);
      }

      // Acknowled el mensaje
      this.channel.ack(msg);

    } catch (error) {
      this.log(`Error procesando mensaje: ${error.message}`);
      // Rechazar y re-encolar
      this.channel.nack(msg, false, true);
    }
  }

  async run() {
    this.log('Worker iniciado, conectando a RabbitMQ...');

    process.on('SIGINT', () => {
      this.log('Recibida señal SIGINT, cerrando worker...');
      this.shutdown();
    });

    process.on('SIGTERM', () => {
      this.log('Recibida señal SIGTERM, cerrando worker...');
      this.shutdown();
    });

    while (true) {
      try {
        await this.connectRabbitMQ();

        // Configurar QoS para procesar un mensaje a la vez
        await this.channel.prefetch(1);

        // Escuchar múltiples colas
        await this.channel.consume('purchase_processing', (msg) => {
          if (msg) this.processMessage(msg);
        });

        await this.channel.consume('estimation_jobs', (msg) => {
          if (msg) this.processMessage(msg);
        });

        this.log('Esperando mensajes... Para salir presiona CTRL+C');

        // Mantener el worker vivo
        await new Promise(() => {}); // Esperar indefinidamente

      } catch (error) {
        this.log(`Error en worker: ${error.message}`);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Esperar 5s antes de reconectar
      }
    }
  }

  async shutdown() {
    try {
      if (this.channel) {
        await this.channel.close();
      }
      if (this.connection) {
        await this.connection.close();
      }
      this.log('Worker cerrado exitosamente');
      process.exit(0);
    } catch (error) {
      this.log(`Error cerrando worker: ${error.message}`);
      process.exit(1);
    }
  }
}

// Ejecutar el worker si se llama directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  const worker = new BasicWorker();
  worker.run().catch(error => {
    console.error('Error fatal en worker:', error);
    process.exit(1);
  });
}

export default BasicWorker;