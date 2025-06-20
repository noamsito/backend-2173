#!/bin/bash

echo "🔍 Verificando Sistema de Subastas e Intercambios"
echo "=================================================="

# Colores para output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# URL base
BASE_URL="http://localhost:3000"

echo ""
echo "1. Verificando que el servidor esté corriendo..."
if curl -s -o /dev/null -w "%{http_code}" $BASE_URL | grep -q "200"; then
    echo -e "${GREEN}✅ Servidor respondiendo en puerto 3000${NC}"
else
    echo -e "${RED}❌ Servidor no responde. Ejecuta: docker-compose up -d${NC}"
    exit 1
fi

echo ""
echo "2. Verificando endpoints de subastas..."
AUCTIONS_RESPONSE=$(curl -s -w "\n%{http_code}" $BASE_URL/auctions)
HTTP_CODE=$(echo "$AUCTIONS_RESPONSE" | tail -n 1)
BODY=$(echo "$AUCTIONS_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ GET /auctions funcionando${NC}"
    echo "   Respuesta: $(echo $BODY | jq -r '.status' 2>/dev/null || echo $BODY)"
else
    echo -e "${RED}❌ GET /auctions falló (HTTP $HTTP_CODE)${NC}"
fi

echo ""
echo "3. Verificando endpoints de intercambios..."
# Nota: Este endpoint requiere autenticación, esperamos 401
EXCHANGES_CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE_URL/exchanges/pending)
if [ "$EXCHANGES_CODE" = "401" ]; then
    echo -e "${GREEN}✅ GET /exchanges/pending protegido correctamente (requiere auth)${NC}"
else
    echo -e "${YELLOW}⚠️  GET /exchanges/pending respondió con código $EXCHANGES_CODE${NC}"
fi

echo ""
echo "4. Verificando tablas en la base de datos..."
TABLES=$(docker exec backend-2173-db-1 psql -U user -d stocksdb -t -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('auctions', 'auction_bids', 'exchanges')" 2>/dev/null | grep -E "(auctions|auction_bids|exchanges)" | wc -l)

if [ "$TABLES" -eq "3" ]; then
    echo -e "${GREEN}✅ Las 3 tablas existen en la base de datos${NC}"
else
    echo -e "${RED}❌ Faltan tablas. Encontradas: $TABLES de 3${NC}"
    echo "   Ejecuta: docker exec backend-2173-db-1 psql -U user -d stocksdb < db/tables.sql"
fi

echo ""
echo "5. Verificando cliente MQTT..."
MQTT_RUNNING=$(docker ps --filter name=mqtt-client --format "{{.Status}}" | grep -c "Up")
if [ "$MQTT_RUNNING" -eq "1" ]; then
    echo -e "${GREEN}✅ Cliente MQTT corriendo${NC}"
else
    echo -e "${RED}❌ Cliente MQTT no está corriendo${NC}"
fi

echo ""
echo "=================================================="
echo "📊 RESUMEN:"
echo ""
echo "Para usar el sistema completo:"
echo "1. Frontend: http://localhost:80"
echo "2. Backend API: http://localhost:3000"
echo "3. Verificar Sistema: http://localhost:80/system-check"
echo ""
echo "Si algo falla, ejecuta:"
echo "  docker-compose down -v"
echo "  docker-compose up -d"
echo "" 