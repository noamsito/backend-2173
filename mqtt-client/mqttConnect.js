import mqtt from "mqtt";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const options = {
    host: process.env.HOST || 'broker.iic2173.org',
    port: process.env.PORT || 9000,
    username: process.env.USERNAME || 'students',
    password: process.env.PASSWORD || 'iic2173-2025-1-students',
    clean: true, 
    protocol: "mqtt",
    reconnectPeriod: 1000, // Reconexión cada 1 segundo si se pierde la conexión
};

const UPDATES_TOPIC = "stocks/updates";
const REQUESTS_TOPIC = "stocks/requests";
const GROUP_ID = process.env.GROUP_ID || "your-group-id"; // Cambiar por tu ID de grupo

console.log("Conectando a MQTT broker:", options);

const client = mqtt.connect(options);

// Gestión de reconexión usando retraso fibonacci
let reconnectCount = 0;
const fibSequence = [1, 1, 2, 3, 5, 8, 13, 21, 34];

client.on('close', () => {
    console.log('Conexión cerrada. Intentando reconectar...');
});

client.on('reconnect', () => {
    const delayIndex = Math.min(reconnectCount, fibSequence.length - 1);
    const delayTime = fibSequence[delayIndex] * 1000;
    console.log(`Reintentando conexión en ${delayTime/1000} segundos...`);
    reconnectCount++;
});

client.on("connect", () => {
    console.log("Conectado a MQTT broker");
    reconnectCount = 0; // Resetear contador de reconexión

    // Suscribir a ambos canales
    client.subscribe([UPDATES_TOPIC, REQUESTS_TOPIC], (err) => {
        if (!err) {
            console.log("Suscrito a:", UPDATES_TOPIC, REQUESTS_TOPIC);
        } else {
            console.error("Error de suscripción:", err);
        }
    });
});

client.on("message", (topic, message) => {
    const messageStr = message.toString();
    console.log(`Mensaje recibido de ${topic}:`, messageStr);
    
    if (topic === UPDATES_TOPIC) {
        // Manejo de actualizaciones de stocks
        handleStockUpdate(topic, messageStr);
    } else if (topic === REQUESTS_TOPIC) {
        // Manejo de solicitudes y validaciones de compra
        handlePurchaseMessage(messageStr);
    }
});

async function handleStockUpdate(topic, messageStr) {
    try {
        const data = { topic, message: messageStr };
        
        // Intento con retraso fibonacci
        let maxRetries = 5;
        let retryCount = 0;
        let success = false;
        
        while (!success && retryCount < maxRetries) {
            try {
                const response = await fetch(process.env.API_URL || "http://api:3000/stocks", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data)
                });
                
                if (response.ok) {
                    const responseData = await response.json();
                    console.log("Respuesta:", responseData);
                    success = true;
                } else {
                    throw new Error(`Error HTTP! Status: ${response.status}`);
                }
            } catch (err) {
                const delayIndex = Math.min(retryCount, fibSequence.length - 1);
                const delayTime = fibSequence[delayIndex] * 1000;
                console.error(`Error al enviar actualización, reintentando en ${delayTime/1000} segundos:`, err);
                await new Promise(resolve => setTimeout(resolve, delayTime));
                retryCount++;
            }
        }
        
        if (!success) {
            console.error("Máximo de intentos alcanzado al enviar actualización");
        }
    } catch (err) {
        console.error("Error procesando actualización de stock:", err);
    }
}

async function handlePurchaseMessage(messageStr) {
    try {
        const purchaseData = JSON.parse(messageStr);
        
        // Registrar todas las solicitudes de compra en el log de eventos
        await logEvent('PURCHASE_REQUEST', purchaseData);
        
        // Si es una respuesta de validación (para cualquier grupo)
        if (purchaseData.request_id && (purchaseData.status === 'ACCEPTED' || 
                                       purchaseData.status === 'REJECTED' || 
                                       purchaseData.status === 'OK' || 
                                       purchaseData.status === 'error')) {
            
            // Reenviar la validación a nuestra API
            const endpointUrl = process.env.API_URL ? 
                `${process.env.API_URL.replace('/stocks', '')}/purchase-validation` : 
                "http://api:3000/purchase-validation";
            
            await fetchWithRetry(endpointUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: messageStr
            }, "validación de compra");
        } 
        // Si es una solicitud de compra de otro grupo
        else if (purchaseData.group_id && purchaseData.group_id !== GROUP_ID && 
                 purchaseData.operation === "BUY") {
            
            // Reenviar la compra externa a nuestra API para actualizar inventario
            const endpointUrl = process.env.API_URL ? 
                `${process.env.API_URL.replace('/stocks', '')}/external-purchase` : 
                "http://api:3000/external-purchase";
            
            await fetchWithRetry(endpointUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: messageStr
            }, "compra externa");
        }
    } catch (err) {
        console.error("Error procesando mensaje de compra:", err);
    }
}

async function fetchWithRetry(url, options, operationName = "operación") {
    let maxRetries = 5;
    let retryCount = 0;
    let success = false;
    
    while (!success && retryCount < maxRetries) {
        try {
            const response = await fetch(url, options);
            
            if (response.ok) {
                const data = await response.json();
                console.log(`${operationName} procesada:`, data);
                success = true;
                return data;
            } else {
                throw new Error(`Error HTTP! Status: ${response.status}`);
            }
        } catch (err) {
            const delayIndex = Math.min(retryCount, fibSequence.length - 1);
            const delayTime = fibSequence[delayIndex] * 1000;
            console.error(`Error procesando ${operationName}, reintentando en ${delayTime/1000} segundos:`, err);
            await new Promise(resolve => setTimeout(resolve, delayTime));
            retryCount++;
        }
    }
    
    if (!success) {
        console.error(`Máximo de intentos alcanzado al procesar ${operationName}`);
        return null;
    }
}

async function logEvent(type, details) {
    try {
        const endpointUrl = process.env.API_URL ? 
            `${process.env.API_URL.replace('/stocks', '')}/events` : 
            "http://api:3000/events";
        
        await fetchWithRetry(endpointUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type, details })
        }, "registro de evento");
    } catch (err) {
        console.error("Error registrando evento:", err);
    }
}

// Función para publicar solicitudes de compra
function publishPurchaseRequest(requestData) {
    const requestId = requestData.request_id || uuidv4();
    const message = {
        request_id: requestId,
        group_id: GROUP_ID,
        timestamp: new Date().toISOString(),
        quantity: requestData.quantity,
        symbol: requestData.symbol,
        stock_origin: 0, // Siempre 0 según los requisitos
        operation: "BUY" // Siempre "BUY" según los requisitos
    };
    
    client.publish(REQUESTS_TOPIC, JSON.stringify(message));
    console.log("Solicitud de compra publicada:", message);
    return requestId;
}

export default client;
export { publishPurchaseRequest };