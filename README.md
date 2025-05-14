# README - Entrega 0: Noam Tanaka Vieira

## Consideraciones generales

> **⚠️ CAUTION:** En el archivo de las credenciales del usuario IAM de AWS, el usuario lo cree con el nombre de `Correcion_EC2` _OJO NO `Correccion_EC2`_. 

Esta entrega fue desarrollada utilizando:
- **Express JS** para la API web
- **Node.js** para el cliente MQTT
- **PostgreSQL** como base de datos
- **Docker** para containerización
- **AWS EC2** para deployment

El sistema consta de tres componentes principales:
1. API REST para consultar datos de stocks y almacenarlos en la base de datos
2. Cliente MQTT que recibe y procesa datos del broker
3. Base de datos PostgreSQL para persistencia

## Nombre del dominio
El proyecto está disponible en: [noamsito.lat](https://noamsito.lat)

**Nota:** El root del dominio no muestra contenido directo, se debe acceder a los endpoints de manera manual como se especifican en el enunciado. Como los que se muestran a continuación:
- `https://noamsito.lat/stocks` 
- `https://noamsito.lat/stocks/{:symbol}` 
- `https://noamsito.lat/stocks?page=2&count=25`
- `https://noamsito.lat/stocks/{:symbol}?price=1000&quantity=5&date=2025-03-08`

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

## Pruebas de funcionamiento

1. **Health check**:
   ```bash
   curl http://localhost:4000/heartbeat
   # → { "alive": true }
   ```

2. **Crear un job**:
   ```bash
   curl -v -X POST http://localhost:4000/job \
     -H "Content-Type: application/json" \
     -d '{"foo":"bar"}'
   # → HTTP/1.1 202 Accepted
   # → { "job_id": "<ID>" }
   ```
   Observa en el suscriptor MQTT:
   ```bash
docker exec -it test-mosquitto mosquitto_sub -h localhost -t stocks/requests
   # → { "job_id":"<ID>","data":{"foo":"bar"} }
   ```

3. **Simular worker**:
   ```bash
docker exec -it test-mosquitto mosquitto_pub -h localhost \
     -t stocks/validation \
     -m '{"job_id":"<ID>","status":"done","result":{"ok":true}}'
   ```

4. **Consultar estado de job**:
   ```bash
   curl http://localhost:4000/job/<ID>
   # → { "job_id":"<ID>", "status":"done", "result":{"ok":true} }
   ```

