import mqtt from "mqtt";
import dotenv from "dotenv";
import fetch from "node-fetch";
import { v4 as uuidv4 } from 'uuid';
import express from 'express';

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
const VALIDATION_TOPIC = 'stocks/validation';
const AUCTIONS_TOPIC = "stocks/auctions"; // NUEVO: Canal de subastas
const GROUP_ID = process.env.GROUP_ID || "1"; // Cambiar por tu ID de grupo

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

    // Suscribir a todos los canales incluyendo subastas
    client.subscribe([UPDATES_TOPIC, REQUESTS_TOPIC, VALIDATION_TOPIC, AUCTIONS_TOPIC], (err) => {
        if (!err) {
            console.log("Suscrito a:", UPDATES_TOPIC, REQUESTS_TOPIC, VALIDATION_TOPIC, AUCTIONS_TOPIC);
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
    } else if (topic === VALIDATION_TOPIC) {
        handleValidationMessage(messageStr);
    } else if (topic === AUCTIONS_TOPIC) {
        // NUEVO: Manejo de mensajes de subastas e intercambios
        handleAuctionMessage(messageStr);
    }
});

async function handleValidationMessage(messageStr) {
    try {
        const data = JSON.parse(messageStr);

        if (data.request_id) {
            console.log(`✅ Recibida validación para request_id: ${data.request_id}, status: ${data.status}`);
        }

        // Verificar si la solicitud pertenece a nuestro grupo
        if (isOurRequest(data.request_id)) {
            console.log(`Verificación de propiedad para request_id ${data.request_id}: Es nuestra`);
            console.log(`Procesando respuesta para nuestra solicitud: ${data.request_id}, status: ${data.status}`);

            processValidation(data)
        }
    } catch (err) {
        console.error("Error procesando mensaje de validación:", err);
    }
}

// Agregar esta función después de handleValidationMessage
async function processValidation(validationData) {
    try {
        // Para validaciones de compra
        if (validationData.request_id) {
            console.log(`Procesando validación para request_id: ${validationData.request_id}, status: ${validationData.status}`);
            
            // Llamar al endpoint de validación
            const endpointUrl = "http://api:3000/purchase-validation";
            
            await fetchWithRetry(endpointUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(validationData)
            }, "validación de compra");
        }
        // Si se añaden otros tipos de validación en el futuro, se pueden procesar aquí
    } catch (err) {
        console.error("Error procesando validación:", err);
    }

}

// Agregar esta función si no existe
function isOurRequest(requestId) {
    // Esta función puede usar la misma lógica que checkIfRequestBelongsToUs
    // pero para mayor eficiencia, podríamos mantener un registro local
    // de los request_id que hemos generado
    return checkIfRequestBelongsToUs(requestId);
}

async function handleStockUpdate(topic, messageStr) {
    try {
        const stockData = JSON.parse(messageStr);
        const data = { topic, message: messageStr };
        
        // Intento con retraso fibonacci
        let maxRetries = 5;
        let retryCount = 0;
        let success = false;

        // Registramos el evento primero según su tipo
        // Pero verificamos que no intentemos registrar eventos para datos que ya procesamos
        // usando el timestamp como identificador
        if (stockData.kind === 'IPO') {
            console.log("Procesando IPO para:", stockData.symbol);
            
            // Solo registramos el evento, ya que el POST /stocks también registrará un evento
            // Esto evita duplicados
            console.log(`Recibido evento IPO para ${stockData.symbol}, enviando a API...`);
            
        } else if (stockData.kind === 'EMIT') {
            console.log("Procesando EMIT para:", stockData.symbol);
            
            // Solo registramos el evento en la consola, ya que el POST /stocks registrará el evento
            console.log(`Recibido evento EMIT para ${stockData.symbol}, enviando a API...`);
            
        } else if (stockData.kind === 'UPDATE') {
            console.log("Procesando actualización de precio para:", stockData.symbol);
            
            // Para actualizaciones de precio podemos registrar un evento tipo UPDATE 
            await logEvent('PRICE_UPDATE', stockData);
        }
        
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
        console.log("Mensaje recibido:", purchaseData);
        
        // CASO 1: Es una respuesta (tiene status y kind=response)
        if (purchaseData.status && purchaseData.kind === 'response') {
            
            // Solo procesamos mensajes que tengan request_id
            if (!purchaseData.request_id) {
                console.log("Mensaje de respuesta sin request_id, ignorando");
                return;
            }
            
            // Verificamos si esta respuesta es para una solicitud nuestra
            const isForOurRequest = await checkIfRequestBelongsToUs(purchaseData.request_id);
            
            if (isForOurRequest) {
                console.log(`Procesando respuesta para nuestra solicitud: ${purchaseData.request_id}, status: ${purchaseData.status}`);
                
                // Solo procesamos respuestas finales (ACCEPTED, REJECTED, error)
                // y evitamos procesar las confirmaciones de recepción (OK)
                if (purchaseData.status !== 'OK') {
                    console.log(`🔄 Reenviando respuesta por stocks/validation: ${purchaseData.request_id}, status: ${purchaseData.status}`);
                    client.publish(VALIDATION_TOPIC, JSON.stringify(purchaseData));
                } else {
                    console.log(`Confirmación de recepción para nuestra solicitud: ${purchaseData.request_id}`);
                }
            } else {
                console.log(`Ignorando respuesta para solicitud ajena: ${purchaseData.request_id}`);
            }
        }
        
        // CASO 2: Es una solicitud de compra (tiene operation: "BUY")
        else if (purchaseData.operation === "BUY") {
            // Verificamos primero si el mensaje tiene un group_id válido
            if (!purchaseData.group_id) {
                console.log("Mensaje de compra sin group_id, ignorando");
                return;
            }
            
            // NUEVO: Verificar si tiene deposit_token (solicitudes con WebPay)
            if (purchaseData.deposit_token) {
                console.log(`Solicitud con WebPay detectada: ${purchaseData.request_id}, deposit_token: ${purchaseData.deposit_token}`);
            }
            
            // Verificamos si la solicitud es de otro grupo (no nuestra)
            if (String(purchaseData.group_id) !== String(GROUP_ID)) {
                console.log(`Compra externa del grupo ${purchaseData.group_id} detectada para ${purchaseData.symbol}`);
                
                // Reenviar la compra externa a nuestra API para actualizar inventario
                const endpointUrl = "http://api:3000/external-purchase";
                
                await fetchWithRetry(endpointUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(purchaseData)
                }, "compra externa");
            } else {
                console.log(`Ignorando nuestra propia solicitud de compra: ${purchaseData.request_id || 'sin ID'}`);
            }
        } 
        
        // CASO 3: Mensaje desconocido o malformado
        else {
            console.log("Mensaje con formato desconocido, ignorando");
        }
    } catch (err) {
        console.error("Error procesando mensaje:", err);
    }
}


// Nueva función para verificar si un request_id pertenece a nuestro grupo
async function checkIfRequestBelongsToUs(requestId) {
    try {
        // Consultar a la API si este request_id está en nuestra base de datos
        const endpointUrl = process.env.API_URL ? 
            `${process.env.API_URL.replace('/stocks', '')}/check-request?id=${requestId}` : 
            `http://api:3000/check-request?id=${requestId}`;
            
        const response = await fetch(endpointUrl);
        
        if (!response.ok) {
            console.log(`Request ID ${requestId} no encontrado en nuestra base de datos`);
            return false;
        }
        
        const data = await response.json();
        
        // Imprimir resultado para depuración
        console.log(`Verificación de propiedad para request_id ${requestId}: ${data.belongs_to_us ? 'Es nuestra' : 'No es nuestra'}`);
        
        return data.belongs_to_us === true;
    } catch (err) {
        console.error(`Error verificando request_id ${requestId}:`, err);
        // En caso de error, asumimos que NO es nuestra para evitar procesamiento incorrecto
        return false;
    }
}

async function fetchWithRetry(url, options, operationName = "operación") {
    let maxRetries = 5;
    let retryCount = 0;
    
    while (retryCount < maxRetries) {
        try {
            console.log(`Intentando ${operationName} en ${url}...`);
            const response = await fetch(url, options);
            
            // Capturar y mostrar más detalles sobre la respuesta
            const responseText = await response.text();
            console.log(`Respuesta (${response.status}): ${responseText}`);
            
            let responseData;
            try {
                responseData = JSON.parse(responseText);
            } catch (e) {
                responseData = { text: responseText };
            }
            
            if (response.ok) {
                console.log(`${operationName} procesada:`, responseData);
                return responseData;
            } else {
                throw new Error(`Error HTTP! Status: ${response.status}, Mensaje: ${JSON.stringify(responseData)}`);
            }
        } catch (err) {
            retryCount++;
            
            // Manejo especial para errores 404 (endpoints no encontrados)
            if (err.message.includes("404")) {
                console.error(`Endpoint no encontrado para ${operationName} (URL: ${url})`);
                
                // Solo intentar una vez más con errores 404
                if (retryCount >= 2) {
                    console.error(`Endpoint no encontrado para ${operationName}, saltando reintentos.`);
                    break;
                }
            }
            
            const delayIndex = Math.min(retryCount - 1, fibSequence.length - 1);
            const delayTime = fibSequence[delayIndex] * 1000;
            console.error(`Error procesando ${operationName}, reintentando en ${delayTime/1000} segundos:`, err.message);
            await new Promise(resolve => setTimeout(resolve, delayTime));
        }
    }
    
    console.error(`Máximo de intentos alcanzado al procesar ${operationName}`);
    return null;
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
        quantity: requestData.quantity,
        symbol: requestData.symbol,
        operation: "BUY"
    };
    
    client.publish(REQUESTS_TOPIC, JSON.stringify(message));
    console.log("Solicitud de compra publicada:", message);
    return requestId;
}

// NUEVO: Función para manejar mensajes del canal de subastas siguiendo el formato exacto del enunciado
async function handleAuctionMessage(messageStr) {
    try {
        const auctionData = JSON.parse(messageStr);
        console.log("Mensaje de subasta recibido:", auctionData);
        
        // Verificar si el mensaje tiene el formato del enunciado (con campo "operation")
        if (auctionData.operation) {
            switch (auctionData.operation) {
                case 'offer':
                    await handleOfferReceived(auctionData);
                    break;
                case 'proposal':
                    await handleProposalReceived(auctionData);
                    break;
                case 'acceptance':
                case 'rejection':
                    await handleResponseReceived(auctionData);
                    break;
                default:
                    console.log(`Operación desconocida: ${auctionData.operation}`);
            }
        }
        // Mantener compatibilidad con formato anterior (para mensajes internos)
        else if (auctionData.type) {
        switch (auctionData.type) {
            case 'EXCHANGE_PROPOSAL':
                await handleExchangeProposal(auctionData);
                break;
            case 'EXCHANGE_RESPONSE':
                await handleExchangeResponse(auctionData);
                break;
            default:
                console.log(`Tipo de mensaje de subasta desconocido: ${auctionData.type}`);
            }
        } else {
            console.log("Mensaje de subasta sin tipo, ignorando");
        }
    } catch (err) {
        console.error("Error procesando mensaje de subasta:", err);
    }
}

// NUEVO: Manejar ofertas recibidas (operation: "offer")
async function handleOfferReceived(offerData) {
    try {
        // Verificar si la oferta es de otro grupo
        if (String(offerData.group_id) !== String(GROUP_ID)) {
            console.log(`📥 Oferta recibida del grupo ${offerData.group_id}: ${offerData.quantity} ${offerData.symbol}`);
            
            // Guardar oferta externa en la API
            const endpointUrl = "http://api:3000/admin/external-offers";
            await fetchWithRetry(endpointUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    auction_id: offerData.auction_id,
                    proposal_id: offerData.proposal_id || "",
                    group_id: offerData.group_id,
                    symbol: offerData.symbol,
                    quantity: offerData.quantity,
                    timestamp: offerData.timestamp,
                    operation: offerData.operation
                })
            }, "oferta externa");
        } else {
            console.log(`⚠️ Ignorando nuestra propia oferta: ${offerData.auction_id}`);
        }
    } catch (err) {
        console.error("Error procesando oferta recibida:", err);
    }
}

// NUEVO: Manejar propuestas recibidas (operation: "proposal")
async function handleProposalReceived(proposalData) {
    try {
        // Verificar si la propuesta es de otro grupo
        if (String(proposalData.group_id) !== String(GROUP_ID)) {
            console.log(`📩 Propuesta recibida del grupo ${proposalData.group_id} para auction_id: ${proposalData.auction_id}`);
            console.log(`Detalles: ${proposalData.quantity} ${proposalData.symbol} - proposal_id: ${proposalData.proposal_id}`);
            
            // Guardar propuesta externa en la API
            const endpointUrl = "http://api:3000/admin/external-offers";
            await fetchWithRetry(endpointUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    auction_id: proposalData.auction_id,
                    proposal_id: proposalData.proposal_id,
                    group_id: proposalData.group_id,
                    symbol: proposalData.symbol,
                    quantity: proposalData.quantity,
                    timestamp: proposalData.timestamp,
                    operation: proposalData.operation
                })
            }, "propuesta externa");
        } else {
            console.log(`⚠️ Ignorando nuestra propia propuesta: ${proposalData.proposal_id}`);
        }
    } catch (err) {
        console.error("Error procesando propuesta recibida:", err);
    }
}

// NUEVO: Manejar respuestas recibidas (operation: "acceptance" o "rejection")
async function handleResponseReceived(responseData) {
    try {
        // Verificar si la respuesta es de otro grupo
        if (String(responseData.group_id) !== String(GROUP_ID)) {
            console.log(`📋 Respuesta recibida del grupo ${responseData.group_id}: ${responseData.operation} para proposal_id: ${responseData.proposal_id}`);
            
            // Guardar respuesta externa en la API
            const endpointUrl = "http://api:3000/admin/external-offers";
            await fetchWithRetry(endpointUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    auction_id: responseData.auction_id,
                    proposal_id: responseData.proposal_id,
                    group_id: responseData.group_id,
                    symbol: responseData.symbol,
                    quantity: responseData.quantity,
                    timestamp: responseData.timestamp,
                    operation: responseData.operation
                })
            }, "respuesta externa");

            // ✨ NUEVO: Si es una aceptación, verificar si aceptaron MI propuesta
            if (responseData.operation === 'acceptance') {
                console.log(`🎉 ¡Propuesta aceptada! Verificando si es mía...`);
                
                // Verificar si tengo una propuesta con este proposal_id en mi historial
                const checkProposalUrl = "http://api:3000/admin/check-my-proposal";
                try {
                    const checkResponse = await fetch(checkProposalUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            auction_id: responseData.auction_id,
                            proposal_id: responseData.proposal_id
                        })
                    });
                    
                    if (checkResponse.ok) {
                        const checkData = await checkResponse.json();
                        if (checkData.is_my_proposal) {
                            console.log(`🔄 ¡Mi propuesta fue aceptada! Procesando intercambio...`);
                            
                            // CORRECCIÓN: Usar datos de la oferta original para lo que voy a recibir
                            if (checkData.original_offer) {
                                console.log(`📤 Doy: ${checkData.my_proposal.quantity} ${checkData.my_proposal.symbol}`);
                                console.log(`📥 Recibo: ${checkData.original_offer.quantity} ${checkData.original_offer.symbol}`);
                                
                                // Ejecutar el intercambio en mi backend con los datos correctos
                                const exchangeUrl = "http://api:3000/admin/execute-exchange";
                                await fetchWithRetry(exchangeUrl, {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                        auction_id: responseData.auction_id,
                                        proposal_id: responseData.proposal_id,
                                        give_symbol: checkData.my_proposal.symbol,        // Lo que doy (mi propuesta)
                                        give_quantity: checkData.my_proposal.quantity,
                                        receive_symbol: checkData.original_offer.symbol,  // Lo que recibo (oferta original)
                                        receive_quantity: checkData.original_offer.quantity,
                                        counterpart_group: responseData.group_id
                                    })
                                }, "ejecución de intercambio");
                            } else {
                                console.error(`❌ No se encontró la oferta original. No se puede completar el intercambio.`);
                                console.log(`📤 Datos disponibles - Mi propuesta: ${checkData.my_proposal.quantity} ${checkData.my_proposal.symbol}`);
                                console.log(`❌ Datos faltantes - Oferta original no encontrada`);
                            }
                        }
                    }
                } catch (checkError) {
                    console.error("Error verificando si es mi propuesta:", checkError);
                }
            }
            
            // 🔓 NUEVO: Si es un rechazo, verificar si rechazaron MI propuesta para devolver acciones
            else if (responseData.operation === 'rejection') {
                console.log(`💔 ¡Propuesta rechazada! Verificando si es mía...`);
                
                // Verificar si tengo una propuesta con este proposal_id en mi historial
                const checkProposalUrl = "http://api:3000/admin/check-my-proposal";
                try {
                    const checkResponse = await fetch(checkProposalUrl, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            auction_id: responseData.auction_id,
                            proposal_id: responseData.proposal_id
                        })
                    });
                    
                    if (checkResponse.ok) {
                        const checkData = await checkResponse.json();
                        if (checkData.is_my_proposal) {
                            console.log(`🔓 ¡Mi propuesta fue rechazada! Devolviendo acciones reservadas...`);
                            console.log(`🔓 Acciones a devolver: ${checkData.my_proposal.quantity} ${checkData.my_proposal.symbol}`);
                            
                            // Manejar el rechazo devolviendo las acciones reservadas
                            const rejectionUrl = "http://api:3000/admin/handle-proposal-rejected";
                            await fetchWithRetry(rejectionUrl, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    auction_id: responseData.auction_id,
                                    proposal_id: responseData.proposal_id
                                })
                            }, "manejo de rechazo de propuesta");
                        }
                    }
                } catch (checkError) {
                    console.error("Error verificando si es mi propuesta rechazada:", checkError);
                }
            }
            
        } else {
            console.log(`⚠️ Ignorando nuestra propia respuesta: ${responseData.proposal_id}`);
        }
    } catch (err) {
        console.error("Error procesando respuesta recibida:", err);
    }
}

// Mantener para compatibilidad
async function handleAuctionCreated(auctionData) {
    try {
        // Verificar si la subasta es de otro grupo
        if (String(auctionData.group_id) !== String(GROUP_ID)) {
            console.log(`Subasta creada por grupo ${auctionData.group_id}: ${auctionData.symbol}`);
            
            // Enviar a la API para procesar
            const endpointUrl = "http://api:3000/auctions/external";
            await fetchWithRetry(endpointUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(auctionData)
            }, "subasta externa");
        }
    } catch (err) {
        console.error("Error procesando subasta creada:", err);
    }
}

// NUEVO: Manejar ofertas en subastas
async function handleAuctionBid(auctionData) {
    try {
        console.log(`Oferta recibida para subasta ${auctionData.auction_id}: ${auctionData.bid_amount}`);
        // Solo procesamos ofertas en nuestras subastas
        console.log("Oferta externa procesada localmente");
    } catch (err) {
        console.error("Error procesando oferta de subasta:", err);
    }
}

// NUEVO: Manejar cierre de subastas
async function handleAuctionClosed(auctionData) {
    try {
        console.log(`Subasta ${auctionData.auction_id} cerrada`);
        
        // Si ganamos la subasta, actualizar nuestro inventario
        if (String(auctionData.winner_group_id) === String(GROUP_ID)) {
            console.log(`🎉 ¡Ganamos la subasta! ${auctionData.quantity} ${auctionData.symbol}`);
            
            // Registrar la ganancia localmente
            await logEvent('AUCTION_WON', {
                auction_id: auctionData.auction_id,
                symbol: auctionData.symbol,
                quantity: auctionData.quantity,
                final_price: auctionData.final_price
            });
        }
    } catch (err) {
        console.error("Error procesando cierre de subasta:", err);
    }
}

// NUEVO: Manejar propuestas de intercambio
async function handleExchangeProposal(auctionData) {
    try {
        // Verificar si la propuesta es para nuestro grupo
        if (String(auctionData.target_group_id) === String(GROUP_ID)) {
            console.log(`Propuesta de intercambio recibida del grupo ${auctionData.origin_group_id}`);
            
            // Enviar a la API para procesar
            const endpointUrl = "http://api:3000/exchanges/proposal";
            await fetchWithRetry(endpointUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(auctionData)
            }, "propuesta de intercambio");
        }
    } catch (err) {
        console.error("Error procesando propuesta de intercambio:", err);
    }
}

// NUEVO: Manejar respuestas de intercambio
async function handleExchangeResponse(auctionData) {
    try {
        // Verificar si la respuesta es para una propuesta nuestra
        if (String(auctionData.origin_group_id) === String(GROUP_ID)) {
            console.log(`Respuesta de intercambio recibida: ${auctionData.exchange_id} - ${auctionData.status}`);
            
            // Enviar a la API para procesar
            const endpointUrl = "http://api:3000/exchanges/response";
            await fetchWithRetry(endpointUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(auctionData)
            }, "respuesta de intercambio");
        }
    } catch (err) {
        console.error("Error procesando respuesta de intercambio:", err);
    }
}

// Función para publicar mensajes de subastas
function publishAuctionMessage(messageData) {
    client.publish(AUCTIONS_TOPIC, JSON.stringify(messageData));
    console.log("Mensaje de subasta publicado:", messageData);
}


// minisv
const app = express();
app.use(express.json());

app.post('/publish', (req, res) => {
  const { topic, message } = req.body;
  client.publish(topic, JSON.stringify(message));
  console.log(`Mensaje publicado en ${topic}:`, message);
  res.json({ status: 'success' });
});

app.listen(3000, () => {
  console.log('Servidor MQTT-Client escuchando en puerto 3000');
});
export default client;
export { publishPurchaseRequest };