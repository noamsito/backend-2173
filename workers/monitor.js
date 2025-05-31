import amqp from 'amqplib';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

class WorkerMonitor {
  constructor() {
    this.rabbitmqUrl = process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672/';
    this.apiBaseUrl = process.env.API_BASE_URL || 'http://api:3000';
  }

  async getQueueStats() {
    try {
      const connection = await amqp.connect(this.rabbitmqUrl);
      const channel = await connection.createChannel();

      // SOLO las colas que realmente existen
      const queues = ['purchase_processing', 'estimation_jobs'];
      const stats = {
        timestamp: new Date().toISOString(),
        queues: {}
      };

      for (const queueName of queues) {
        try {
          // Declarar la cola antes de verificarla
          await channel.assertQueue(queueName, { durable: true });
          const queue = await channel.checkQueue(queueName);
          stats.queues[queueName] = {
            messageCount: queue.messageCount,
            consumerCount: queue.consumerCount
          };
        } catch (queueError) {
          stats.queues[queueName] = {
            messageCount: 0,
            consumerCount: 0,
            error: 'Queue no accesible'
          };
        }
      }

      await connection.close();
      return stats;

    } catch (error) {
      console.error('Error obteniendo estadísticas RabbitMQ:', error.message);
      return null;
    }
  }

  async getPurchaseStats() {
    try {
      const response = await axios.get(`${this.apiBaseUrl}/api/purchases/stats`, {
        timeout: 5000
      });
      return response.data;
    } catch (error) {
      // No mostrar error si simplemente no existe el endpoint aún
      return {
        total: 0,
        processed: 0,
        pending: 0,
        failed: 0,
        note: 'Endpoint no implementado aún'
      };
    }
  }

  async monitor() {
    console.log('🔍 Iniciando monitor de workers...');
    console.log('Presiona Ctrl+C para detener\n');

    const monitorInterval = setInterval(async () => {
      try {
        const queueStats = await this.getQueueStats();
        const purchaseStats = await this.getPurchaseStats();

        console.clear();
        console.log('📊 MONITOR DE WORKERS');
        console.log('==========================================');
        console.log(`🕐 ${new Date().toLocaleString()}\n`);

        if (queueStats) {
          console.log('📬 ESTADO DE COLAS:');
          Object.entries(queueStats.queues).forEach(([queueName, stats]) => {
            console.log(`  ${queueName}:`);
            console.log(`    📨 Mensajes: ${stats.messageCount}`);
            console.log(`    👥 Consumers: ${stats.consumerCount}`);
            if (stats.error) {
              console.log(`    ⚠️ Error: ${stats.error}`);
            }
          });
          console.log();
        }

        if (purchaseStats) {
          console.log('💼 ESTADÍSTICAS DE COMPRAS:');
          console.log(`  ✅ Procesadas: ${purchaseStats.processed || 0}`);
          console.log(`  ⏳ Pendientes: ${purchaseStats.pending || 0}`);
          console.log(`  ❌ Fallidas: ${purchaseStats.failed || 0}`);
          console.log(`  📊 Total: ${purchaseStats.total || 0}`);
          if (purchaseStats.note) {
            console.log(`  📝 Nota: ${purchaseStats.note}`);
          }
        } else {
          console.log('💼 ESTADÍSTICAS DE COMPRAS: No disponibles');
        }

        console.log('\n🔧 SERVICIOS:');
        console.log(`  RabbitMQ: ${queueStats ? '✅ Conectado' : '❌ Desconectado'}`);
        console.log(`  API: ${purchaseStats && !purchaseStats.note ? '✅ Conectada' : '⚠️ Parcial'}`);

        console.log('\n🎯 RESUMEN:');
        if (queueStats) {
          const totalMessages = Object.values(queueStats.queues).reduce((sum, queue) => sum + queue.messageCount, 0);
          const totalConsumers = Object.values(queueStats.queues).reduce((sum, queue) => sum + queue.consumerCount, 0);
          console.log(`  📨 Total mensajes en colas: ${totalMessages}`);
          console.log(`  👥 Total consumers activos: ${totalConsumers}`);
          
          if (totalMessages === 0 && totalConsumers > 0) {
            console.log(`  🚀 Sistema procesando en tiempo real`);
          }
        }

        console.log('\n==========================================');

      } catch (error) {
        console.error('Error en monitor:', error.message);
      }
    }, 5000);

    // Manejar señales de cierre
    process.on('SIGINT', () => {
      console.log('\n👋 Monitor detenido');
      clearInterval(monitorInterval);
      process.exit(0);
    });

    process.on('SIGTERM', () => {
      console.log('\n👋 Monitor detenido por SIGTERM');
      clearInterval(monitorInterval);
      process.exit(0);
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const monitor = new WorkerMonitor();
  monitor.monitor();
}

export default WorkerMonitor;