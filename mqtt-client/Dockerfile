FROM node:18
WORKDIR /app

# Copiar package files
COPY package*.json ./

# Instalar dependencias
RUN npm install

# Instalar dependencias adicionales específicas
RUN npm install uuid express dotenv

# Copiar código fuente
COPY . .

# Exponer puerto para el mini servidor
EXPOSE 3000

# Comando por defecto
CMD ["node", "mqttConnect.js"]