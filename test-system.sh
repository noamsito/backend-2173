#!/bin/bash

echo "🔧 Sistema de Subastas e Intercambios - Prueba Completa"
echo "======================================================"

API_URL="http://localhost:3000"

echo -e "\n1. ✅ Verificando conectividad de la API..."
if curl -s -f "$API_URL/auctions" > /dev/null; then
    echo "   ✅ API respondiendo correctamente"
else
    echo "   ❌ API no está respondiendo"
    exit 1
fi

echo -e "\n2. 📊 Probando endpoint de subastas activas..."
RESPONSE=$(curl -s "$API_URL/auctions")
echo "   Respuesta: $RESPONSE"

echo -e "\n3. 🔄 Probando endpoint de intercambios pendientes..."
# Nota: Este endpoint requiere autenticación, esperamos un error 401
RESPONSE=$(curl -s "$API_URL/exchanges/pending")
echo "   Respuesta: $RESPONSE"

echo -e "\n4. 🐳 Verificando estado de contenedores..."
docker ps --format "table {{.Names}}\t{{.Status}}" | grep backend-2173

echo -e "\n5. 📝 Verificando logs de la API (últimas 10 líneas)..."
docker logs backend-2173-api-1 --tail 10

echo -e "\n6. 🔌 Verificando conexión MQTT..."
docker logs backend-2173-mqtt-client-1 --tail 5

echo -e "\n7. 💾 Verificando base de datos..."
docker exec backend-2173-db-1 psql -U postgres -d stock_data -c "SELECT COUNT(*) as total_tables FROM information_schema.tables WHERE table_schema = 'public';" 2>/dev/null || echo "   ⚠️  No se pudo conectar a la base de datos"

echo -e "\n✅ Prueba completa finalizada!"
echo "📋 Resumen:"
echo "   - API: $(curl -s -f "$API_URL/auctions" > /dev/null && echo "✅ Funcionando" || echo "❌ Con problemas")"
echo "   - Contenedores: $(docker ps | grep -c backend-2173) servicios corriendo"
echo "   - Para probar con autenticación, necesitas un JWT token válido" 