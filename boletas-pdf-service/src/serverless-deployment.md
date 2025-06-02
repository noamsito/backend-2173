# Documentación de Despliegue Serverless (Boletas PDF)

## Introducción

Este documento describe paso a paso cómo desplegar el servicio de generación de boletas PDF utilizando Serverless Framework en AWS Lambda.

## Prerrequisitos

### 1. Herramientas Necesarias

```bash
# Instalar Node.js (versión 18 o superior)
# Verificar instalación
node --version
npm --version

# Instalar Serverless Framework globalmente
npm install -g serverless

# Verificar instalación
serverless --version
```

### 2. Configuración de AWS

```bash
# Instalar AWS CLI
# macOS
brew install awscli

# Ubuntu/Debian
sudo apt-get install awscli

# Windows: Descargar desde AWS

# Configurar credenciales AWS
aws configure
```

**Información requerida:**
- AWS Access Key ID
- AWS Secret Access Key  
- Default region: `us-east-1`
- Default output format: `json`

### 3. Permisos IAM Necesarios

Tu usuario AWS debe tener los siguientes permisos:
- `AWSLambdaFullAccess`
- `IAMFullAccess`
- `AmazonS3FullAccess`
- `AmazonAPIGatewayFullAccess`
- `CloudFormationFullAccess`

## Estructura del Proyecto

```
boletas-pdf-service/
├── serverless.yml          # Configuración principal
├── package.json            # Dependencias
├── src/
│   ├── handlers/
│   │   ├── generateBoleta.js
│   │   └── getBoleta.js
│   ├── services/
│   │   └── pdfGenerator.js
│   └── utils/
│       └── helpers.js
└── docs/
    └── serverless-deployment.md
```

## Paso a Paso de Despliegue

### PASO 1: Crear el Directorio del Servicio

```bash
# Crear directorio en la raíz de tu proyecto
mkdir boletas-pdf-service
cd boletas-pdf-service
```

### PASO 2: Inicializar el Proyecto

```bash
# Crear package.json
npm init -y

# Instalar dependencias
npm install @aws-sdk/client-s3 aws-lambda jspdf uuid dayjs

# Instalar dependencias de desarrollo
npm install --save-dev serverless serverless-offline serverless-random-string jest
```

### PASO 3: Crear Archivos de Configuración

#### serverless.yml
Copiar el archivo `serverless.yml` proporcionado en la documentación técnica.

**Puntos importantes:**
- Cambiar `GROUP_NAME` por el nombre de tu grupo
- El bucket se crea automáticamente con un nombre único
- Las funciones Lambda se configuran con timeouts y memoria apropiados

### PASO 4: Implementar Handlers y Servicios

Crear todos los archivos fuente según la estructura proporcionada:

1. `src/handlers/generateBoleta.js` - Handler principal
2. `src/handlers/getBoleta.js` - Handler de consulta
3. `src/services/pdfGenerator.js` - Generador de PDF
4. `src/utils/helpers.js` - Utilidades

### PASO 5: Desplegar el Servicio

```bash
# Desplegar en desarrollo
serverless deploy --stage dev

# Desplegar en producción
serverless deploy --stage prod
```

**Salida esperada:**
```
Service Information
service: boletas-pdf-service
stage: dev
region: us-east-1
stack: boletas-pdf-service-dev
resources: 8
api keys:
  None
endpoints:
  POST - https://xxxxxxx.execute-api.us-east-1.amazonaws.com/dev/generate-boleta
  GET - https://xxxxxxx.execute-api.us-east-1.amazonaws.com/dev/boleta/{boletaId}
functions:
  generateBoleta: boletas-pdf-service-dev-generateBoleta
  getBoleta: boletas-pdf-service-dev-getBoleta
layers:
  None
```

### PASO 6: Configurar Variables de Entorno en Backend

Agregar al archivo `.env` del backend principal:

```env
# URL del servicio Lambda (obtenida del deploy)
LAMBDA_BOLETAS_URL=https://xxxxxxx.execute-api.us-east-1.amazonaws.com/dev
```

### PASO 7: Verificar el Despliegue

#### Prueba Manual de la API

```bash
# Generar boleta de prueba
curl -X POST https://your-api-url/dev/generate-boleta \
  -H "Content-Type: application/json" \
  -d '{
    "purchaseId": "123",
    "userEmail": "test@example.com",
    "userName": "Usuario Test",
    "symbol": "AAPL",
    "quantity": 10,
    "pricePerShare": 150.00,
    "totalAmount": 1500.00,
    "purchaseDate": "2024-01-01T10:00:00Z"
  }'
```

#### Verificar S3 Bucket

```bash
# Listar buckets creados
aws s3 ls | grep boletas-pdf

# Listar contenido del bucket
aws s3 ls s3://your-bucket-name/ --recursive
```

## Comandos Útiles

### Desarrollo Local

```bash
# Ejecutar offline (desarrollo local)
serverless offline

# Ver logs en tiempo real
serverless logs -f generateBoleta --tail

# Ejecutar función específica
serverless invoke -f generateBoleta --data '{"body": "{\"test\": true}"}'
```

### Gestión del Servicio

```bash
# Ver información del stack
serverless info

# Actualizar solo función específica
serverless deploy function -f generateBoleta

# Remover todo el servicio
serverless remove
```

### Debugging

```bash
# Ver logs de CloudWatch
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/boletas-pdf"

# Descargar logs
aws logs get-log-events --log-group-name "/aws/lambda/boletas-pdf-service-dev-generateBoleta"
```

## Integración con el Backend Principal

### Modificaciones Requeridas

1. **Agregar tabla en base de datos:**
```sql
CREATE TABLE IF NOT EXISTS boletas (
    id SERIAL PRIMARY KEY,
    boleta_id UUID NOT NULL UNIQUE,
    purchase_id INTEGER REFERENCES purchase_requests(id),
    user_id INTEGER REFERENCES users(id),
    download_url VARCHAR(500) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

2. **Agregar endpoints en `api/server.js`:**
   - `POST /boletas/generate` - Generar boleta
   - `GET /boletas/my-boletas` - Listar boletas del usuario
   - `GET /boletas/:boletaId` - Obtener boleta específica

3. **Actualizar frontend:**
   - Agregar botón de descarga en `MyPurchases.jsx`
   - Implementar funciones de API en `apiService.js`

## Troubleshooting

### Errores Comunes

#### Error: "Unable to import module"
```bash
# Verificar que todas las dependencias estén instaladas
npm install

# Verificar sintaxis
node -c src/handlers/generateBoleta.js
```

#### Error: "AccessDenied" en S3
```bash
# Verificar permisos del bucket
aws s3api get-bucket-policy --bucket your-bucket-name

# Verificar configuración del rol IAM
serverless info --verbose
```

#### Error: "Function timeout"
- Aumentar timeout en `serverless.yml`
- Optimizar generación de PDF
- Verificar logs con `serverless logs`

### Monitoreo

#### CloudWatch Metrics
- Duración de ejecución
- Errores de función
- Memoria utilizada
- Invocaciones por minuto

#### Alertas Recomendadas
- Error rate > 1%
- Duración > 20 segundos
- Throttles > 0

## Costos y Limitaciones

### AWS Free Tier
- 1M invocaciones Lambda/mes
- 400,000 GB-segundos compute/mes
- 5GB almacenamiento S3
- 20,000 GET requests S3/mes

### Limitaciones Lambda
- Timeout máximo: 15 minutos
- Memoria máxima: 10,240 MB
- Payload máximo: 6 MB (síncrono)
- Tamaño de deployment: 50 MB (comprimido)

## Seguridad

### Buenas Prácticas
1. Usar variables de entorno para configuración
2. Implementar validación estricta de input
3. Configurar CORS adecuadamente
4. Rotar credenciales AWS regularmente
5. Monitorear acceso a S3 buckets

### Configuración de CORS
```yaml
events:
  - http:
      path: /generate-boleta
      method: post
      cors:
        origin: 'https://your-frontend-domain.com'
        headers:
          - Content-Type
          - Authorization
```

## Mantenimiento

### Actualizaciones
```bash
# Actualizar dependencias
npm update

# Verificar vulnerabilidades
npm audit

# Corregir vulnerabilidades
npm audit fix
```

### Backup
- Los buckets S3 tienen versionado habilitado
- Configurar lifecycle policies para archivos antiguos
- Backup regular de configuración en Git

---

**Última actualización:** Enero 2024  
**Versión del servicio:** 1.0.0  
**Autor:** Grupo1 - E2 Arquitectura de Sistemas