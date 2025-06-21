#!/bin/bash

# Script de prueba para el sistema de subastas e intercambios

API_URL="http://localhost:3000"
TOKEN="YOUR_JWT_TOKEN_HERE"

echo "🔨 Probando Sistema de Subastas e Intercambios"
echo "=============================================="

# 1. Crear una subasta
echo -e "\n1. Creando una subasta..."
curl -X POST "$API_URL/auctions" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "quantity": 100,
    "starting_price": 150.00,
    "duration_minutes": 30
  }' | jq .

# 2. Obtener subastas activas
echo -e "\n2. Obteniendo subastas activas..."
curl -X GET "$API_URL/auctions" | jq .

# 3. Hacer una oferta (necesitarás el auction_id del paso 1)
echo -e "\n3. Haciendo una oferta en la subasta..."
read -p "Ingresa el auction_id: " AUCTION_ID
curl -X POST "$API_URL/auctions/$AUCTION_ID/bid" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bid_amount": 180.00
  }' | jq .

# 4. Proponer un intercambio
echo -e "\n4. Proponiendo un intercambio..."
curl -X POST "$API_URL/exchanges" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "target_group_id": 2,
    "offered_symbol": "AAPL",
    "offered_quantity": 50,
    "requested_symbol": "GOOGL",
    "requested_quantity": 30
  }' | jq .

# 5. Ver intercambios pendientes
echo -e "\n5. Obteniendo intercambios pendientes..."
curl -X GET "$API_URL/exchanges/pending" \
  -H "Authorization: Bearer $TOKEN" | jq .

# 6. Ver historial de intercambios
echo -e "\n6. Obteniendo historial de intercambios..."
curl -X GET "$API_URL/exchanges/history" \
  -H "Authorization: Bearer $TOKEN" | jq .

echo -e "\n✅ Pruebas completadas!"
echo "Nota: Recuerda reemplazar YOUR_JWT_TOKEN_HERE con un token JWT válido" 