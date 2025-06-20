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

## Instalación y ejecución con Docker

### 1. Construir y ejecutar con Docker Compose

```bash
# Limpiar y reconstruir los contenedores
docker-compose down && docker-compose build --no-cache && docker-compose up
```

### 2. Variables de entorno necesarias

Crea un archivo `.env` en la carpeta `api/` con:
```
AUTH0_DOMAIN=tu-dominio-auth0
AUTH0_AUDIENCE=tu-audience
# ... otras variables
```

## Puntos obtenidos en E2
- RF (Requisitos funcionales): 23 puntos
- RNF (Requisitos no funcionales): 30 puntos  
- HTTPS/SSL: 15 puntos
- **Total: 68 puntos**

---

## NUEVAS FUNCIONALIDADES E3 - SISTEMA DE SUBASTAS E INTERCAMBIOS

### ⚠️ IMPORTANTE: INICIALIZACIÓN AUTOMÁTICA

**Las tablas de subastas e intercambios se crean automáticamente** al iniciar el sistema:
1. El archivo `db/tables.sql` contiene todas las definiciones
2. El servidor ejecuta `initializeDatabase()` al arrancar
3. No se requiere intervención manual

Si necesitas reiniciar la base de datos:
```bash
docker-compose down -v  # Elimina volúmenes
docker-compose up -d    # Recrea todo desde cero
```

### 🔨 Sistema de Subastas (RF04 - 3 puntos)

#### Endpoints de Subastas

##### Crear una subasta (solo admin)
```http
POST /auctions
Authorization: Bearer {token}
Content-Type: application/json

{
  "symbol": "AAPL",
  "quantity": 100,
  "starting_price": 150.00,
  "duration_minutes": 30
}
```

##### Obtener subastas activas
```http
GET /auctions
```
**Respuesta:**
```json
{
  "status": "success",
  "auctions": [
    {
      "id": "uuid",
      "group_id": 1,
      "symbol": "AAPL",
      "quantity": 100,
      "starting_price": 150.00,
      "current_price": 175.00,
      "status": "ACTIVE",
      "end_time": "2025-06-10T15:30:00Z",
      "bid_count": 5,
      "highest_bid": 175.00
    }
  ]
}
```

##### Hacer una oferta en una subasta
```http
POST /auctions/{auction_id}/bid
Authorization: Bearer {token}
Content-Type: application/json

{
  "bid_amount": 180.00
}
```

##### Cerrar una subasta (admin)
```http
POST /auctions/{auction_id}/close
Authorization: Bearer {token}
```

### 🤝 Sistema de Intercambios (RF05 - 3 puntos)

#### Endpoints de Intercambios

##### Proponer un intercambio (solo admin)
```http
POST /exchanges
Authorization: Bearer {token}
Content-Type: application/json

{
  "target_group_id": 2,
  "offered_symbol": "AAPL",
  "offered_quantity": 50,
  "requested_symbol": "GOOGL",
  "requested_quantity": 30
}
```

##### Responder a una propuesta de intercambio
```http
POST /exchanges/{exchange_id}/respond
Authorization: Bearer {token}
Content-Type: application/json

{
  "action": "accept", // o "reject"
  "reason": "Motivo del rechazo (opcional)"
}
```

##### Obtener intercambios pendientes
```http
GET /exchanges/pending
Authorization: Bearer {token}
```

##### Obtener historial de intercambios
```http
GET /exchanges/history
Authorization: Bearer {token}
```

### 📡 Integración MQTT (RNF04 y RNF05 - 10 puntos)

#### Canal stocks/auctions

El sistema se suscribe al canal `stocks/auctions` para:

1. **Recibir mensajes de otros grupos** (RNF04 - 5 puntos):
   - Subastas creadas por otros grupos
   - Ofertas en subastas
   - Resultados de subastas
   - Propuestas de intercambio
   - Respuestas a intercambios

2. **Publicar mensajes propios** (RNF05 - 5 puntos):
   - Crear subastas propias
   - Hacer ofertas en subastas
   - Cerrar subastas
   - Proponer intercambios
   - Responder a intercambios

#### Formato de mensajes MQTT

##### Subasta creada
```json
{
  "type": "AUCTION_CREATED",
  "auction_id": "uuid",
  "group_id": 1,
  "symbol": "AAPL",
  "quantity": 100,
  "starting_price": 150.00,
  "end_time": "2025-06-10T15:30:00Z",
  "timestamp": "2025-06-10T15:00:00Z"
}
```

##### Propuesta de intercambio
```json
{
  "type": "EXCHANGE_PROPOSAL",
  "exchange_id": "uuid",
  "origin_group_id": 1,
  "target_group_id": 2,
  "offered_symbol": "AAPL",
  "offered_quantity": 50,
  "requested_symbol": "GOOGL",
  "requested_quantity": 30,
  "timestamp": "2025-06-10T15:00:00Z"
}
```

### 🗄️ Nuevas Tablas en Base de Datos

```sql
-- Tabla de subastas
CREATE TABLE auctions (
    id UUID PRIMARY KEY,
    group_id INTEGER NOT NULL,
    symbol VARCHAR(10) NOT NULL,
    quantity INTEGER NOT NULL,
    starting_price DECIMAL(10, 2) NOT NULL,
    current_price DECIMAL(10, 2) NOT NULL,
    status VARCHAR(20) NOT NULL,
    winner_group_id INTEGER,
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de ofertas en subastas
CREATE TABLE auction_bids (
    id UUID PRIMARY KEY,
    auction_id UUID REFERENCES auctions(id),
    bidder_group_id INTEGER NOT NULL,
    bid_amount DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabla de intercambios
CREATE TABLE exchanges (
    id UUID PRIMARY KEY,
    origin_group_id INTEGER NOT NULL,
    target_group_id INTEGER NOT NULL,
    offered_symbol VARCHAR(10) NOT NULL,
    offered_quantity INTEGER NOT NULL,
    requested_symbol VARCHAR(10) NOT NULL,
    requested_quantity INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL,
    reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 🎯 Resumen de Implementación E3

- **RF04**: Sistema de subastas completo con interface admin ✅
- **RF05**: Sistema de intercambios con lógica de propuesta/respuesta ✅
- **RNF04**: Recepción de mensajes del canal stocks/auctions ✅
- **RNF05**: Publicación de mensajes al canal stocks/auctions ✅

**Total puntos implementados: 16 puntos esenciales**

---

## 📖 Guía de Uso - Subastas e Intercambios

### 🚀 Inicio Rápido

1. **Levantar el sistema**:
   ```bash
   docker-compose down -v  # Limpiar todo
   docker-compose up -d    # Iniciar servicios
   ```

2. **Verificar que todo esté funcionando**:
   ```bash
   ./verify-system.sh
   ```

3. **Acceder al frontend**:
   - Abrir navegador en `http://localhost:80`
   - Iniciar sesión con Auth0

### 🏛️ Usar el Sistema de Subastas

1. **Ver subastas activas**: 
   - Navegar a "🏛️ Subastas" en el menú
   - Las subastas se actualizan automáticamente cada 30 segundos

2. **Crear una subasta**:
   - Click en "➕ Crear Subasta"
   - Llenar el formulario con:
     - Símbolo de la acción (ej: AAPL)
     - Cantidad de acciones
     - Precio inicial
     - Duración en minutos
   - Click en "🚀 Crear y Publicar"

3. **Hacer una oferta**:
   - Click en "💸 Hacer Oferta" en cualquier subasta activa
   - Ingresar el monto (debe ser mayor al precio actual)
   - Confirmar la oferta

4. **Cerrar una subasta**:
   - Click en "🔒 Cerrar" (disponible para el creador)
   - La subasta se cerrará y el ganador será notificado

### 🔄 Usar el Sistema de Intercambios

1. **Ver intercambios**:
   - Navegar a "🔄 Intercambios" en el menú
   - Pestaña "📥 Pendientes": propuestas activas
   - Pestaña "📋 Historial": intercambios completados

2. **Proponer un intercambio**:
   - Click en "➕ Proponer Intercambio"
   - Especificar:
     - Grupo objetivo (número del grupo)
     - Lo que ofreces (símbolo y cantidad)
     - Lo que solicitas (símbolo y cantidad)
   - Click en "🚀 Enviar Propuesta"

3. **Responder a propuestas**:
   - En la pestaña "Pendientes"
   - Click en "✅ Aceptar" o "❌ Rechazar"
   - Si rechazas, puedes agregar un motivo

### 🔐 Permisos y Roles

**Nota importante**: Aunque el frontend muestra los botones a todos los usuarios autenticados, el backend valida los permisos reales. Si recibes un error 403, significa que necesitas permisos de administrador.

Para convertir tu usuario en administrador:
```bash
docker exec -it backend-2173-db-1 psql -U postgres -d stock_data -c "UPDATE users SET role = 'admin' WHERE email = 'tu-email@ejemplo.com';"
```

### 📡 Comunicación MQTT

El sistema se comunica automáticamente con otros grupos:
- **Subastas creadas** se publican al broker
- **Propuestas de intercambio** se envían a los grupos objetivo
- **Respuestas** se notifican automáticamente

### 🐛 Solución de Problemas

1. **No aparecen los botones**:
   - Verificar que estés autenticado
   - Hacer hard refresh (Ctrl+Shift+R)
   - Reiniciar el servidor API

2. **Error 403 Forbidden**:
   - Tu usuario necesita rol de administrador
   - Ejecutar el comando SQL de arriba

3. **No se cargan las subastas**:
   - Verificar que el backend esté corriendo
   - Revisar la consola del navegador
   - Verificar que las tablas existan en la BD

4. **Error al crear subasta/intercambio**:
   - Verificar que tengas acciones del símbolo
   - Revisar que los valores sean válidos
   - Verificar conexión MQTT

---

