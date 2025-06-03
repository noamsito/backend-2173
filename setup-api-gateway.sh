#!/bin/bash

# ========================================
# Script para configurar API Gateway
# ========================================

set -e  # Salir si hay algún error

# Colores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Función para logging
log() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# ========================================
# CONFIGURACIÓN - MODIFICAR SEGÚN TUS DATOS
# ========================================

# ID de tu API Gateway (obtenerlo de AWS Console)
API_GATEWAY_ID="r12c7vfhig"  # CAMBIAR POR TU ID REAL

# Región de AWS
AWS_REGION="us-east-1"

# Stage name
STAGE_NAME="dev"

# ARNs de tus funciones Lambda (CAMBIAR POR TUS ARNs REALES)
GENERATE_BOLETA_FUNCTION_ARN="arn:aws:lambda:us-east-1:131844918762:function:boletas-pdf-grupo1-dev-generateBoleta"
GET_BOLETA_STATUS_FUNCTION_ARN="arn:aws:lambda:us-east-1:131844918762:function:boletas-pdf-grupo1-dev-getBoletaStatus"
HEALTH_CHECK_FUNCTION_ARN="arn:aws:lambda:us-east-1:131844918762:function:boletas-pdf-grupo1-dev-healthCheck"

# ========================================
# VERIFICAR PREREQUISITOS
# ========================================

log "Verificando prerequisites..."

# Verificar que AWS CLI está instalado
if ! command -v aws &> /dev/null; then
    error "AWS CLI no está instalado. Por favor instalar primero."
    exit 1
fi

# Verificar que jq está instalado
if ! command -v jq &> /dev/null; then
    error "jq no está instalado. Instalando..."
    # Para Ubuntu/Debian
    sudo apt-get update && sudo apt-get install -y jq 2>/dev/null || \
    # Para macOS
    brew install jq 2>/dev/null || \
    error "No se pudo instalar jq automáticamente. Por favor instalar manualmente."
fi

# Verificar credenciales de AWS
if ! aws sts get-caller-identity &> /dev/null; then
    error "No se pudo acceder a AWS. Verificar credenciales."
    exit 1
fi

log "Prerequisites verificados ✓"

# ========================================
# OBTENER INFORMACIÓN DEL API GATEWAY
# ========================================

log "Obteniendo información del API Gateway..."

# Obtener el root resource ID
ROOT_RESOURCE_ID=$(aws apigateway get-resources \
    --rest-api-id "$API_GATEWAY_ID" \
    --region "$AWS_REGION" \
    --query 'items[?path==`/`].id' \
    --output text)

if [ -z "$ROOT_RESOURCE_ID" ]; then
    error "No se pudo obtener el root resource ID"
    exit 1
fi

log "Root Resource ID: $ROOT_RESOURCE_ID"

# Obtener Account ID para los ARNs
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
log "Account ID: $ACCOUNT_ID"

# Actualizar ARNs con el Account ID correcto
GENERATE_BOLETA_FUNCTION_ARN="arn:aws:lambda:$AWS_REGION:$ACCOUNT_ID:function:boletas-pdf-grupo1-dev-generateBoleta"
GET_BOLETA_STATUS_FUNCTION_ARN="arn:aws:lambda:$AWS_REGION:$ACCOUNT_ID:function:boletas-pdf-grupo1-dev-getBoletaStatus"
HEALTH_CHECK_FUNCTION_ARN="arn:aws:lambda:$AWS_REGION:$ACCOUNT_ID:function:boletas-pdf-grupo1-dev-healthCheck"

# ========================================
# FUNCIÓN PARA CREAR RECURSOS
# ========================================

create_resource() {
    local parent_id=$1
    local path_part=$2
    
    log "Creando recurso: $path_part"
    
    local resource_id=$(aws apigateway create-resource \
        --rest-api-id "$API_GATEWAY_ID" \
        --parent-id "$parent_id" \
        --path-part "$path_part" \
        --region "$AWS_REGION" \
        --query 'id' \
        --output text 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        log "Recurso $path_part creado con ID: $resource_id"
        echo "$resource_id"
    else
        warn "El recurso $path_part ya existe o hubo un error"
        # Intentar obtener el ID del recurso existente
        local existing_id=$(aws apigateway get-resources \
            --rest-api-id "$API_GATEWAY_ID" \
            --region "$AWS_REGION" \
            --query "items[?pathPart=='$path_part'].id" \
            --output text)
        echo "$existing_id"
    fi
}

# ========================================
# FUNCIÓN PARA CREAR MÉTODOS
# ========================================

create_method() {
    local resource_id=$1
    local http_method=$2
    local function_arn=$3
    local resource_name=$4
    
    log "Creando método $http_method para $resource_name"
    
    # Crear el método
    aws apigateway put-method \
        --rest-api-id "$API_GATEWAY_ID" \
        --resource-id "$resource_id" \
        --http-method "$http_method" \
        --authorization-type "NONE" \
        --region "$AWS_REGION" &>/dev/null || warn "Método $http_method ya existe"
    
    # Crear la integración con Lambda
    aws apigateway put-integration \
        --rest-api-id "$API_GATEWAY_ID" \
        --resource-id "$resource_id" \
        --http-method "$http_method" \
        --type "AWS_PROXY" \
        --integration-http-method "POST" \
        --uri "arn:aws:apigateway:$AWS_REGION:lambda:path/2015-03-31/functions/$function_arn/invocations" \
        --region "$AWS_REGION" &>/dev/null || warn "Integración ya existe"
    
    # Dar permisos a API Gateway para invocar la Lambda
    aws lambda add-permission \
        --function-name "$function_arn" \
        --statement-id "apigateway-invoke-$resource_name-$(date +%s)" \
        --action "lambda:InvokeFunction" \
        --principal "apigateway.amazonaws.com" \
        --source-arn "arn:aws:execute-api:$AWS_REGION:$ACCOUNT_ID:$API_GATEWAY_ID/*/*" \
        --region "$AWS_REGION" &>/dev/null || warn "Permisos ya otorgados"
    
    log "Método $http_method configurado para $resource_name ✓"
}

# ========================================
# FUNCIÓN PARA HABILITAR CORS
# ========================================

enable_cors() {
    local resource_id=$1
    local methods=$2
    local resource_name=$3
    
    log "Habilitando CORS para $resource_name"
    
    # Crear método OPTIONS
    aws apigateway put-method \
        --rest-api-id "$API_GATEWAY_ID" \
        --resource-id "$resource_id" \
        --http-method "OPTIONS" \
        --authorization-type "NONE" \
        --region "$AWS_REGION" &>/dev/null || warn "Método OPTIONS ya existe"
    
    # Crear integración MOCK para OPTIONS
    aws apigateway put-integration \
        --rest-api-id "$API_GATEWAY_ID" \
        --resource-id "$resource_id" \
        --http-method "OPTIONS" \
        --type "MOCK" \
        --request-templates '{"application/json":"{\"statusCode\":200}"}' \
        --region "$AWS_REGION" &>/dev/null || warn "Integración OPTIONS ya existe"
    
    # Respuesta del método OPTIONS
    aws apigateway put-method-response \
        --rest-api-id "$API_GATEWAY_ID" \
        --resource-id "$resource_id" \
        --http-method "OPTIONS" \
        --status-code "200" \
        --response-parameters '{
            "method.response.header.Access-Control-Allow-Headers": false,
            "method.response.header.Access-Control-Allow-Methods": false,
            "method.response.header.Access-Control-Allow-Origin": false
        }' \
        --region "$AWS_REGION" &>/dev/null || warn "Method response ya existe"
    
    # Respuesta de la integración OPTIONS
    aws apigateway put-integration-response \
        --rest-api-id "$API_GATEWAY_ID" \
        --resource-id "$resource_id" \
        --http-method "OPTIONS" \
        --status-code "200" \
        --response-parameters '{
            "method.response.header.Access-Control-Allow-Headers": "'\''Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'\''",
            "method.response.header.Access-Control-Allow-Methods": "'\'''"$methods"''\''",
            "method.response.header.Access-Control-Allow-Origin": "'\''*'\''"
        }' \
        --region "$AWS_REGION" &>/dev/null || warn "Integration response ya existe"
    
    log "CORS habilitado para $resource_name ✓"
}

# ========================================
# CREAR RECURSOS Y MÉTODOS
# ========================================

log "Iniciando configuración del API Gateway..."

# 1. Crear recurso /generate-boleta
log "=== Configurando /generate-boleta ==="
GENERATE_BOLETA_RESOURCE_ID=$(create_resource "$ROOT_RESOURCE_ID" "generate-boleta")
create_method "$GENERATE_BOLETA_RESOURCE_ID" "POST" "$GENERATE_BOLETA_FUNCTION_ARN" "generate-boleta"
enable_cors "$GENERATE_BOLETA_RESOURCE_ID" "OPTIONS,POST" "generate-boleta"

# 2. Crear recurso /boleta
log "=== Configurando /boleta ==="
BOLETA_RESOURCE_ID=$(create_resource "$ROOT_RESOURCE_ID" "boleta")

# 3. Crear recurso /boleta/{boletaId}
log "=== Configurando /boleta/{boletaId} ==="
BOLETA_ID_RESOURCE_ID=$(create_resource "$BOLETA_RESOURCE_ID" "{boletaId}")
create_method "$BOLETA_ID_RESOURCE_ID" "GET" "$GET_BOLETA_STATUS_FUNCTION_ARN" "boleta-status"
enable_cors "$BOLETA_ID_RESOURCE_ID" "OPTIONS,GET" "boleta-status"

# 4. Crear recurso /health
log "=== Configurando /health ==="
HEALTH_RESOURCE_ID=$(create_resource "$ROOT_RESOURCE_ID" "health")
create_method "$HEALTH_RESOURCE_ID" "GET" "$HEALTH_CHECK_FUNCTION_ARN" "health"
enable_cors "$HEALTH_RESOURCE_ID" "OPTIONS,GET" "health"

# ========================================
# DESPLEGAR LA API
# ========================================

log "Desplegando API en stage: $STAGE_NAME"

aws apigateway create-deployment \
    --rest-api-id "$API_GATEWAY_ID" \
    --stage-name "$STAGE_NAME" \
    --description "Deployment automático - $(date)" \
    --region "$AWS_REGION" &>/dev/null

log "API desplegada exitosamente ✓"

# ========================================
# MOSTRAR INFORMACIÓN FINAL
# ========================================

API_URL="https://$API_GATEWAY_ID.execute-api.$AWS_REGION.amazonaws.com/$STAGE_NAME"

echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}    CONFIGURACIÓN COMPLETADA ✓${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "${GREEN}URL base del API Gateway:${NC}"
echo -e "${YELLOW}$API_URL${NC}"
echo ""
echo -e "${GREEN}Endpoints disponibles:${NC}"
echo -e "• POST   $API_URL/generate-boleta"
echo -e "• GET    $API_URL/boleta/{boletaId}"
echo -e "• GET    $API_URL/health"
echo ""
echo -e "${GREEN}Para usar en tu .env:${NC}"
echo -e "${YELLOW}VITE_BOLETAS_API_URL=$API_URL${NC}"
echo ""

# ========================================
# VERIFICAR QUE FUNCIONA
# ========================================

log "Verificando endpoints..."

# Test health endpoint
echo -e "\n${BLUE}Testeando /health:${NC}"
curl -s "$API_URL/health" | jq . || echo "Error en health endpoint"

echo ""
echo -e "${GREEN}¡Configuración completada!${NC}"
echo -e "${YELLOW}Recuerda actualizar tu archivo .env con la URL mostrada arriba.${NC}"
