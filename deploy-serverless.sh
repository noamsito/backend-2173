#!/bin/bash
# deploy-serverless.sh - Script de deployment para API Gateway + Lambda

set -e

echo "🚀 Desplegando servicio de boletas serverless..."

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Función para logging
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Verificar prerequisitos
log "Verificando prerequisitos..."

# Verificar AWS CLI
if ! command -v aws &> /dev/null; then
    error "AWS CLI no está instalado. Instálalo desde: https://aws.amazon.com/cli/"
    exit 1
fi

# Verificar credenciales AWS
if ! aws sts get-caller-identity &> /dev/null; then
    error "Credenciales AWS no configuradas. Ejecuta: aws configure"
    exit 1
fi

# Verificar Serverless Framework
if ! command -v serverless &> /dev/null; then
    warning "Serverless Framework no encontrado. Instalándolo..."
    npm install -g serverless
fi

# Verificar Node.js versión
node_version=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$node_version" -lt 18 ]; then
    error "Node.js 18+ requerido. Versión actual: $(node -v)"
    exit 1
fi

success "Prerequisitos verificados ✓"

# Crear directorio del proyecto si no existe
PROJECT_DIR="boletas-serverless"
if [ ! -d "$PROJECT_DIR" ]; then
    log "Creando directorio del proyecto..."
    mkdir -p "$PROJECT_DIR"
fi

cd "$PROJECT_DIR"

# Crear estructura de directorios
log "Creando estructura de directorios..."
mkdir -p src/handlers
mkdir -p schemas
mkdir -p tests
mkdir -p scripts

# Crear package.json si no existe
if [ ! -f "package.json" ]; then
    log "Creando package.json..."
    cat > package.json << 'EOF'
{
  "name": "boletas-pdf-serverless",
  "version": "1.0.0",
  "description": "Servicio serverless para generación de boletas PDF",
  "type": "module",
  "scripts": {
    "deploy": "serverless deploy",
    "deploy:dev": "serverless deploy --stage dev",
    "deploy:prod": "serverless deploy --stage prod",
    "remove": "serverless remove",
    "logs": "serverless logs -f generateBoleta -t",
    "test": "npm run test:unit && npm run test:integration",
    "test:unit": "jest tests/unit/",
    "test:integration": "jest tests/integration/",
    "setup": "npm install && npm run deploy:dev"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.454.0",
    "pdfkit": "^0.14.0",
    "uuid": "^9.0.1"
  },
  "devDependencies": {
    "serverless": "^3.38.0",
    "serverless-offline": "^13.3.0",
    "jest": "^29.7.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
EOF
fi

# Crear schema de validación
log "Creando schema de validación..."
cat > schemas/boleta-request.json << 'EOF'
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "properties": {
    "userId": {
      "type": ["string", "number"],
      "description": "ID del usuario"
    },
    "userName": {
      "type": "string",
      "minLength": 1,
      "description": "Nombre del usuario"
    },
    "userEmail": {
      "type": "string",
      "format": "email",
      "description": "Email del usuario"
    },
    "purchaseId": {
      "type": "string",
      "description": "ID de la compra"
    },
    "stockSymbol": {
      "type": "string",
      "minLength": 1,
      "description": "Símbolo de la acción"
    },
    "quantity": {
      "type": "number",
      "minimum": 1,
      "description": "Cantidad de acciones"
    },
    "pricePerShare": {
      "type": "number",
      "minimum": 0,
      "description": "Precio por acción"
    },
    "totalAmount": {
      "type": "number",
      "minimum": 0,
      "description": "Monto total"
    }
  },
  "required": ["userId", "userName", "stockSymbol", "quantity", "pricePerShare"],
  "additionalProperties": false
}
EOF

# Instalar dependencias
log "Instalando dependencias..."
npm install

# Configurar variables de entorno para deployment
STAGE=${1:-dev}
REGION=${AWS_DEFAULT_REGION:-us-east-1}
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

log "Configuración de deployment:"
log "  Stage: $STAGE"
log "  Region: $REGION"
log "  Account ID: $ACCOUNT_ID"

# Verificar si hay cambios en el código antes de deploy
if [ -f ".deployed-hash" ]; then
    CURRENT_HASH=$(find src/ serverless.yml package.json -type f -exec md5sum {} \; | sort | md5sum | cut -d' ' -f1)
    DEPLOYED_HASH=$(cat .deployed-hash 2>/dev/null || echo "")
    
    if [ "$CURRENT_HASH" = "$DEPLOYED_HASH" ]; then
        log "No hay cambios detectados desde el último deployment."
        read -p "¿Deseas continuar con el deployment? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log "Deployment cancelado."
            exit 0
        fi
    fi
fi

# Deployment
log "Iniciando deployment en stage: $STAGE..."

# Deployment con manejo de errores
if serverless deploy --stage "$STAGE" --region "$REGION" --verbose; then
    success "Deployment completado exitosamente!"
    
    # Guardar hash del deployment exitoso
    find src/ serverless.yml package.json -type f -exec md5sum {} \; | sort | md5sum | cut -d' ' -f1 > .deployed-hash
    
    # Obtener información del deployment
    log "Obteniendo información del deployment..."
    
    # URL de API Gateway
    API_URL=$(serverless info --stage "$STAGE" --region "$REGION" | grep "endpoint:" | awk '{print $2}' | head -1)
    
    if [ -n "$API_URL" ]; then
        success "API Gateway URL: $API_URL"
        
        # Test básico del endpoint de health
        log "Probando endpoint de health..."
        sleep 10  # Esperar a que el API esté listo
        
        if curl -f "$API_URL/health" -s > /dev/null; then
            success "Health check exitoso ✓"
        else
            warning "Health check falló - el API podría necesitar más tiempo para estar listo"
        fi
        
        # Guardar URL en archivo para uso posterior
        echo "BOLETAS_LAMBDA_URL=$API_URL" > .env.deployed
        
        log "Variables de entorno guardadas en .env.deployed"
        log "Agrega esta línea a tu backend principal:"
        echo -e "${GREEN}BOLETAS_LAMBDA_URL=$API_URL${NC}"
        
    else
        warning "No se pudo obtener la URL del API Gateway"
    fi
    
    # Mostrar información adicional
    log "Información del deployment:"
    serverless info --stage "$STAGE" --region "$REGION"
    
else
    error "Deployment falló!"
    exit 1
fi

# Cleanup opcional
read -p "¿Deseas ejecutar tests de integración? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    log "Ejecutando tests de integración..."
    npm run test:integration || warning "Algunos tests fallaron"
fi

success "Setup completado!"
log "Próximos pasos:"
log "1. Agrega BOLETAS_LAMBDA_URL=$API_URL a tu backend"
log "2. Reinicia tu backend para cargar la nueva variable"
log "3. Prueba la generación de boletas desde tu frontend"
log "4. Monitorea logs con: serverless logs -f generateBoleta -t --stage $STAGE"