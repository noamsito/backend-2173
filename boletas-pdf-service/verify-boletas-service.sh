#!/bin/bash
# verify-boletas-service.sh
# Script para verificar que el servicio de boletas esté funcionando correctamente

set -e

echo "🔍 Verificando el servicio de boletas PDF..."

STAGE=${1:-dev}

# Verificar que el servicio esté desplegado
echo "📋 Verificando despliegue del servicio..."
if ! serverless info --stage $STAGE > /dev/null 2>&1; then
    echo "❌ Error: El servicio no está desplegado en stage '$STAGE'"
    echo "   Ejecuta: ./deploy-boletas-service.sh $STAGE"
    exit 1
fi

# Obtener información del servicio
SERVICE_INFO=$(serverless info --stage $STAGE)
API_URL=$(echo "$SERVICE_INFO" | grep -E "endpoints:" -A 10 | grep "POST" | awk '{print $3}' | sed 's|/generate-boleta||')

if [ -z "$API_URL" ]; then
    echo "❌ Error: No se pudo obtener la URL de la API"
    exit 1
fi

echo "✅ Servicio desplegado correctamente"
echo "🔗 URL de la API: $API_URL"

# Verificar que las funciones existan
echo ""
echo "🔍 Verificando funciones Lambda..."

FUNCTIONS=$(aws lambda list-functions --query "Functions[?starts_with(FunctionName, 'boletas-pdf-service-$STAGE')].FunctionName" --output text)

if [ -z "$FUNCTIONS" ]; then
    echo "❌ Error: No se encontraron funciones Lambda"
    exit 1
fi

echo "✅ Funciones Lambda encontradas:"
echo "$FUNCTIONS" | tr '\t' '\n' | sed 's/^/   /'

# Verificar bucket S3
echo ""
echo "🔍 Verificando bucket S3..."

BUCKET_NAME=$(echo "$SERVICE_INFO" | grep -A 20 "Stack Outputs" | grep "BucketName" | awk '{print $2}')

if [ -z "$BUCKET_NAME" ]; then
    # Intentar obtener el bucket de otra forma
    BUCKET_NAME=$(aws s3 ls | grep "boletas-pdf-$STAGE" | awk '{print $3}' | head -1)
fi

if [ -z "$BUCKET_NAME" ]; then
    echo "❌ Error: No se pudo encontrar el bucket S3"
    exit 1
fi

echo "✅ Bucket S3 encontrado: $BUCKET_NAME"

# Verificar permisos del bucket
echo ""
echo "🔍 Verificando permisos del bucket..."

if aws s3api head-bucket --bucket "$BUCKET_NAME" > /dev/null 2>&1; then
    echo "✅ Acceso al bucket verificado"
else
    echo "❌ Error: No se puede acceder al bucket"
    exit 1
fi

# Prueba de generación de boleta
echo ""
echo "🧪 Ejecutando prueba de generación de boleta..."

TEST_DATA='{
    "purchaseId": "test-'$(date +%s)'",
    "userEmail": "test@example.com",
    "userName": "Test User",
    "symbol": "AAPL",
    "quantity": 10,
    "pricePerShare": 150.00,
    "totalAmount": 1500.00,
    "purchaseDate": "'$(date -Iseconds)'",
    "requestId": "test-request-'$(date +%s)'"
}'

echo "📤 Enviando datos de prueba..."

RESPONSE=$(curl -s -X POST "$API_URL/generate-boleta" \
    -H "Content-Type: application/json" \
    -d "$TEST_DATA")

echo "📥 Respuesta recibida:"
echo "$RESPONSE" | jq . 2>/dev/null || echo "$RESPONSE"

# Verificar que la respuesta sea exitosa
if echo "$RESPONSE" | jq -e '.success == true' > /dev/null 2>&1; then
    echo "✅ Prueba de generación exitosa"
    
    # Extraer URL de descarga y verificar
    DOWNLOAD_URL=$(echo "$RESPONSE" | jq -r '.downloadUrl // empty')
    
    if [ ! -z "$DOWNLOAD_URL" ]; then
        echo "🔗 URL de descarga: $DOWNLOAD_URL"
        
        # Verificar que el archivo existe
        HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$DOWNLOAD_URL")
        
        if [ "$HTTP_STATUS" = "200" ]; then
            echo "✅ Archivo PDF accesible"
        else
            echo "⚠️  Advertencia: Archivo PDF no accesible (HTTP $HTTP_STATUS)"
        fi
    fi
else
    echo "❌ Error en la prueba de generación"
    echo "Revisa los logs: serverless logs -f generateBoleta --tail --stage $STAGE"
    exit 1
fi

# Verificar logs recientes
echo ""
echo "📜 Verificando logs recientes..."

if aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/boletas-pdf-service-$STAGE" > /dev/null 2>&1; then
    echo "✅ Logs de CloudWatch disponibles"
    echo "   Ver logs: serverless logs -f generateBoleta --tail --stage $STAGE"
else
    echo "⚠️  Advertencia: No se pudieron verificar los logs de CloudWatch"
fi

# Resumen final
echo ""
echo "📊 RESUMEN DE VERIFICACIÓN"
echo "=========================="
echo "✅ Servicio desplegado: $STAGE"
echo "✅ API Gateway funcionando: $API_URL"
echo "✅ Funciones Lambda activas"
echo "✅ Bucket S3 accesible: $BUCKET_NAME"
echo "✅ Generación de PDF funcionando"

echo ""
echo "🔧 PRÓXIMOS PASOS:"
echo "1. Agregar al .env del backend:"
echo "   LAMBDA_BOLETAS_URL=$API_URL"
echo ""
echo "2. Reiniciar el backend para cargar la nueva variable"
echo ""
echo "3. Probar desde el frontend:"
echo "   - Hacer una compra de acciones"
echo "   - Verificar que se genere la boleta"
echo "   - Descargar el PDF"

echo ""
echo "📈 MONITOREO:"
echo "   CloudWatch: https://console.aws.amazon.com/cloudwatch/home?region=us-east-1#logsV2:log-groups"
echo "   S3 Bucket: https://console.aws.amazon.com/s3/buckets/$BUCKET_NAME"
echo "   Lambda: https://console.aws.amazon.com/lambda/home?region=us-east-1#/functions"

echo ""
echo "✅ ¡Verificación completada exitosamente!"