#!/bin/bash

echo "🔧 Configurando modo BYPASS de autenticación para pruebas"
echo "========================================================="

# Verificar que estamos en el directorio correcto
if [ ! -f "api/server.js" ]; then
    echo "❌ Error: Ejecuta este script desde el directorio backend-2173"
    exit 1
fi

echo "📋 1. Configurando variables de entorno..."
# El archivo .env ya debería estar configurado con BYPASS_AUTH=true

echo "📊 2. Creando usuario de prueba en la base de datos..."
# Ejecutar el script SQL
if command -v psql &> /dev/null; then
    echo "   Ejecutando script SQL..."
    psql -h localhost -p 5432 -U postgres -d postgres -f db/insert-test-user.sql
    if [ $? -eq 0 ]; then
        echo "   ✅ Usuario de prueba creado exitosamente"
    else
        echo "   ⚠️  Error al ejecutar script SQL, pero continuando..."
    fi
else
    echo "   ⚠️  psql no encontrado. Ejecuta manualmente: psql -f db/insert-test-user.sql"
fi

echo "🚀 3. Iniciando el servidor en modo bypass..."
echo "   BYPASS_AUTH=true"
echo "   Usuario de prueba: ID=1, Email=test@ejemplo.com"
echo "   Balance inicial: $10,000,000"

echo ""
echo "✅ Configuración completa!"
echo "   • El backend permitirá requests sin autenticación"
echo "   • El frontend saltará la pantalla de login"
echo "   • Usa el usuario ID=1 para todas las operaciones"
echo ""
echo "Para iniciar el servidor:"
echo "   cd api && npm start"
echo ""
echo "Para volver al modo normal, cambia BYPASS_AUTH=false en .env" 