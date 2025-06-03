#!/bin/bash

# ========================================
# Script para obtener información de Lambda
# ========================================

# Colores
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  INFORMACIÓN DE AWS LAMBDA${NC}"
echo -e "${BLUE}========================================${NC}"

# Obtener Account ID
echo -e "\n${GREEN}1. Account ID:${NC}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo -e "${YELLOW}$ACCOUNT_ID${NC}"

# Obtener región actual
echo -e "\n${GREEN}2. Región actual:${NC}"
REGION=$(aws configure get region)
echo -e "${YELLOW}$REGION${NC}"

# Buscar funciones de boletas
echo -e "\n${GREEN}3. Funciones Lambda de boletas:${NC}"
LAMBDA_FUNCTIONS=$(aws lambda list-functions --query 'Functions[?starts_with(FunctionName, `boletas`)].{Name:FunctionName,ARN:FunctionArn}' --output json)

if [ "$LAMBDA_FUNCTIONS" == "[]" ]; then
    echo -e "${RED}❌ No se encontraron funciones Lambda que empiecen con 'boletas'${NC}"
    echo -e "${YELLOW}Buscando todas las funciones disponibles...${NC}"
    aws lambda list-functions --query 'Functions[].{Name:FunctionName,Runtime:Runtime}' --output table
else
    echo "$LAMBDA_FUNCTIONS" | jq -r '.[] | "• \(.Name): \(.ARN)"'
fi

# Generar ARNs esperados
echo -e "\n${GREEN}4. ARNs esperados para las funciones de boletas:${NC}"
echo -e "${YELLOW}Generate Boleta:${NC}"
echo "arn:aws:lambda:$REGION:$ACCOUNT_ID:function:boletas-pdf-grupo1-dev-generateBoleta"

echo -e "${YELLOW}Get Boleta Status:${NC}"
echo "arn:aws:lambda:$REGION:$ACCOUNT_ID:function:boletas-pdf-grupo1-dev-getBoletaStatus"

echo -e "${YELLOW}Health Check:${NC}"
echo "arn:aws:lambda:$REGION:$ACCOUNT_ID:function:boletas-pdf-grupo1-dev-healthCheck"

# Verificar si las funciones existen
echo -e "\n${GREEN}5. Verificando si las funciones existen:${NC}"

check_function() {
    local function_name=$1
    if aws lambda get-function --function-name "$function_name" &>/dev/null; then
        echo -e "✅ $function_name"
    else
        echo -e "❌ $function_name ${RED}(NO EXISTE)${NC}"
    fi
}

check_function "boletas-pdf-grupo1-dev-generateBoleta"
check_function "boletas-pdf-grupo1-dev-getBoletaStatus"
check_function "boletas-pdf-grupo1-dev-healthCheck"

# Generar configuración para el script
echo -e "\n${GREEN}6. Configuración para setup-api-gateway.sh:${NC}"
echo -e "${BLUE}# Copia esta configuración en tu setup-api-gateway.sh:${NC}"
echo ""
echo "API_GATEWAY_ID=\"c50kleawcc\"  # CAMBIAR POR TU ID REAL"
echo "AWS_REGION=\"$REGION\""
echo "STAGE_NAME=\"dev\""
echo ""
echo "# ARNs de funciones Lambda:"
echo "GENERATE_BOLETA_FUNCTION_ARN=\"arn:aws:lambda:$REGION:$ACCOUNT_ID:function:boletas-pdf-grupo1-dev-generateBoleta\""
echo "GET_BOLETA_STATUS_FUNCTION_ARN=\"arn:aws:lambda:$REGION:$ACCOUNT_ID:function:boletas-pdf-grupo1-dev-getBoletaStatus\""
echo "HEALTH_CHECK_FUNCTION_ARN=\"arn:aws:lambda:$REGION:$ACCOUNT_ID:function:boletas-pdf-grupo1-dev-healthCheck\""

# Mostrar las funciones que realmente existen
echo -e "\n${GREEN}7. Si las funciones tienen nombres diferentes, aquí están todas:${NC}"
aws lambda list-functions --query 'Functions[].FunctionName' --output table

echo -e "\n${BLUE}========================================${NC}"
echo -e "${GREEN}¡Información recopilada!${NC}"
echo -e "${YELLOW}Usa la configuración de arriba en tu setup-api-gateway.sh${NC}"
echo -e "${BLUE}========================================${NC}"
