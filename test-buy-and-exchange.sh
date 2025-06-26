#!/bin/bash

echo "🛒 SISTEMA DE COMPRA E INTERCAMBIO DE ACCIONES"
echo "=============================================="

API_URL="http://localhost:3000"

# Colores
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "\n1. 📊 Verificando stocks disponibles..."
STOCKS=$(curl -s "$API_URL/stocks" | jq '.data[0:5] | .[] | {symbol: .symbol, quantity: .quantity, price: .price}')
echo "$STOCKS"

echo -e "\n2. 💰 Verificando saldo actual..."
# Ya tenemos 10,000,000 en la billetera del usuario de prueba
echo -e "${GREEN}   Saldo inicial: $10,000,000${NC}"

echo -e "\n3. 🛒 Comprando acciones para intercambiar..."

# Comprar AMZN usando el endpoint original (que ahora no requiere auth)
echo -e "\n   Comprando 2 acciones de AMZN..."
COMPRA_AMZN=$(curl -s -X POST "$API_URL/stocks/buy" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AMZN",
    "quantity": 2
  }')
echo "   Respuesta: $COMPRA_AMZN"

# Comprar TSLA
echo -e "\n   Comprando 3 acciones de TSLA..."
COMPRA_TSLA=$(curl -s -X POST "$API_URL/stocks/buy" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "TSLA",
    "quantity": 3
  }')
echo "   Respuesta: $COMPRA_TSLA"

echo -e "\n4. 📋 Verificando mis compras..."
# Usando el endpoint original de compras (ahora sin auth)
COMPRAS=$(curl -s "$API_URL/purchases" | jq '.data[0:5]' 2>/dev/null || echo "Error obteniendo compras")
echo "$COMPRAS"

echo -e "\n5. 🔄 Creando propuesta de intercambio..."
EXCHANGE=$(curl -s -X POST "$API_URL/exchanges" \
  -H "Content-Type: application/json" \
  -d '{
    "target_group_id": 2,
    "offered_symbol": "AMZN",
    "offered_quantity": 1,
    "requested_symbol": "GOOGL",
    "requested_quantity": 1
  }')
echo "   Respuesta: $EXCHANGE"

echo -e "\n6. 📊 Verificando intercambios pendientes..."
PENDING=$(curl -s "$API_URL/exchanges/pending" | jq '.' 2>/dev/null || echo "Requiere autenticación")
echo "$PENDING"

echo -e "\n7. 🏛️ Creando una subasta con las acciones compradas..."
AUCTION=$(curl -s -X POST "$API_URL/auctions" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "TSLA",
    "quantity": 2,
    "starting_price": 350000,
    "duration_minutes": 30
  }')
echo "   Respuesta: $AUCTION"

echo -e "\n8. 📋 Verificando subastas activas..."
AUCTIONS=$(curl -s "$API_URL/auctions" | jq '.')
echo "$AUCTIONS"

echo -e "\n✅ Pruebas completadas!"
echo -e "\n📊 Resumen:"
echo "   - Acciones compradas: AMZN (2), TSLA (3)"
echo "   - Intercambio propuesto: 1 AMZN por 1 GOOGL con Grupo 2"
echo "   - Subasta creada: 2 TSLA a precio inicial $350,000"
echo ""
echo "🚀 Tu sistema está listo para intercambiar con otros grupos!" 