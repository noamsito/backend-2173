FROM node:18
WORKDIR /app
COPY package*.json ./

# Instala todas las dependencias, incluyendo express-oauth2-jwt-bearer
RUN npm install
RUN npm install express-oauth2-jwt-bearer
RUN npm install uuid auth0@latest node-fetch@2 axios
RUN npm install newrelic --save
COPY newrelic.cjs ./newrelic.cjs
COPY . .
EXPOSE 3000
CMD ["node", "--experimental-loader", "newrelic/esm-loader.mjs", "-r", "newrelic", "server.js"]
