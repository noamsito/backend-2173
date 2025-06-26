import pg from 'pg';
const { Pool } = pg;

export async function initializeDatabase() {
  const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'stock_data',
    password: process.env.DB_PASSWORD || 'admin123',
  });

  const client = await pool.connect();

  try {
    console.log('🔍 Verificando tablas de subastas e intercambios...');

    // Verificar si las tablas existen
    const checkTablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('auctions', 'auction_bids', 'exchanges')
    `;

    const result = await client.query(checkTablesQuery);
    const existingTables = result.rows.map(row => row.table_name);

    if (existingTables.length < 3) {
      console.log('⚠️  Faltan tablas. Creándolas...');

      // Crear tabla de subastas
      if (!existingTables.includes('auctions')) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS auctions (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              group_id INTEGER NOT NULL,
              symbol VARCHAR(10) NOT NULL,
              quantity INTEGER NOT NULL CHECK (quantity > 0),
              starting_price DECIMAL(10, 2) NOT NULL CHECK (starting_price > 0),
              current_price DECIMAL(10, 2) NOT NULL,
              status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED', 'CANCELLED')),
              winner_group_id INTEGER,
              start_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
              end_time TIMESTAMP NOT NULL,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Tabla auctions creada');
      }

      // Crear tabla de ofertas
      if (!existingTables.includes('auction_bids')) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS auction_bids (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              auction_id UUID NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
              bidder_group_id INTEGER NOT NULL,
              bid_amount DECIMAL(10, 2) NOT NULL CHECK (bid_amount > 0),
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Tabla auction_bids creada');
      }

      // Crear tabla de intercambios
      if (!existingTables.includes('exchanges')) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS exchanges (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              origin_group_id INTEGER NOT NULL,
              target_group_id INTEGER NOT NULL,
              offered_symbol VARCHAR(10) NOT NULL,
              offered_quantity INTEGER NOT NULL CHECK (offered_quantity > 0),
              requested_symbol VARCHAR(10) NOT NULL,
              requested_quantity INTEGER NOT NULL CHECK (requested_quantity > 0),
              status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED')),
              reason TEXT,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Tabla exchanges creada');
      }

      // Crear tabla de propuestas de intercambio
      if (!existingTables.includes('auction_proposals')) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS auction_proposals (
              id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
              auction_id UUID NOT NULL,
              proposer_group_id INTEGER NOT NULL,
              offered_symbol VARCHAR(10) NOT NULL,
              offered_quantity INTEGER NOT NULL CHECK (offered_quantity > 0),
              offered_timestamp TIMESTAMP NOT NULL,
              status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (auction_id) REFERENCES auctions(id)
          )
        `);
        console.log('✅ Tabla auction_proposals creada');
      }

      // Crear tabla de solicitudes de compra grupal
      if (!existingTables.includes('group_purchase_requests')) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS group_purchase_requests (
              request_id UUID PRIMARY KEY,
              admin_user_id INTEGER NOT NULL,
              group_id INTEGER NOT NULL,
              symbol VARCHAR(10) NOT NULL,
              quantity INTEGER NOT NULL CHECK (quantity > 0),
              price DECIMAL(12,2) NOT NULL,
              total_cost DECIMAL(12,2) NOT NULL,
              status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACCEPTED', 'REJECTED')),
              reason TEXT,
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              FOREIGN KEY (admin_user_id) REFERENCES users(id)
          )
        `);
        console.log('✅ Tabla group_purchase_requests creada');
      }

      // Crear tabla de ofertas externas
      if (!existingTables.includes('external_auctions')) {
        await client.query(`
          CREATE TABLE IF NOT EXISTS external_auctions (
              auction_id UUID PRIMARY KEY,
              group_id INTEGER NOT NULL,
              symbol VARCHAR(10) NOT NULL,
              quantity INTEGER NOT NULL,
              timestamp TIMESTAMP NOT NULL,
              status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'CLOSED', 'CANCELLED')),
              created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ Tabla external_auctions creada');
      }

      // Crear índices
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_auctions_group_id ON auctions(group_id);
        CREATE INDEX IF NOT EXISTS idx_auctions_status ON auctions(status);
        CREATE INDEX IF NOT EXISTS idx_auctions_symbol ON auctions(symbol);
        CREATE INDEX IF NOT EXISTS idx_auction_bids_auction_id ON auction_bids(auction_id);
        CREATE INDEX IF NOT EXISTS idx_exchanges_origin_group ON exchanges(origin_group_id);
        CREATE INDEX IF NOT EXISTS idx_exchanges_target_group ON exchanges(target_group_id);
        CREATE INDEX IF NOT EXISTS idx_exchanges_status ON exchanges(status);
        CREATE INDEX IF NOT EXISTS idx_auction_proposals_auction_id ON auction_proposals(auction_id);
        CREATE INDEX IF NOT EXISTS idx_auction_proposals_proposer_group ON auction_proposals(proposer_group_id);
        CREATE INDEX IF NOT EXISTS idx_auction_proposals_status ON auction_proposals(status);
        CREATE INDEX IF NOT EXISTS idx_group_purchase_requests_group_id ON group_purchase_requests(group_id);
        CREATE INDEX IF NOT EXISTS idx_group_purchase_requests_admin_user ON group_purchase_requests(admin_user_id);
        CREATE INDEX IF NOT EXISTS idx_group_purchase_requests_status ON group_purchase_requests(status);
        CREATE INDEX IF NOT EXISTS idx_external_auctions_group_id ON external_auctions(group_id);
        CREATE INDEX IF NOT EXISTS idx_external_auctions_status ON external_auctions(status);
        CREATE INDEX IF NOT EXISTS idx_external_auctions_symbol ON external_auctions(symbol);
      `);
      console.log('✅ Índices creados');

    } else {
      console.log('✅ Todas las tablas ya existen');
    }

    // Verificar el conteo de registros
    const auctionsCount = await client.query('SELECT COUNT(*) FROM auctions');
    const exchangesCount = await client.query('SELECT COUNT(*) FROM exchanges');
    
    try {
      const proposalsCount = await client.query('SELECT COUNT(*) FROM auction_proposals');
      const groupRequestsCount = await client.query('SELECT COUNT(*) FROM group_purchase_requests');
      const externalAuctionsCount = await client.query('SELECT COUNT(*) FROM external_auctions');
      
      console.log(`📊 Estado actual:`);
      console.log(`   - Subastas: ${auctionsCount.rows[0].count} registros`);
      console.log(`   - Intercambios: ${exchangesCount.rows[0].count} registros`);
      console.log(`   - Propuestas: ${proposalsCount.rows[0].count} registros`);
      console.log(`   - Compras grupales: ${groupRequestsCount.rows[0].count} registros`);
      console.log(`   - Subastas externas: ${externalAuctionsCount.rows[0].count} registros`);
    } catch (err) {
      console.log(`📊 Estado actual:`);
      console.log(`   - Subastas: ${auctionsCount.rows[0].count} registros`);
      console.log(`   - Intercambios: ${exchangesCount.rows[0].count} registros`);
      console.log(`   - Nuevas tablas: creándose...`);
    }

  } catch (error) {
    console.error('❌ Error inicializando base de datos:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Si se ejecuta directamente
if (import.meta.url === `file://${process.argv[1]}`) {
  initializeDatabase()
    .then(() => {
      console.log('✅ Inicialización completada');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Error:', error);
      process.exit(1);
    });
} 