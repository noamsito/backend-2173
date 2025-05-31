FROM node:18
WORKDIR /app

# Copiar package files (desde el nuevo contexto)
COPY ./api/package*.json ./

# Instala todas las dependencias, incluyendo express-oauth2-jwt-bearer
RUN npm install
RUN npm install express-oauth2-jwt-bearer
RUN npm install uuid auth0@latest node-fetch@2 axios
RUN npm install newrelic --save

# Copiar NewRelic config
COPY ./api/newrelic.cjs ./newrelic.cjs

# AGREGAR ESTA LÍNEA: Copiar la carpeta db
COPY ./db ./db

# Copiar el resto del código del API
COPY ./api .

EXPOSE 3000
CMD ["node", "--experimental-loader", "newrelic/esm-loader.mjs", "-r", "newrelic", "server.js"]
