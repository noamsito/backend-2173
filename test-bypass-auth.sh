#!/bin/bash

echo "🔧 Probando Sistema SIN AUTENTICACIÓN"
echo "====================================="

API_URL="http://localhost:3000"

# Colores para output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "\n1. ✅ Verificando conectividad de la API..."
if curl -s -f "$API_URL/health" > /dev/null; then
    echo -e "${GREEN}   ✅ API respondiendo correctamente${NC}"
else
    echo -e "${RED}   ❌ API no está respondiendo${NC}"
    exit 1
fi

echo -e "\n2. 📊 Obteniendo subastas activas..."
AUCTIONS_RESPONSE=$(curl -s "$API_URL/auctions")
echo "   Respuesta: $AUCTIONS_RESPONSE"

echo -e "\n3. 📈 Verificando stocks disponibles..."
STOCKS_RESPONSE=$(curl -s "$API_URL/stocks" | jq '.data[0:3] | .[] | {symbol: .symbol, quantity: .quantity, price: .price}' 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "   Stocks disponibles:"
    echo "$STOCKS_RESPONSE"
else
    echo -e "${YELLOW}   ⚠️  Error obteniendo stocks${NC}"
fi

echo -e "\n4. 🏛️ Intentando crear una subasta..."
CREATE_AUCTION_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/auctions" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AMZN",
    "quantity": 1,
    "starting_price": 200000,
    "duration_minutes": 30
  }')

HTTP_CODE=$(echo "$CREATE_AUCTION_RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$CREATE_AUCTION_RESPONSE" | head -n -1)

if [ "$HTTP_CODE" = "201" ]; then
    echo -e "${GREEN}   ✅ Subasta creada exitosamente${NC}"
    echo "   Respuesta: $RESPONSE_BODY"
    
    # Extraer ID de la subasta
    AUCTION_ID=$(echo "$RESPONSE_BODY" | jq -r '.auction.id // empty' 2>/dev/null)
    
    if [ ! -z "$AUCTION_ID" ]; then
        echo -e "\n5. 💰 Haciendo una oferta en la subasta..."
        BID_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/auctions/$AUCTION_ID/bid" \
          -H "Content-Type: application/json" \
          -d '{
            "bid_amount": 220000
          }')
        
        BID_HTTP_CODE=$(echo "$BID_RESPONSE" | tail -n1)
        BID_BODY=$(echo "$BID_RESPONSE" | head -n -1)
        
        if [ "$BID_HTTP_CODE" = "200" ]; then
            echo -e "${GREEN}   ✅ Oferta realizada exitosamente${NC}"
            echo "   Respuesta: $BID_BODY"
        else
            echo -e "${RED}   ❌ Error realizando oferta (HTTP $BID_HTTP_CODE)${NC}"
            echo "   Respuesta: $BID_BODY"
        fi
    fi
else
    echo -e "${RED}   ❌ Error creando subasta (HTTP $HTTP_CODE)${NC}"
    echo "   Respuesta: $RESPONSE_BODY"
fi

echo -e "\n6. 🔄 Probando intercambios..."
EXCHANGE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/exchanges" \
  -H "Content-Type: application/json" \
  -d '{
    "target_group_id": 2,
    "offered_symbol": "TSLA",
    "offered_quantity": 1,
    "requested_symbol": "GOOGL",
    "requested_quantity": 1
  }')

EXCHANGE_HTTP_CODE=$(echo "$EXCHANGE_RESPONSE" | tail -n1)
EXCHANGE_BODY=$(echo "$EXCHANGE_RESPONSE" | head -n -1)

if [ "$EXCHANGE_HTTP_CODE" = "201" ]; then
    echo -e "${GREEN}   ✅ Intercambio propuesto exitosamente${NC}"
    echo "   Respuesta: $EXCHANGE_BODY"
else
    echo -e "${RED}   ❌ Error proponiendo intercambio (HTTP $EXCHANGE_HTTP_CODE)${NC}"
    echo "   Respuesta: $EXCHANGE_BODY"
fi

echo -e "\n7. 📋 Verificando intercambios pendientes..."
PENDING_RESPONSE=$(curl -s "$API_URL/exchanges/pending")
echo "   Respuesta: $PENDING_RESPONSE"

echo -e "\n8. 🔌 Verificando actividad MQTT..."
echo "   Últimos logs MQTT:"
docker logs mqtt_client --tail 3 2>/dev/null | sed 's/^/   /'

echo -e "\n✅ Pruebas completadas!"
echo -e "\n📋 Resumen:"
echo "   - API Health: ✅"
echo "   - Subastas activas: $(echo "$AUCTIONS_RESPONSE" | jq -r '.auctions | length' 2>/dev/null || echo "N/A")"
echo "   - Sistema funcionando sin autenticación" 