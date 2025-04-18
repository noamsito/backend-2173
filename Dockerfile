# Usa una imagen base oficial de Node
FROM node:18-alpine

# Crea un directorio de trabajo dentro del contenedor
WORKDIR /app

# Copia el package.json y package-lock.json (si existe)
COPY package*.json ./

# Instala las dependencias
RUN npm install

# Copia el resto del código
COPY . .

# Expone el puerto 3000 dentro del contenedor
EXPOSE 3000

# Comando para iniciar la aplicación
CMD ["node", "app/src/index.js"]