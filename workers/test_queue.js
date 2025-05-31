import amqp from 'amqplib';
import { v4 as uuidv4 } from 'uuid';

async function sendTestJobs() {
  try {
    console.log('🔄 Conectando a RabbitMQ...');
    const connection = await amqp.connect(process.env.RABBITMQ_URL || 'amqp://guest:guest@rabbitmq:5672/');
    const channel = await connection.createChannel();

    // Declarar colas
    await channel.assertQueue('purchase_processing', { durable: true });
    await channel.assertQueue('estimation_jobs', { durable: true });

    console.log('📤 Enviando jobs de prueba...');

    // Enviar job de compra de prueba
    const purchaseJob = {
      type: 'purchase',
      purchaseId: uuidv4(),
      symbol: 'AAPL',
      quantity: 10,
      userId: 1,
      queuedAt: new Date().toISOString()
    };

    await channel.sendToQueue(
      'purchase_processing',
      Buffer.from(JSON.stringify(purchaseJob)),
      { persistent: true }
    );

    console.log('✅ Job de compra enviado:', purchaseJob.purchaseId);

    // Enviar job de estimación de prueba
    const estimationJob = {
      type: 'estimation',
      purchaseId: uuidv4(),
      queuedAt: new Date().toISOString()
    };

    await channel.sendToQueue(
      'estimation_jobs',
      Buffer.from(JSON.stringify(estimationJob)),
      { persistent: true }
    );

    console.log('✅ Job de estimación enviado:', estimationJob.purchaseId);

    // Enviar varios jobs para probar concurrencia
    for (let i = 0; i < 5; i++) {
      const batchJob = {
        type: 'purchase',
        purchaseId: uuidv4(),
        symbol: ['GOOGL', 'MSFT', 'TSLA', 'AMZN', 'NVDA'][i],
        quantity: Math.floor(Math.random() * 20) + 1,
        userId: Math.floor(Math.random() * 3) + 1,
        queuedAt: new Date().toISOString()
      };

      await channel.sendToQueue(
        'purchase_processing',
        Buffer.from(JSON.stringify(batchJob)),
        { persistent: true }
      );

      console.log(`✅ Job batch ${i + 1} enviado: ${batchJob.symbol}`);
    }

    await connection.close();
    console.log('📤 Todos los jobs de prueba enviados exitosamente');

  } catch (error) {
    console.error('❌ Error enviando jobs:', error);
  }
}

sendTestJobs();