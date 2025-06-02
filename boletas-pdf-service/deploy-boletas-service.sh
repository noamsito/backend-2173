#!/bin/bash
# deploy-boletas-service.sh
# Script para desplegar el servicio de boletas PDF

set -e  # Salir si hay algún error

echo "🚀 Iniciando despliegue del servicio de boletas PDF..."

# Verificar que estamos en el directorio correcto
if [ ! -f "serverless.yml" ]; then
    echo "❌ Error: No se encontró serverless.yml. Ejecuta este script desde boletas-pdf-service/"
    exit 1
fi

# Verificar que AWS CLI está configurado
if ! aws sts get-caller-identity > /dev/null 2>&1; then
    echo "❌ Error: AWS CLI no está configurado o las credenciales son inválidas"
    echo "   Ejecuta: aws configure"
    exit 1
fi

# Verificar que Serverless está instalado
if ! command -v serverless &> /dev/null; then
    echo "📦 Instalando Serverless Framework..."
    npm install -g serverless
fi

# Instalar dependencias si no existen
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependencias..."
    npm install
fi

# Verificar sintaxis de los archivos
echo "🔍 Verificando sintaxis de archivos..."
node -c src/handlers/generateBoleta.js
node -c src/handlers/getBoleta.js
node -c src/services/pdfGenerator.js
node -c src/utils/helpers.js

echo "✅ Sintaxis verificada correctamente"

# Determinar stage
STAGE=${1:-dev}
echo "📋 Desplegando en stage: $STAGE"

# Hacer backup de configuración actual si existe
if [ -f ".serverless/serverless-state.json" ]; then
    echo "💾 Creando backup de configuración actual..."
    cp .serverless/serverless-state.json .serverless/backup-$(date +%Y%m%d-%H%M%S).json
fi

# Desplegar
echo "🚀 Desplegando servicio..."
serverless deploy --stage $STAGE --verbose

# Obtener información del deployment
echo "📊 Obteniendo información del servicio..."
serverless info --stage $STAGE

# Extraer URL de la API
API_URL=$(serverless info --stage $STAGE | grep -E "endpoints:" -A 10 | grep "POST" | awk '{print $3}' | sed 's|/generate-boleta||')

if [ ! -z "$API_URL" ]; then
    echo ""
    echo "✅ ¡Despliegue exitoso!"
    echo "🔗 URL de la API: $API_URL"
    echo ""
    echo "📝 Agregar esta variable al .env del backend:"
    echo "LAMBDA_BOLETAS_URL=$API_URL"
    echo ""
    echo "🧪 Para probar el servicio:"
    echo "curl -X POST $API_URL/generate-boleta \\"
    echo "  -H 'Content-Type: application/json' \\"
    echo "  -d '{\"purchaseId\":\"test\",\"userEmail\":\"test@example.com\",\"userName\":\"Test User\",\"symbol\":\"AAPL\",\"quantity\":10,\"pricePerShare\":150,\"totalAmount\":1500,\"purchaseDate\":\"2024-01-01T10:00:00Z\"}'"
else
    echo "⚠️  No se pudo extraer la URL de la API. Verifica la salida anterior."
fi

echo ""
echo "📋 Próximos pasos:"
echo "1. Actualizar LAMBDA_BOLETAS_URL en el .env del backend"
echo "2. Reiniciar el servicio backend"
echo "3. Probar la generación de boletas desde el frontend"

echo ""
echo "🔧 Comandos útiles:"
echo "  Ver logs: serverless logs -f generateBoleta --tail --stage $STAGE"
echo "  Actualizar: serverless deploy --stage $STAGE"
echo "  Remover: serverless remove --stage $STAGE"