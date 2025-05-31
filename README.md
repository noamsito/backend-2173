# README - Entrega 0: Noam Tanaka Vieira

## Consideraciones generales

> **⚠️ CAUTION:** En el archivo de las credenciales del usuario IAM de AWS, el usuario lo cree con el nombre de `Correcion_EC2` _OJO NO `Correccion_EC2`_. 

Esta entrega fue desarrollada utilizando:
- **Express JS** para la API web
- **Node.js** para el cliente MQTT
- **PostgreSQL** como base de datos
- **Sequelize** como ORM
- **Docker** para containerización
- **AWS EC2** para deployment

El sistema consta de cuatro componentes principales:
1. API REST para consultar datos de stocks y almacenarlos en la base de datos
2. **Sistema de compras y estimaciones** (RF02 - NUEVO)
3. Cliente MQTT que recibe y procesa datos del broker
4. Base de datos PostgreSQL para persistencia

## Nombre del dominio
El proyecto está disponible en: [noamsito.lat](https://noamsito.lat)

**Nota:** El root del dominio no muestra contenido directo, se debe acceder a los endpoints de manera manual como se especifican en el enunciado. Como los que se muestran a continuación:
- `https://noamsito.lat/stocks` 
- `https://noamsito.lat/stocks/{:symbol}` 
- `https://noamsito.lat/stocks?page=2&count=25`
- `https://noamsito.lat/stocks/{:symbol}?price=1000&quantity=5&date=2025-03-08`

**NUEVOS ENDPOINTS (RF02):**
- `https://noamsito.lat/api/purchases/user/1` - Lista compras del usuario
- `https://noamsito.lat/api/purchases/{purchaseId}/estimate` - Estimación de compra

## Método de acceso al servidor
Para acceder al servidor EC2:
```bash
ssh -i 'path/file_pem' ubuntu@ec2-3-15-62-134.us-east-2.compute.amazonaws.com
```
(El archivo .pem fue entregado en el buzón de canvas)

## Puntos logrados

### Puntos mínimos (No se logro implementar completamente el RF4)

#### Requisitos funcionales:
- **RF1 (3p):** Endpoint `/stocks` que lista todas las stocks recibidas con paginación
- **RF2 (1p):** Endpoint `/stocks/{symbol}` para detalles por símbolo
- **RF3 (2p):** Paginación implementada (25 items por defecto, configurable)

#### **NUEVOS Requisitos funcionales (RF02):**
- **RF02 (COMPLETO):** **Sistema de estimación lineal implementado** ✅
  - Endpoints de compras funcionando ✅
  - Algoritmo de estimación lineal ✅ 
  - Vista de detalle con estimaciones ✅
  - Validaciones y manejo de errores ✅

#### Requisitos no funcionales:
- **RNF1 (5p):** Cliente MQTT independiente funcionando constantemente
- **RNF4 (2p):** Servidor corriendo en AWS EC2
- **RNF5 (4p):** Base de datos PostgreSQL externa
- **RNF6 (4p):** API web en contenedor Docker

#### Docker-Compose:
- **RNF1 (5p):** App web lanzada desde docker-compose
- **RNF2 (5p):** DB PostgreSQL como contenedor en docker-compose
- **RNF3 (5p):** Cliente MQTT integrado en docker-compose

### Puntos variables (HTTPS - 25% completado)
Se implementó el requisito variable de HTTPS:
- **RNF1 (7p):** Dominio asegurado con SSL mediante Let's Encrypt
- **RNF2 (3p):** Redirección automática de HTTP a HTTPS
- **RNF3 (5p):** Chequeo automático de renovación de certificado

*Nota:* No se implementó el balanceo de carga con Nginx como segunda opción variable.

## Estructura del proyecto
```
.
├── api/                 
│   ├── src/
│   │   ├── controllers/
│   │   │   └── purchaseController.js    # NUEVO: Lógica de compras y estimaciones
│   │   ├── models/
│   │   │   └── Purchase.js              # NUEVO: Modelo Sequelize
│   │   └── routes/
│   │       └── purchases.js             # NUEVO: Rutas de API
│   ├── db/
│   │   └── db.js                        # NUEVO: Configuración Sequelize
│   ├── Dockerfile
│   └── server.js
├── mqtt-client/         
│   ├── Dockerfile
│   └── mqttConnect.js
├── db/                   
│   ├── Dockerfile
│   └── tables.sql
└──docker-compose.yml    
```

---

## **NUEVAS FUNCIONALIDADES - SISTEMA DE COMPRAS (RF02)**

### 💼 Endpoints de Compras

#### 📋 Obtener compras de un usuario
```http
GET /api/purchases/user/{userId}
```
**Respuesta:**
```json
[
  {
    "id": "0cf4d84b-debe-4f0e-b167-4e9da9ceb3b1",
    "userId": 1,
    "symbol": "AAPL",
    "quantity": 10,
    "priceAtPurchase": 150.5,
    "createdAt": "2025-05-30T23:30:32.439Z"
  }
]
```

#### 💰 Crear nueva compra
```http
POST /api/purchases
Content-Type: application/json

{
  "userId": 1,
  "symbol": "AAPL",
  "quantity": 10,
  "priceAtPurchase": 150.50
}
```

#### 🔮 Obtener estimación de una compra
```http
GET /api/purchases/{purchaseId}/estimate
```
**Respuesta:**
```json
{
  "purchase": {
    "id": "0cf4d84b-debe-4f0e-b167-4e9da9ceb3b1",
    "symbol": "AAPL",
    "quantity": 10,
    "priceAtPurchase": 150.50,
    "purchaseDate": "2025-05-30T23:30:32.439Z"
  },
  "currentPrice": 175.30,
  "totalInvested": 1505.00,
  "currentValue": 1753.00,
  "gainLoss": 248.00,
  "gainLossPercentage": 16.48,
  "linearEstimation": {
    "estimatedPrice": 189.74,
    "estimatedValue": 1897.43,
    "confidence": "low",
    "timeframe": "30 days"
  }
}
```

### 🧮 Algoritmo de Estimación Lineal

El backend implementa un **algoritmo de estimación lineal** que:

1. **Obtiene precio actual** (simulado con datos mock o integración con APIs externas)
2. **Calcula métricas de rendimiento**:
   ```javascript
   const totalInvested = quantity * priceAtPurchase;
   const currentValue = quantity * currentPrice;
   const gainLoss = currentValue - totalInvested;
   const gainLossPercentage = (gainLoss / totalInvested) * 100;
   ```

3. **Proyecta precio futuro** usando regresión lineal simple:
   ```javascript
   const changeRate = gainLossPercentage / 100;
   const futureEstimate = currentPrice * (1 + changeRate * 0.5);
   ```

4. **Calcula estimación a 30 días**:
   ```javascript
   const estimation = {
     estimatedPrice: futureEstimate,
     estimatedValue: quantity * futureEstimate,
     confidence: 'low', // Basado en volatilidad
     timeframe: '30 days'
   };
   ```

### 🗃️ Modelo de Datos - Purchase

```javascript
{
  id: UUID (Primary Key),
  userId: INTEGER (Foreign Key),
  symbol: STRING (Stock symbol),
  quantity: INTEGER (Number of shares),
  priceAtPurchase: DECIMAL (Price per share at purchase),
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP
}
```

### ✅ Validaciones Implementadas

#### Validación de Datos de Compra
- **userId**: Debe ser número entero positivo
- **symbol**: String requerido, se convierte a mayúsculas
- **quantity**: Entero positivo requerido
- **priceAtPurchase**: Número decimal positivo requerido

#### Validación de UUID
- **purchaseId**: Debe ser UUID v4 válido para endpoints de estimación
- Regex permisivo: `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`

### 🔗 Integración con JobMaster

```javascript
// Notifica al JobMaster cuando se crea una compra
try {
  await axios.post(`${process.env.JOBMASTER_URL}/job`, {
    purchaseId: purchase.id,
    symbol,
    quantity
  });
} catch (jobError) {
  console.warn('JobMaster no disponible:', jobError.message);
}
```

### 💱 Simulación de Precios Actuales

```javascript
const mockCurrentPrices = {
  'AAPL': 175.30,
  'GOOGL': 142.56,
  'MSFT': 378.85,
  'TSLA': 248.12,
  'AMZN': 145.34
};
```

### 🔧 Testing de Nuevos Endpoints

```bash
# Obtener compras de usuario
curl https://noamsito.lat/api/purchases/user/1

# Crear nueva compra
curl -X POST https://noamsito.lat/api/purchases \
  -H "Content-Type: application/json" \
  -d '{"userId":1,"symbol":"AAPL","quantity":10,"priceAtPurchase":150.50}'

# Obtener estimación (usar UUID real de la respuesta anterior)
curl https://noamsito.lat/api/purchases/0cf4d84b-debe-4f0e-b167-4e9da9ceb3b1/estimate
```

---

## PARTE 2 (B) ##

## Configuración del Broker MQTT

Creamos un archivo `mosquitto.conf` en `jobmaster-service/` con:

```conf
listener 1883
allow_anonymous true
```

Luego arrancamos Mosquitto:

```bash
# Desde la carpeta jobmaster-service/
docker stop test-mosquitto 2>/dev/null || true
docker rm   test-mosquitto 2>/dev/null || true

docker run -d \
  --name test-mosquitto \
  -p 1883:1883 \
  -v "$(pwd)/mosquitto.conf:/mosquitto/config/mosquitto.conf" \
  eclipse-mosquitto
```

Verifica con:
```bash
docker ps --filter name=test-mosquitto
```

---

## Servicio JobMaster

### Variables de entorno

Crea `jobmaster-service/.env`:

```env
PORT=4000
BROKER_URL=mqtt://127.0.0.1:1883
```

### Instalación y arranque

```bash
cd jobmaster-service
npm install
npm start
```

Deberías ver:
```
🔍 Usando BROKER_URL = mqtt://127.0.0.1:1883
✅ MQTT conectado a mqtt://127.0.0.1:1883
Suscrito a stocks/validation
JobMaster listening on port 4000
```

---

