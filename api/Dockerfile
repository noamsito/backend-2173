FROM node:18
WORKDIR /app
COPY package*.json ./

# Instala todas las dependencias, incluyendo express-oauth2-jwt-bearer
RUN npm install
RUN npm install express-oauth2-jwt-bearer
RUN npm install uuid

COPY . .
EXPOSE 3000
CMD ["node", "server.js"]