#!/bin/bash

echo "🔄 Reconstruyendo contenedores después de cambios..."
echo "=================================================="

# Parar y eliminar contenedores existentes
echo "1. Parando contenedores existentes..."
sudo docker-compose down

# Eliminar contenedores que puedan estar cacheados
echo "2. Limpiando contenedores anteriores..."
sudo docker container prune -f

# Eliminar imágenes relacionadas al proyecto
echo "3. Eliminando imágenes del proyecto..."
sudo docker images | grep -E "(backend-2173|mqtt|api)" | awk '{print $3}' | xargs -r sudo docker rmi -f

# Reconstruir desde cero
echo "4. Reconstruyendo servicios..."
sudo docker-compose build --no-cache mqtt-client
sudo docker-compose build --no-cache api

# Levantar servicios en orden
echo "5. Levantando servicios..."
sudo docker-compose up -d db redis
sleep 10
sudo docker-compose up -d api jobmaster worker
sleep 5
sudo docker-compose up -d mqtt-client

echo ""
echo "✅ Reconstrucción completada!"
echo ""
echo "📊 Estado de los contenedores:"
sudo docker-compose ps

echo ""
echo "📋 Para ver logs:"
echo "  sudo docker-compose logs -f mqtt-client"
echo "  sudo docker-compose logs -f api"

echo ""
echo "🔧 Para verificar conexión MQTT:"
echo "  sudo docker-compose exec mqtt-client sh"
