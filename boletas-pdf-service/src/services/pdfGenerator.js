const { jsPDF } = require('jspdf');
const dayjs = require('dayjs');

/**
 * Genera un PDF de boleta de compra de acciones
 * @param {Object} data - Datos de la compra
 * @returns {Buffer} - Buffer del PDF generado
 */
async function generateBoletaPDF(data) {
  const {
    boletaId,
    purchaseId,
    userEmail,
    userName,
    symbol,
    quantity,
    pricePerShare,
    totalAmount,
    purchaseDate,
    requestId,
    groupName
  } = data;

  // Crear instancia de jsPDF
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  // Configurar fuente
  doc.setFont('helvetica');

  // ENCABEZADO
  doc.setFontSize(20);
  doc.setTextColor(44, 82, 130); // Color azul corporativo
  doc.text('BOLETA DE COMPRA DE ACCIONES', 105, 25, { align: 'center' });
  
  // Línea decorativa
  doc.setDrawColor(44, 82, 130);
  doc.setLineWidth(1);
  doc.line(20, 30, 190, 30);

  // INFORMACIÓN DEL GRUPO
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(`Emitido por: ${groupName}`, 20, 45);
  doc.text(`Fecha de emisión: ${dayjs().format('DD/MM/YYYY HH:mm:ss')}`, 20, 52);

  // INFORMACIÓN DE LA BOLETA
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text(`Boleta ID: ${boletaId}`, 20, 62);
  doc.text(`Request ID: ${requestId || 'N/A'}`, 20, 68);

  // INFORMACIÓN DEL USUARIO
  doc.setFontSize(14);
  doc.setTextColor(44, 82, 130);
  doc.text('INFORMACIÓN DEL CLIENTE', 20, 85);
  
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text(`Nombre: ${userName || 'No especificado'}`, 20, 95);
  doc.text(`Email: ${userEmail}`, 20, 102);

  // DETALLES DE LA COMPRA
  doc.setFontSize(14);
  doc.setTextColor(44, 82, 130);
  doc.text('DETALLES DE LA COMPRA', 20, 120);

  // Crear tabla de detalles
  const tableY = 130;
  
  // Encabezados de tabla
  doc.setFillColor(240, 240, 240);
  doc.rect(20, tableY, 170, 10, 'F');
  
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.text('Concepto', 25, tableY + 7);
  doc.text('Detalle', 80, tableY + 7);
  doc.text('Cantidad/Monto', 140, tableY + 7);

  // Líneas de la tabla
  let currentY = tableY + 15;
  
  // Purchase ID
  doc.text('ID de Compra', 25, currentY);
  doc.text(purchaseId, 80, currentY);
  currentY += 8;

  // Símbolo
  doc.text('Símbolo de Acción', 25, currentY);
  doc.text(symbol, 80, currentY);
  currentY += 8;

  // Cantidad
  doc.text('Cantidad de Acciones', 25, currentY);
  doc.text(quantity.toString(), 80, currentY);
  doc.text(quantity.toString(), 140, currentY);
  currentY += 8;

  // Precio por acción
  doc.text('Precio por Acción', 25, currentY);
  doc.text(`$${pricePerShare}`, 80, currentY);
  doc.text(`$${pricePerShare}`, 140, currentY);
  currentY += 8;

  // Fecha de compra
  doc.text('Fecha de Compra', 25, currentY);
  doc.text(dayjs(purchaseDate).format('DD/MM/YYYY HH:mm'), 80, currentY);
  currentY += 10;

  // TOTAL
  doc.setFillColor(44, 82, 130);
  doc.rect(20, currentY, 170, 12, 'F');
  
  doc.setFontSize(12);
  doc.setTextColor(255, 255, 255);
  doc.text('TOTAL PAGADO', 25, currentY + 8);
  doc.text(`$${parseFloat(totalAmount).toFixed(2)}`, 140, currentY + 8);

  currentY += 25;

  // INFORMACIÓN ADICIONAL
  doc.setFontSize(10);
  doc.setTextColor(100, 100, 100);
  doc.text('Esta boleta constituye comprobante de la transacción realizada.', 20, currentY);
  currentY += 6;
  doc.text('Conserve este documento para sus registros.', 20, currentY);
  currentY += 10;

  // QR o código de verificación (simulado)
  doc.setFontSize(8);
  doc.text(`Código de verificación: ${boletaId.slice(0, 8).toUpperCase()}`, 20, currentY);

  // PIE DE PÁGINA
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text('Documento generado automáticamente por el sistema de StockMarketU', 105, 280, { align: 'center' });
  doc.text(`Generado el ${dayjs().format('DD/MM/YYYY HH:mm:ss')}`, 105, 285, { align: 'center' });

  // Bordes del documento
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.rect(15, 15, 180, 270);

  // Convertir a buffer
  const pdfBuffer = Buffer.from(doc.output('arraybuffer'));
  
  console.log(`PDF generated successfully. Size: ${pdfBuffer.length} bytes`);
  
  return pdfBuffer;
}

module.exports = {
  generateBoletaPDF
};