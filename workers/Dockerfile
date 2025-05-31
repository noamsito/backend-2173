FROM node:18-alpine

WORKDIR /app

# Copiar package.json
COPY package*.json ./

# Instalar dependencias (usar npm install en lugar de npm ci)
RUN npm install --only=production

# Copiar código fuente
COPY . .

# Usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs
RUN adduser -S worker -u 1001
USER worker

# Comando por defecto
CMD ["npm", "start"]