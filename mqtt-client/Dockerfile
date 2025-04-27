FROM node:18
WORKDIR /app
COPY package*.json ./
RUN npm install
RUN npm install uuid auth0@latest node-fetch@2 express
COPY . .
CMD ["node", "mqttConnect.js"]