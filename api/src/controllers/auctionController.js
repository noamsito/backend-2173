import { v4 as uuidv4 } from 'uuid';
import fetch from 'node-fetch';

const GROUP_ID = 1;
const MQTT_CLIENT_URL = 'http://mqtt-client:3000/publish';

// Array temporal para almacenar ofertas externas (en producción usar base de datos)
let externalOffersStore = [];

// Función para crear ofertas generales (operation: "offer", proposal_id: "")
export const createAuction = async (req, res) => {
  try {
        const { symbol, quantity } = req.body;
    
        if (!symbol || !quantity) {
      return res.status(400).json({ 
                error: 'Se requieren símbolo y cantidad' 
            });
        }

        // ✅ SIMPLE: Obtener pool de base de datos
        console.log(`🔍 DEBUG 1 - Antes de obtener pool`);
        const pool = req.app.locals.pool;
        console.log(`🔍 DEBUG 2 - Pool obtenido:`, typeof pool, pool ? 'EXISTS' : 'NULL');
        console.log(`🔍 DEBUG 3 - req.app.locals:`, Object.keys(req.app.locals || {}));

        // ✅ RESTAR ACCIONES INMEDIATAMENTE
        console.log(`🔍 DEBUG 4 - Evaluando if (pool)...`);
        if (pool) {
            console.log(`🔍 DEBUG 5 - Pool válido, intentando restar acciones`);
            try {
                await updateUserInventory(GROUP_ID, symbol, parseInt(quantity), 'SUBTRACT', pool);
                console.log(`➖ Acciones restadas: -${quantity} ${symbol} (oferta creada)`);
            } catch (inventoryError) {
                console.error('❌ Error restando acciones al crear oferta:', inventoryError);
                return res.status(500).json({ 
                    error: 'Error restando acciones para la oferta' 
                });
            }
        } else {
            console.error('❌ DEBUG 6 - Pool no disponible, no se pudieron restar las acciones');
            return res.status(500).json({ 
                error: 'Error de base de datos' 
            });
        }

        // Crear oferta general
        const auction_id = uuidv4();
        const timestamp = new Date().toISOString();
        
        const message = {
            auction_id,
            proposal_id: "", // Vacío para ofertas generales
            symbol,
            timestamp,
            quantity: parseInt(quantity),
            group_id: GROUP_ID,
            operation: "offer" // Oferta general
        };

        // Publicar usando el cliente MQTT existente (sin bloquear el historial)
        console.log('🔄 Iniciando publicación MQTT...');
        
        // Hacer la publicación MQTT sin await para no bloquear
        fetch(MQTT_CLIENT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                topic: 'stocks/auctions',
                message: message
            })
        }).then(response => {
            if (response.ok) {
                console.log('✅ Oferta general publicada en MQTT:', message);
            } else {
                console.error('❌ Error publicando en MQTT:', response.status);
            }
        }).catch(mqttError => {
            console.error('❌ Error conectando con cliente MQTT:', mqttError.message);
        });
        
        console.log('🔄 Continuando después de iniciar MQTT...');

        // ✨ NUEVO: Guardar mi oferta en externalOffersStore para poder encontrarla después
        const myOffer = {
            auction_id,
            proposal_id: "", // Vacío para ofertas generales
            symbol,
            timestamp,
            quantity: parseInt(quantity),
            group_id: GROUP_ID,
            operation: "offer",
            received_at: new Date().toISOString()
        };
        externalOffersStore.push(myOffer);
        console.log(`✅ Mi oferta guardada en store:`, myOffer);

        // Guardar en el historial local
        const historyEntry = {
            id: auction_id,
            auction_id,
            proposal_id: "", // Vacío para ofertas generales
            symbol,
            quantity: parseInt(quantity),
            timestamp,
            type: 'OFFER_CREATED',
            status: 'ACTIVE'
        };
        
        // Agregar al historial (array temporal)
        if (!global.exchangeHistory) {
            global.exchangeHistory = [];
        }
        global.exchangeHistory.push(historyEntry);
        console.log(`✅ Oferta guardada en historial:`, historyEntry);
        console.log(`📊 Total de registros en historial: ${global.exchangeHistory.length}`);

        res.json({
            status: 'success',
            message: 'Oferta general publicada exitosamente',
            auction: message
        });

    } catch (error) {
        console.error('Error al crear oferta:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor' 
        });
    }
};

// Función para crear propuestas dirigidas (respuesta a una oferta existente)
const createProposal = async (req, res) => {
    try {
        const { symbol, quantity, auction_id, target_group_id } = req.body;
        
        if (!symbol || !quantity || !auction_id || !target_group_id) {
      return res.status(400).json({ 
                error: 'Se requieren símbolo, cantidad, auction_id y target_group_id' 
            });
        }

        // 🔒 NUEVA LÓGICA: Restar acciones inmediatamente al hacer la propuesta (reservar)
        const pool = req.app.locals.pool;
        const quantityInt = parseInt(quantity);
        
        try {
            await updateUserInventory(GROUP_ID, symbol, quantityInt, 'SUBTRACT', pool);
            console.log(`🔒 Acciones reservadas al hacer propuesta: -${quantityInt} ${symbol}`);
        } catch (inventoryError) {
            console.error('Error reservando acciones:', inventoryError);
            return res.status(400).json({ 
                error: `No se pueden reservar ${quantityInt} acciones de ${symbol} para la propuesta` 
            });
        }

        // Crear propuesta dirigida
        const proposal_id = uuidv4();
        const timestamp = new Date().toISOString();
        
        const message = {
            auction_id, // Mantener el mismo auction_id de la oferta original
            proposal_id, // Nuevo ID para la propuesta
            symbol, // Símbolo que está ofreciendo el usuario
            timestamp,
            quantity: quantityInt,
            group_id: GROUP_ID,
            operation: "proposal" // Propuesta dirigida
        };

        // Publicar usando el cliente MQTT existente
        try {
            const mqttResponse = await fetch(MQTT_CLIENT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: 'stocks/auctions',
                    message: message
                })
            });

            if (mqttResponse.ok) {
                console.log(`✅ Propuesta enviada al grupo ${target_group_id} via MQTT:`, message);
            } else {
                console.error('❌ Error publicando propuesta en MQTT:', await mqttResponse.text());
            }
        } catch (mqttError) {
            console.error('❌ Error conectando con cliente MQTT:', mqttError);
        }

        // Guardar en el historial local con las acciones reservadas
        const historyEntry = {
            id: proposal_id,
            auction_id,
            proposal_id,
            symbol,
            quantity: quantityInt,
            target_group_id,
            timestamp,
            type: 'PROPOSAL_SENT',
            status: 'PENDING',
            reserved_stocks: true // 🔒 Marcar que las acciones están reservadas
        };
        
        // Agregar al historial (array temporal)
        if (!global.exchangeHistory) {
            global.exchangeHistory = [];
        }
        global.exchangeHistory.push(historyEntry);

        res.json({
            status: 'success',
            message: `Propuesta enviada como respuesta a la oferta ${auction_id}. Acciones reservadas: ${quantityInt} ${symbol}`,
            proposal: message
        });

    } catch (error) {
        console.error('Error al crear propuesta:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor' 
        });
    }
};

// Función para aceptar o rechazar propuestas
const respondToProposal = async (req, res) => {
    try {
        const { auction_id, proposal_id, action, symbol, quantity } = req.body; // Incluir symbol y quantity
        
        if (!auction_id || !proposal_id || !action) {
            return res.status(400).json({ 
                error: 'Se requieren auction_id, proposal_id y action' 
            });
        }

        if (!['accept', 'reject'].includes(action)) {
      return res.status(400).json({ 
                error: 'Action debe ser "accept" o "reject"' 
            });
        }

        // ✨ NUEVO: Verificar si ya se respondió a esta propuesta buscando en el store
        const responseKey = `${auction_id}-${proposal_id}`;
        const alreadyResponded = externalOffersStore.some(offer => 
            offer.auction_id === auction_id && 
            offer.proposal_id === proposal_id &&
            (offer.operation === 'acceptance' || offer.operation === 'rejection')
        );

        if (alreadyResponded) {
            return res.status(400).json({ 
                error: 'Esta propuesta ya ha sido respondida anteriormente' 
            });
        }

        const timestamp = new Date().toISOString();
        const operation = action === 'accept' ? 'acceptance' : 'rejection';
        
        const message = {
            auction_id, // Mismo auction_id de la oferta original
            proposal_id, // Mismo proposal_id de la propuesta
            symbol: symbol || "", // Mantener símbolo de la propuesta
            timestamp,
            quantity: parseInt(quantity) || 0, // Mantener cantidad de la propuesta
            group_id: GROUP_ID,
            operation // "acceptance" o "rejection"
        };

        // Publicar usando el cliente MQTT existente
        try {
            const mqttResponse = await fetch(MQTT_CLIENT_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    topic: 'stocks/auctions',
                    message: message
                })
            });

            if (mqttResponse.ok) {
                console.log(`✅ ${operation} enviada via MQTT:`, message);
            } else {
                console.error(`❌ Error publicando ${operation} en MQTT:`, await mqttResponse.text());
            }
        } catch (mqttError) {
            console.error('❌ Error conectando con cliente MQTT:', mqttError);
        }

        // ✨ NUEVO: Guardar la respuesta en el store para que no se pueda responder múltiples veces
        const responseOffer = {
            auction_id,
            proposal_id,
            symbol: symbol || "",
            timestamp,
            quantity: parseInt(quantity) || 0,
            group_id: GROUP_ID,
            operation: operation, // "acceptance" o "rejection"
            received_at: new Date().toISOString()
        };
        externalOffersStore.push(responseOffer);
        console.log(`📝 Respuesta guardada en store: ${operation} para ${proposal_id}`);

        // Guardar en el historial local
        const historyEntry = {
            id: uuidv4(),
            auction_id,
            proposal_id,
            symbol: symbol || "",
            quantity: parseInt(quantity) || 0,
            timestamp,
            type: action === 'accept' ? 'PROPOSAL_ACCEPTED' : 'PROPOSAL_REJECTED',
            status: 'COMPLETED'
        };
        
        if (!global.exchangeHistory) {
            global.exchangeHistory = [];
        }
        global.exchangeHistory.push(historyEntry);

        // NUEVA LÓGICA: Solo actualizar inventario si ACEPTO la propuesta
        if (action === 'accept' && symbol && quantity) {
            try {
                // Obtener pool de base de datos
                const pool = req.app.locals.pool;
                
                // SOLO SUMAR lo que recibo (las acciones que doy ya fueron restadas al crear la oferta)
                await updateUserInventory(GROUP_ID, symbol, quantity, 'ADD', pool);
                console.log(`✅ Recibido: +${quantity} ${symbol}`);
                
                // Buscar mi oferta original para mostrar el intercambio completo
                let originalOffer = externalOffersStore.find(offer => 
                    offer.auction_id === auction_id && offer.proposal_id === ""
                );
                
                if (!originalOffer && global.exchangeHistory) {
                    const historyOffer = global.exchangeHistory.find(entry => 
                        entry.auction_id === auction_id && 
                        entry.type === 'OFFER_CREATED'
                    );
                    if (historyOffer) {
                        originalOffer = {
                            symbol: historyOffer.symbol,
                            quantity: historyOffer.quantity
                        };
                    }
                }
                
                if (originalOffer) {
                    console.log(`🔄 Intercambio completado: Di ${originalOffer.quantity} ${originalOffer.symbol} (ya restado) por ${quantity} ${symbol} (recién sumado)`);
                } else {
                    console.log(`🔄 Intercambio completado: Recibí ${quantity} ${symbol}`);
                }
                
            } catch (inventoryError) {
                console.error('Error actualizando inventario:', inventoryError);
                // No fallar la transacción por error de inventario
            }
        } else if (action === 'reject') {
            console.log(`❌ Propuesta rechazada. La oferta ${auction_id} sigue activa.`);
        }

        res.json({
            status: 'success',
            message: `Propuesta ${action === 'accept' ? 'aceptada' : 'rechazada'} exitosamente`,
            response: message
        });

    } catch (error) {
        console.error('Error al responder propuesta:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor' 
        });
    }
};

// Función para guardar ofertas externas recibidas por MQTT
const saveExternalOffer = async (req, res) => {
    try {
        const { auction_id, group_id, symbol, quantity, timestamp, operation, proposal_id } = req.body;
        
        console.log('📥 Guardando oferta externa:', req.body);

        // Crear objeto de oferta externa
        const externalOffer = {
            auction_id,
            proposal_id: proposal_id || "",
            symbol,
            timestamp,
            quantity: parseInt(quantity),
            group_id: parseInt(group_id),
            operation,
            received_at: new Date().toISOString()
        };

        // Guardar en el array temporal (buscar duplicados por auction_id y proposal_id)
        const existingIndex = externalOffersStore.findIndex(offer => 
            offer.auction_id === auction_id && 
            offer.proposal_id === (proposal_id || "") &&
            offer.operation === operation
        );

        if (existingIndex === -1) {
            // Agregar nueva oferta
            externalOffersStore.push(externalOffer);
            console.log(`✅ Nueva oferta externa guardada: ${symbol} del grupo ${group_id}`);
            
            // Mantener solo las últimas 50 ofertas para evitar acumulación
            if (externalOffersStore.length > 50) {
                externalOffersStore = externalOffersStore.slice(-50);
            }
        } else {
            console.log(`⚠️ Oferta duplicada ignorada: ${auction_id}`);
        }

        res.json({
            status: 'success',
            message: 'Oferta externa guardada exitosamente',
            offer: externalOffer
        });

    } catch (error) {
        console.error('Error al guardar oferta externa:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor' 
        });
    }
};

// Función para obtener ofertas externas reales
export const getExternalOffers = async (req, res) => {
    try {
        // NUEVA LÓGICA: Marcar ofertas completadas y propuestas ya respondidas
        const completedOffers = new Set();
        const respondedProposals = new Set();
        
        console.log(`🔍 DEBUG: Procesando ${externalOffersStore.length} ofertas en el store`);
        
        externalOffersStore.forEach(offer => {
            console.log(`🔍 DEBUG: Oferta ${offer.operation} - ${offer.auction_id}-${offer.proposal_id} del grupo ${offer.group_id}`);
            
            if (offer.operation === 'acceptance') {
                // Si acepto una propuesta, toda la oferta se cierra
                completedOffers.add(`${offer.auction_id}-`); // Oferta original (proposal_id vacío)
                completedOffers.add(`${offer.auction_id}-${offer.proposal_id}`); // Propuesta específica
                console.log(`🔍 DEBUG: Marcando como completada: ${offer.auction_id}-${offer.proposal_id}`);
            } else if (offer.operation === 'rejection') {
                // Si rechazo una propuesta, solo esa propuesta específica se oculta
                const rejectedKey = `${offer.auction_id}-${offer.proposal_id}`;
                respondedProposals.add(rejectedKey);
                console.log(`🔍 DEBUG: Marcando como rechazada: ${rejectedKey}`);
            }
        });
        
        console.log(`🔍 DEBUG: Ofertas completadas:`, Array.from(completedOffers));
        console.log(`🔍 DEBUG: Propuestas rechazadas:`, Array.from(respondedProposals));

        // Filtrar solo ofertas activas de OTROS GRUPOS (no del grupo 1)
        const activeOffers = externalOffersStore.filter(offer => {
            const offerKey = `${offer.auction_id}-${offer.proposal_id}`;
            const isCompleted = completedOffers.has(offerKey);
            const isRejected = respondedProposals.has(offerKey); // ✨ NUEVO: Ocultar propuestas rechazadas
            const isActiveType = offer.operation === 'offer' || offer.operation === 'proposal';
            const isNotGroup1 = offer.group_id != 1; // ✅ SIMPLE: No mostrar ofertas del grupo 1
            
            console.log(`🔍 DEBUG Filtro: ${offer.symbol} ${offerKey} - completed=${isCompleted}, rejected=${isRejected}, active=${isActiveType}, notGroup1=${isNotGroup1}`);
            
            const shouldShow = isActiveType && !isCompleted && !isRejected && isNotGroup1;
            console.log(`🔍 DEBUG: ${offer.symbol} debería mostrarse: ${shouldShow}`);
            
            return shouldShow;
        });

        // Ordenar por timestamp más reciente primero
        const sortedOffers = activeOffers
            .sort((a, b) => new Date(b.received_at) - new Date(a.received_at))
            .slice(0, 20); // Últimas 20 ofertas activas

        console.log(`📋 Devolviendo ${sortedOffers.length} ofertas activas de ${externalOffersStore.length} totales`);

        res.json({
            status: 'success',
            offers: sortedOffers,
            count: sortedOffers.length
    });
    
  } catch (error) {
        console.error('Error al obtener ofertas externas:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor' 
        });
  }
};

// Obtener subastas activas
export const getActiveAuctions = async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    if (!pool) {
      throw new Error('Database pool no está disponible');
    }
    
    const query = `
      SELECT a.*, 
             COUNT(DISTINCT ab.id) as bid_count,
             MAX(ab.bid_amount) as highest_bid
      FROM auctions a
      LEFT JOIN auction_bids ab ON a.id = ab.auction_id
      WHERE a.status = 'ACTIVE' AND a.end_time > NOW()
      GROUP BY a.id
      ORDER BY a.created_at DESC
    `;
    
    const result = await pool.query(query);
    
    res.json({
      status: "success",
      auctions: result.rows
    });
    
  } catch (error) {
    console.error("Error obteniendo subastas:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// Hacer una oferta en una subasta
export const placeBid = async (req, res) => {
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  
  try {
    const { auction_id } = req.params;
    const { bid_amount } = req.body;
    const bidder_group_id = req.body.group_id || GROUP_ID;
    
    if (!bid_amount || bid_amount <= 0) {
      return res.status(400).json({ error: "El monto de la oferta debe ser positivo" });
    }
    
    await client.query('BEGIN');
    
    // Verificar que la subasta existe y está activa
    const auctionQuery = `
      SELECT * FROM auctions 
      WHERE id = $1 AND status = 'ACTIVE' AND end_time > NOW()
    `;
    const auctionResult = await client.query(auctionQuery, [auction_id]);
    
    if (auctionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Subasta no encontrada o ya cerrada" });
    }
    
    const auction = auctionResult.rows[0];
    
    // Verificar que la oferta sea mayor que el precio actual
    if (bid_amount <= auction.current_price) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        error: "La oferta debe ser mayor al precio actual",
        current_price: auction.current_price
      });
    }
    
    // Insertar la oferta
    const bidId = uuidv4();
    await client.query(`
      INSERT INTO auction_bids (id, auction_id, bidder_group_id, bid_amount)
      VALUES ($1, $2, $3, $4)
    `, [bidId, auction_id, bidder_group_id, bid_amount]);
    
    // Actualizar el precio actual de la subasta
    await client.query(`
      UPDATE auctions 
      SET current_price = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
    `, [bid_amount, auction_id]);
    
    await client.query('COMMIT');
    
    // RNF05: Publicar la oferta en el canal stocks/auctions
    const bidMessage = {
      type: 'AUCTION_BID',
      auction_id: auction_id,
      bidder_group_id: bidder_group_id,
      bid_amount: bid_amount,
      timestamp: new Date().toISOString()
    };
    
    try {
      await fetch(MQTT_CLIENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        topic: 'stocks/auctions',
        message: bidMessage
        })
      });
      console.log(`💰 Oferta publicada en stocks/auctions: ${bid_amount} para subasta ${auction_id}`);
    } catch (mqttError) {
      console.error('❌ Error publicando oferta en MQTT:', mqttError);
    }
    
    res.json({
      status: "success",
      message: "Oferta realizada exitosamente",
      bid: {
        id: bidId,
        auction_id: auction_id,
        bid_amount: bid_amount
      }
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error realizando oferta:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

// Cerrar una subasta (admin o automático)
export const closeAuction = async (req, res) => {
  const pool = req.app.locals.pool;
  const client = await pool.connect();
  
  try {
    const { auction_id } = req.params;
    
    await client.query('BEGIN');
    
    // Obtener la subasta con la oferta más alta
    const auctionQuery = `
      SELECT a.*, 
             ab.bidder_group_id as winner_group_id,
             ab.bid_amount as winning_bid
      FROM auctions a
      LEFT JOIN auction_bids ab ON a.id = ab.auction_id 
        AND ab.bid_amount = (
          SELECT MAX(bid_amount) FROM auction_bids WHERE auction_id = a.id
        )
      WHERE a.id = $1 AND a.status = 'ACTIVE'
    `;
    
    const auctionResult = await client.query(auctionQuery, [auction_id]);
    
    if (auctionResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "Subasta no encontrada o ya cerrada" });
    }
    
    const auction = auctionResult.rows[0];
    
    // Actualizar el estado de la subasta
    if (auction.winner_group_id) {
      // Hay un ganador
      await client.query(`
        UPDATE auctions 
        SET status = 'CLOSED', 
            winner_group_id = $1,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
      `, [auction.winner_group_id, auction_id]);
      
      // Transferir las acciones al ganador (se manejará por MQTT)
    } else {
      // No hubo ofertas, devolver las acciones
      await client.query(`
        UPDATE auctions 
        SET status = 'CANCELLED',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [auction_id]);
      
      // Devolver las acciones al inventario
      await client.query(`
        UPDATE stocks 
        SET quantity = quantity + $1 
        WHERE symbol = $2
        AND id = (SELECT id FROM stocks WHERE symbol = $2 ORDER BY timestamp DESC LIMIT 1)
      `, [auction.quantity, auction.symbol]);
    }
    
    await client.query('COMMIT');
    
    // RNF05: Publicar el cierre en el canal stocks/auctions
    const closeMessage = {
      type: 'AUCTION_CLOSED',
      auction_id: auction_id,
      winner_group_id: auction.winner_group_id,
      winning_bid: auction.winning_bid,
      symbol: auction.symbol,
      quantity: auction.quantity,
      timestamp: new Date().toISOString()
    };
    
    try {
      await fetch(MQTT_CLIENT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        topic: 'stocks/auctions',
        message: closeMessage
        })
      });
      console.log(`🔨 Subasta cerrada y publicada en stocks/auctions: ${auction_id}`);
    } catch (mqttError) {
      console.error('❌ Error publicando cierre en MQTT:', mqttError);
    }
    
    res.json({
      status: "success",
      message: auction.winner_group_id ? "Subasta cerrada con ganador" : "Subasta cancelada sin ofertas",
      auction: {
        id: auction_id,
        winner_group_id: auction.winner_group_id,
        winning_bid: auction.winning_bid
      }
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error cerrando subasta:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  } finally {
    client.release();
  }
};

// Procesar subastas externas (desde MQTT)
export const processExternalAuction = async (req, res) => {
  try {
    const pool = req.app.locals.pool;
    const auctionData = req.body;
    
    console.log("Procesando subasta externa:", auctionData);
    
    // Registrar la subasta externa para seguimiento
    await logEvent('EXTERNAL_AUCTION', auctionData, pool);
    
    res.json({ status: "success", message: "Subasta externa procesada" });
  } catch (error) {
    console.error("Error procesando subasta externa:", error);
    res.status(500).json({ error: "Error interno del servidor" });
  }
};

async function logEvent(type, details, pool) {
  try {
    if (!details.timestamp) {
      details.timestamp = new Date().toISOString();
    }
    
    const query = `
      INSERT INTO events (type, details)
      VALUES ($1, $2)
      RETURNING id
    `;
    
    const result = await pool.query(query, [type, JSON.stringify(details)]);
    console.log(`Evento ${type} registrado con ID ${result.rows[0].id}`);
    return result.rows[0].id;
  } catch (error) {
    console.error("Error registrando evento:", error);
    return null;
  }
}

// Función para obtener el historial de intercambios
export const getExchangeHistory = async (req, res) => {
    try {
        if (!global.exchangeHistory) {
            global.exchangeHistory = [];
        }

        console.log(`🔍 DEBUG: Estado de global.exchangeHistory:`, global.exchangeHistory);
        console.log(`🔍 DEBUG: Tipo de global.exchangeHistory:`, typeof global.exchangeHistory);
        console.log(`🔍 DEBUG: Length:`, global.exchangeHistory.length);

        // Ordenar por timestamp más reciente primero
        const sortedHistory = global.exchangeHistory
            .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
            .slice(0, 50); // Últimas 50 transacciones

        console.log(`📋 Devolviendo ${sortedHistory.length} registros del historial`);

        res.json({
            status: 'success',
            history: sortedHistory,
            count: sortedHistory.length
        });
        
    } catch (error) {
        console.error('Error al obtener historial de intercambios:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor' 
        });
    }
};

// Función para actualizar inventario real en la base de datos
const updateUserInventory = async (userId, symbol, quantity, operation, pool) => {
    try {
        const action = operation === 'ADD' ? 'Sumar' : 'Restar';
        console.log(`📦 ${action} ${quantity} acciones de ${symbol} al usuario ${userId}`);
        
        if (operation === 'ADD') {
            // Agregar nueva compra (intercambio recibido)
            const newPurchase = {
                user_id: userId,
                symbol: symbol,
                quantity: quantity,
                price_at_purchase: 0, // Precio 0 para intercambios
                status: 'EXCHANGE_RECEIVED' // Usar status para identificar tipo
            };
            
            console.log(`✅ Insertando nueva compra por intercambio:`, newPurchase);
            
            // INSERCIÓN REAL EN LA BASE DE DATOS usando estructura real
            if (pool) {
                await pool.query(
                    'INSERT INTO purchases (user_id, symbol, quantity, price_at_purchase, status) VALUES ($1, $2, $3, $4, $5)', 
                    [newPurchase.user_id, newPurchase.symbol, newPurchase.quantity, newPurchase.price_at_purchase, newPurchase.status]
                );
                console.log(`✅ ¡Compra insertada en la base de datos! +${quantity} ${symbol}`);
            } else {
                console.warn(`⚠️ Pool no disponible, no se pudo insertar en base de datos`);
            }
            
        } else if (operation === 'SUBTRACT') {
            // Registrar como venta/entrega (intercambio dado) con cantidad negativa
            const saleRecord = {
                user_id: userId,
                symbol: symbol,
                quantity: -quantity, // Cantidad negativa para indicar salida
                price_at_purchase: 0,  // Precio 0 para intercambios
                status: 'EXCHANGE_GIVEN' // Usar status para identificar tipo
            };
            
            console.log(`✅ Insertando registro de entrega por intercambio:`, saleRecord);
            
            // INSERCIÓN REAL EN LA BASE DE DATOS usando estructura real
            if (pool) {
                await pool.query(
                    'INSERT INTO purchases (user_id, symbol, quantity, price_at_purchase, status) VALUES ($1, $2, $3, $4, $5)', 
                    [saleRecord.user_id, saleRecord.symbol, saleRecord.quantity, saleRecord.price_at_purchase, saleRecord.status]
                );
                console.log(`✅ ¡Entrega registrada en la base de datos! -${quantity} ${symbol}`);
            } else {
                console.warn(`⚠️ Pool no disponible, no se pudo insertar en base de datos`);
            }
        }
        
        return { success: true, message: `Inventario actualizado: ${action} ${quantity} ${symbol}` };
    } catch (error) {
        console.error('Error actualizando inventario:', error);
        throw error;
    }
};

// Función para verificar si una propuesta es mía
const checkMyProposal = async (req, res) => {
    try {
        const { auction_id, proposal_id } = req.body;
        
        if (!auction_id || !proposal_id) {
            return res.status(400).json({ 
                error: 'Se requieren auction_id y proposal_id' 
            });
        }

        // Buscar en el historial si tengo una propuesta con este proposal_id
        if (!global.exchangeHistory) {
            global.exchangeHistory = [];
        }

        const myProposal = global.exchangeHistory.find(entry => 
            entry.auction_id === auction_id && 
            entry.proposal_id === proposal_id &&
            entry.type === 'PROPOSAL_SENT'
        );

        if (myProposal) {
            console.log(`✅ Propuesta encontrada en mi historial:`, myProposal);
            
            // BUSCAR LA OFERTA ORIGINAL para saber qué voy a recibir
            const originalOffer = externalOffersStore.find(offer => 
                offer.auction_id === auction_id && 
                offer.proposal_id === "" && // Oferta original tiene proposal_id vacío
                offer.operation === 'offer'
            );
            
            if (originalOffer) {
                console.log(`✅ Oferta original encontrada:`, originalOffer);
                res.json({
                    is_my_proposal: true,
                    my_proposal: {
                        symbol: myProposal.symbol,           // Lo que YO propuse dar
                        quantity: myProposal.quantity,
                        target_group_id: myProposal.target_group_id
                    },
                    original_offer: {
                        symbol: originalOffer.symbol,        // Lo que VOY A RECIBIR
                        quantity: originalOffer.quantity,
                        group_id: originalOffer.group_id
                    }
                });
            } else {
                console.warn(`⚠️ No se encontró la oferta original para ${auction_id}`);
                res.json({
                    is_my_proposal: true,
                    my_proposal: {
                        symbol: myProposal.symbol,
                        quantity: myProposal.quantity,
                        target_group_id: myProposal.target_group_id
                    },
                    original_offer: null
                });
            }
        } else {
            console.log(`❌ Propuesta ${proposal_id} no encontrada en mi historial`);
            res.json({
                is_my_proposal: false
            });
        }

    } catch (error) {
        console.error('Error verificando propuesta:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor' 
        });
    }
};

// Función para ejecutar intercambio cuando mi propuesta es aceptada
const executeExchange = async (req, res) => {
    try {
        const { auction_id, proposal_id, give_symbol, give_quantity, receive_symbol, receive_quantity, counterpart_group } = req.body;
        
        console.log(`🔄 Ejecutando intercambio:`, req.body);
        
        // Obtener pool de base de datos
        const pool = req.app.locals.pool;
        
        // 🔒 NUEVA LÓGICA: NO restar acciones (ya se restaron al crear la propuesta)
        console.log(`🔒 Las acciones ya fueron reservadas al hacer la propuesta: ${give_quantity} ${give_symbol}`);
        
        // Solo sumar las acciones que recibo
        await updateUserInventory(GROUP_ID, receive_symbol, receive_quantity, 'ADD', pool);
        console.log(`✅ Recibido: +${receive_quantity} ${receive_symbol}`);
        
        // Actualizar el estado de mi propuesta en el historial
        if (global.exchangeHistory) {
            const proposalIndex = global.exchangeHistory.findIndex(entry => 
                entry.auction_id === auction_id && 
                entry.proposal_id === proposal_id &&
                entry.type === 'PROPOSAL_SENT'
            );
            
            if (proposalIndex !== -1) {
                global.exchangeHistory[proposalIndex].status = 'ACCEPTED';
                global.exchangeHistory[proposalIndex].completed_at = new Date().toISOString();
                global.exchangeHistory[proposalIndex].reserved_stocks = false; // 🔒 Ya no están reservadas
                console.log(`✅ Propuesta marcada como aceptada en el historial`);
            }
        }
        
        // Agregar entrada de intercambio completado
        const exchangeEntry = {
            id: uuidv4(),
            auction_id,
            proposal_id,
            type: 'EXCHANGE_COMPLETED',
            status: 'COMPLETED',
            timestamp: new Date().toISOString(),
            gave: { symbol: give_symbol, quantity: give_quantity },
            received: { symbol: receive_symbol, quantity: receive_quantity },
            counterpart_group
        };
        
        global.exchangeHistory.push(exchangeEntry);
        
        console.log(`🎉 Intercambio completado exitosamente: Entregué ${give_quantity} ${give_symbol} (reservado previamente) por ${receive_quantity} ${receive_symbol} al grupo ${counterpart_group}`);
        
        res.json({
            status: 'success',
            message: 'Intercambio ejecutado exitosamente',
            exchange: exchangeEntry
        });

    } catch (error) {
        console.error('Error ejecutando intercambio:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor' 
        });
    }
};

// Función para obtener el inventario real de acciones del usuario
export const getMyStocks = async (req, res) => {
    try {
        const pool = req.app.locals.pool;
        if (!pool) {
            console.error('❌ Pool de base de datos no disponible');
            return res.status(500).json({ error: 'Base de datos no disponible' });
        }

        // Usar el userId del token de autenticación o fallback a 1 para pruebas
        const userId = req.userId || 1;
        
        console.log(`📊 Calculando inventario real de acciones para usuario ${userId}`);
        console.log(`🔍 DEBUG: req.userId = ${req.userId}, userId final = ${userId}`);
        
        // Consulta que suma/resta todas las transacciones por símbolo
        // COMBINA purchases (compras directas) y purchase_requests (compras aprobadas)
        const query = `
            WITH all_user_stocks AS (
                -- Compras directas completadas
                SELECT symbol, quantity, created_at, 'direct_purchase' as source
                FROM purchases 
                WHERE user_id = $1
                
                UNION ALL
                
                -- Compras aprobadas (purchase_requests con status ACCEPTED)
                SELECT symbol, quantity, created_at, 'approved_request' as source
                FROM purchase_requests 
                WHERE user_id = $1 AND status = 'ACCEPTED'
            )
            SELECT 
                symbol,
                SUM(quantity) as total_quantity,
                COUNT(*) as transaction_count,
                MAX(created_at) as last_transaction,
                STRING_AGG(DISTINCT source, ', ') as sources
            FROM all_user_stocks
            GROUP BY symbol
            HAVING SUM(quantity) > 0
            ORDER BY symbol ASC
        `;
        
        console.log(`🔍 Ejecutando consulta SQL para userId: ${userId}`);
        const result = await pool.query(query, [userId]);
        console.log(`✅ Consulta SQL ejecutada exitosamente. Filas encontradas: ${result.rows.length}`);
        
        // Debug adicional: verificar ambas tablas
        const debugQuery1 = `SELECT * FROM purchases WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`;
        const debugResult1 = await pool.query(debugQuery1, [userId]);
        console.log(`🔍 DEBUG: Últimas 5 entradas en PURCHASES para usuario ${userId}:`, debugResult1.rows);
        
        const debugQuery2 = `SELECT * FROM purchase_requests WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5`;
        const debugResult2 = await pool.query(debugQuery2, [userId]);
        console.log(`🔍 DEBUG: Últimas 5 entradas en PURCHASE_REQUESTS para usuario ${userId}:`, debugResult2.rows);
        
        // Formatear los datos para el frontend
        const stocks = result.rows.map(row => ({
            symbol: row.symbol,
            quantity: parseInt(row.total_quantity),
            transactions: parseInt(row.transaction_count),
            lastTransaction: row.last_transaction,
            sources: row.sources // Indica si vienen de purchases, purchase_requests, o ambos
        }));
        
        console.log(`📦 Inventario calculado: ${stocks.length} símbolos diferentes`);
        stocks.forEach(stock => {
            console.log(`  ${stock.symbol}: ${stock.quantity} acciones (fuentes: ${stock.sources})`);
        });
        
        res.json({
            status: 'success',
            stocks: stocks,
            totalSymbols: stocks.length,
            calculatedAt: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Error calculando inventario de acciones:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor' 
        });
    }
};

// Función para manejar el rechazo de mis propuestas (devolver acciones reservadas)
const handleMyProposalRejected = async (req, res) => {
    try {
        const { auction_id, proposal_id } = req.body;
        
        if (!auction_id || !proposal_id) {
            return res.status(400).json({ 
                error: 'Se requieren auction_id y proposal_id' 
            });
        }

        console.log(`❌ Procesando rechazo de mi propuesta: ${proposal_id} en auction: ${auction_id}`);

        // Buscar mi propuesta en el historial
        if (!global.exchangeHistory) {
            global.exchangeHistory = [];
        }

        const proposalIndex = global.exchangeHistory.findIndex(entry => 
            entry.auction_id === auction_id && 
            entry.proposal_id === proposal_id &&
            entry.type === 'PROPOSAL_SENT' &&
            entry.status === 'PENDING'
        );

        if (proposalIndex === -1) {
            console.log(`⚠️ No se encontró propuesta pendiente: ${proposal_id}`);
            return res.status(404).json({ 
                error: 'Propuesta no encontrada o ya procesada' 
            });
        }

        const myProposal = global.exchangeHistory[proposalIndex];
        
        // 🔓 DEVOLVER las acciones reservadas
        const pool = req.app.locals.pool;
        
        try {
            await updateUserInventory(GROUP_ID, myProposal.symbol, myProposal.quantity, 'ADD', pool);
            console.log(`🔓 Acciones devueltas por rechazo: +${myProposal.quantity} ${myProposal.symbol}`);
        } catch (inventoryError) {
            console.error('Error devolviendo acciones reservadas:', inventoryError);
            return res.status(500).json({ 
                error: 'Error devolviendo acciones reservadas' 
            });
        }

        // Actualizar el estado de la propuesta en el historial
        global.exchangeHistory[proposalIndex].status = 'REJECTED';
        global.exchangeHistory[proposalIndex].rejected_at = new Date().toISOString();
        global.exchangeHistory[proposalIndex].reserved_stocks = false; // 🔓 Ya no están reservadas

        // Agregar entrada de rechazo
        const rejectionEntry = {
            id: uuidv4(),
            auction_id,
            proposal_id,
            symbol: myProposal.symbol,
            quantity: myProposal.quantity,
            timestamp: new Date().toISOString(),
            type: 'PROPOSAL_REJECTED_BY_THEM',
            status: 'COMPLETED'
        };
        
        global.exchangeHistory.push(rejectionEntry);
        
        console.log(`💔 Propuesta rechazada: Devueltas ${myProposal.quantity} ${myProposal.symbol} al inventario`);
        
        res.json({
            status: 'success',
            message: `Propuesta rechazada. Acciones devueltas: ${myProposal.quantity} ${myProposal.symbol}`,
            returned_stocks: {
                symbol: myProposal.symbol,
                quantity: myProposal.quantity
            }
        });

    } catch (error) {
        console.error('Error manejando rechazo de propuesta:', error);
        res.status(500).json({ 
            error: 'Error interno del servidor' 
        });
    }
};

export {
    logEvent,
    createProposal,
    respondToProposal,
    saveExternalOffer,
    checkMyProposal,
    executeExchange,
    handleMyProposalRejected
}; 