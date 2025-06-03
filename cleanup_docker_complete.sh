#!/bin/bash

echo "🧹 LIMPIEZA COMPLETA DE DOCKER"
echo "============================="

# Bajar todos los contenedores del proyecto
echo "1. Bajando contenedores del proyecto..."
sudo docker-compose down --remove-orphans

# Eliminar contenedores parados
echo "2. Eliminando contenedores parados..."
sudo docker container prune -f

# Eliminar redes no utilizadas
echo "3. Eliminando redes no utilizadas..."
sudo docker network prune -f

# Eliminar volúmenes no utilizados
echo "4. Eliminando volúmenes no utilizados..."
sudo docker volume prune -f

# Limpieza general del sistema
echo "5. Limpieza general del sistema..."
sudo docker system prune -f

echo "✅ Limpieza completada"

# Mostrar estado final
echo "📊 Estado final:"
echo "Contenedores activos:"
sudo docker ps
echo ""
echo "Redes activas:"
sudo docker network ls
echo ""
echo "Espacio en disco:"
df -h /

echo "============================="
