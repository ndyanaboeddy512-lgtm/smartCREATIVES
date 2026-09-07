const fs = require('fs');
const path = require('path');

let pool = null;
let isAvailable = false;
let isPostgres = false;
let isInitializing = false;
let initPromise = null;

// Determine connection configuration and detect database engine
function getDatabaseConfig() {
  const pgUrl = process.env.POSTGRES_URL || 
                process.env.POSTGRES_PRISMA_URL || 
                process.env.POSTGRES_URL_NON_POOLING ||
                (process.env.DATABASE_URL && (process.env.DATABASE_URL.startsWith('postgres://') || process.env.DATABASE_URL.startsWith('postgresql://')) ? process.env.DATABASE_URL : null);

  const isPg = Boolean(
    pgUrl || 
    process.env.POSTGRES_HOST || 
    (process.env.DATABASE_URL && (process.env.DATABASE_URL.startsWith('postgres://') || process.env.DATABASE_URL.startsWith('postgresql://')))
  );

  const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  const connLimit = isServerless ? 3 : 10;

  if (isPg) {
    const connectionString = pgUrl || process.env.DATABASE_URL;
    return {
      engine: 'postgres',
      connectionString,
      host: process.env.POSTGRES_HOST,
      port: parseInt(process.env.POSTGRES_PORT, 10) || 5432,
      user: process.env.POSTGRES_USER,
      password: process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD,
      database: process.env.POSTGRES_DATABASE,
      max: connLimit,
      connectionTimeoutMillis: 10000,
      ssl: { rejectUnauthorized: false }
    };
  }

  // MySQL configuration
  const mysqlUrl = process.env.DATABASE_URL || 
                   process.env.MYSQL_URL || 
                   process.env.TIDB_URL || 
                   process.env.JAWSDB_URL || 
                   process.env.CLEARDB_DATABASE_URL;

  if (mysqlUrl) {
    const isLocal = mysqlUrl.includes('127.0.0.1') || mysqlUrl.includes('localhost');
    const isCloud = !isLocal || mysqlUrl.includes('ssl') || process.env.MYSQL_SSL === 'true';

    return {
      engine: 'mysql',
      uri: mysqlUrl,
      waitForConnections: true,
      connectionLimit: connLimit,
      queueLimit: 0,
      connectTimeout: 10000,
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      ssl: isCloud ? { rejectUnauthorized: false } : undefined
    };
  }

  const host = process.env.MYSQL_HOST || '127.0.0.1';
  const isCloudHost = host !== '127.0.0.1' && host !== 'localhost';

  return {
    engine: 'mysql',
    host,
    port: parseInt(process.env.MYSQL_PORT, 10) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD !== undefined ? process.env.MYSQL_PASSWORD : '',
    database: process.env.MYSQL_DATABASE || 'art_gallery_db',
    waitForConnections: true,
    connectionLimit: connLimit,
    queueLimit: 0,
    connectTimeout: 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    ssl: (isCloudHost || process.env.MYSQL_SSL === 'true') ? { rejectUnauthorized: false } : undefined
  };
}

// Universal query executor handling SQL parameter translation ($1 vs ?)
async function execute(sql, params = []) {
  if (!pool || !isAvailable) {
    await getPool();
  }
  if (!pool || !isAvailable) {
    throw new Error('Database connection is not available');
  }

  if (isPostgres) {
    let idx = 1;
    const pgSql = sql.replace(/\?/g, () => '$' + (idx++));
    const res = await pool.query(pgSql, params);
    return {
      rows: res.rows || [],
      rowCount: res.rowCount || 0
    };
  } else {
    const [rows, fields] = await pool.query(sql, params);
    return {
      rows: Array.isArray(rows) ? rows : [],
      rowCount: Array.isArray(rows) ? rows.length : (rows.affectedRows || 0)
    };
  }
}

// Ensure database pool is initialized (resilient against serverless cold-start race conditions)
async function getPool() {
  if (pool && isAvailable) return pool;
  if (isInitializing && initPromise) {
    await initPromise;
    return pool;
  }
  isInitializing = true;
  initPromise = initDatabase().finally(() => {
    isInitializing = false;
  });
  await initPromise;
  return pool;
}

// Initialize Database connection & create tables if they do not exist
async function initDatabase() {
  try {
    const config = getDatabaseConfig();

    if (config.engine === 'postgres') {
      const { Pool: PgPool } = require('pg');
      if (config.connectionString) {
        pool = new PgPool({
          connectionString: config.connectionString,
          max: config.max,
          connectionTimeoutMillis: config.connectionTimeoutMillis,
          ssl: config.ssl
        });
      } else {
        pool = new PgPool({
          host: config.host,
          port: config.port,
          user: config.user,
          password: config.password,
          database: config.database,
          max: config.max,
          connectionTimeoutMillis: config.connectionTimeoutMillis,
          ssl: config.ssl
        });
      }

      // Verify connection
      const client = await pool.connect();
      const masked = config.connectionString ? config.connectionString.replace(/:[^:@]+@/, ':****@') : (config.database + '@' + config.host);
      console.log(`✓ Connected to PostgreSQL / Neon database [${masked}]`);
      client.release();
      isAvailable = true;
      isPostgres = true;

    } else {
      // MySQL
      const mysql = require('mysql2/promise');

      if (!config.uri && config.host === '127.0.0.1') {
        try {
          const rootConn = await mysql.createConnection({
            host: config.host,
            port: config.port,
            user: config.user,
            password: config.password
          });
          await rootConn.query(`CREATE DATABASE IF NOT EXISTS \`${config.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
          await rootConn.end();
        } catch (e) {}
      }

      const { engine, ...mysqlOpts } = config;
      pool = config.uri ? mysql.createPool(config.uri) : mysql.createPool(mysqlOpts);

      // Verify connectivity
      const connection = await pool.getConnection();
      const maskedUrl = config.uri ? config.uri.replace(/:[^:@]+@/, ':****@') : (config.database + '@' + config.host);
      console.log(`✓ Connected to MySQL database [${maskedUrl}]`);
      connection.release();
      isAvailable = true;
      isPostgres = false;
    }

    // Run schema creation
    await createTables();

    // Auto-seed from JSON files if database is fresh
    await seedIfEmpty();

    return true;
  } catch (err) {
    console.warn(`! Database notice (${err.message}). Database will retry on next request.`);
    isAvailable = false;
    return false;
  }
}

async function createTables() {
  if (!isAvailable || !pool) return;

  if (isPostgres) {
    // PostgreSQL / Neon Schema
    await pool.query(`
      CREATE TABLE IF NOT EXISTS artworks (
        id VARCHAR(64) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        artist VARCHAR(255) NOT NULL DEFAULT '55 smartCREATIVES Studio',
        year INT DEFAULT 2026,
        medium VARCHAR(255) DEFAULT 'Fine Art',
        dimensions VARCHAR(128) DEFAULT 'Curated Scale',
        price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
        status VARCHAR(64) NOT NULL DEFAULT 'Available',
        framing VARCHAR(255) DEFAULT 'Standard Gallery Presentation',
        frame_options JSONB NULL,
        provenance TEXT NULL,
        curatorial_statement TEXT NULL,
        description TEXT NULL,
        shipping_details TEXT NULL,
        faq_info JSONB NULL,
        images JSONB NULL,
        featured BOOLEAN NOT NULL DEFAULT FALSE,
        image VARCHAR(500) NOT NULL,
        high_res_zoom VARCHAR(500) NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS inquiries (
        id VARCHAR(64) PRIMARY KEY,
        artwork_id VARCHAR(64) NULL,
        artwork_title VARCHAR(255) NOT NULL DEFAULT 'General Acquisition Inquiry',
        artwork_artist VARCHAR(255) NULL,
        artwork_price NUMERIC(12, 2) DEFAULT 0.00,
        artwork_image VARCHAR(500) NULL,
        collector_name VARCHAR(255) NOT NULL,
        collector_email VARCHAR(255) NOT NULL,
        collector_phone VARCHAR(64) NULL,
        frame_preference VARCHAR(255) DEFAULT 'Included Framing',
        notes TEXT NULL,
        status VARCHAR(64) NOT NULL DEFAULT 'Pending',
        opened BOOLEAN NOT NULL DEFAULT FALSE,
        is_customer_submission BOOLEAN NOT NULL DEFAULT TRUE,
        date TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        curator_notes TEXT NULL,
        generated_reply TEXT NULL,
        email_delivery_result JSONB NULL,
        reply_sent_at TIMESTAMP WITH TIME ZONE NULL,
        make_webhook_status VARCHAR(64) DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        tier VARCHAR(64) DEFAULT 'Collector Member',
        phone VARCHAR(64) NULL,
        address TEXT NULL,
        wishlist JSONB NULL,
        role VARCHAR(32) DEFAULT 'collector',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS admins (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL DEFAULT '55 smartCREATIVES Admin',
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(32) DEFAULT 'admin',
        last_login TIMESTAMP WITH TIME ZONE NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id VARCHAR(64) PRIMARY KEY,
        artwork_id VARCHAR(64) NULL,
        artwork_title VARCHAR(255) NULL,
        author_name VARCHAR(255) NOT NULL,
        author_email VARCHAR(255) NOT NULL,
        author_location VARCHAR(128) NULL,
        rating INT NOT NULL DEFAULT 5,
        comment TEXT NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP WITH TIME ZONE NULL
      );
    `);

    // Auto-migrate column additions for PostgreSQL
    const pgMigrations = [
      "ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS generated_reply TEXT NULL",
      "ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS email_delivery_result JSONB NULL",
      "ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS reply_sent_at TIMESTAMP WITH TIME ZONE NULL",
      "ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS make_webhook_status VARCHAR(64) DEFAULT 'pending'",
      "ALTER TABLE artworks ADD COLUMN IF NOT EXISTS description TEXT NULL",
      "ALTER TABLE artworks ADD COLUMN IF NOT EXISTS shipping_details TEXT NULL",
      "ALTER TABLE artworks ADD COLUMN IF NOT EXISTS faq_info JSONB NULL",
      "ALTER TABLE artworks ADD COLUMN IF NOT EXISTS images JSONB NULL"
    ];
    for (const q of pgMigrations) {
      try { await pool.query(q); } catch (e) {}
    }

  } else {
    // MySQL Schema
    const artworksTable = `
      CREATE TABLE IF NOT EXISTS artworks (
        id VARCHAR(64) PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        artist VARCHAR(255) NOT NULL DEFAULT '55 smartCREATIVES Studio',
        year INT DEFAULT 2026,
        medium VARCHAR(255) DEFAULT 'Fine Art',
        dimensions VARCHAR(128) DEFAULT 'Curated Scale',
        price DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
        status ENUM('Available', 'Reserved', 'Sold') NOT NULL DEFAULT 'Available',
        framing VARCHAR(255) DEFAULT 'Standard Gallery Presentation',
        frame_options JSON NULL,
        provenance TEXT NULL,
        curatorial_statement TEXT NULL,
        description TEXT NULL,
        shipping_details TEXT NULL,
        faq_info JSON NULL,
        images JSON NULL,
        featured BOOLEAN NOT NULL DEFAULT FALSE,
        image VARCHAR(500) NOT NULL,
        high_res_zoom VARCHAR(500) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_status (status),
        INDEX idx_featured (featured)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    const inquiriesTable = `
      CREATE TABLE IF NOT EXISTS inquiries (
        id VARCHAR(64) PRIMARY KEY,
        artwork_id VARCHAR(64) NULL,
        artwork_title VARCHAR(255) NOT NULL DEFAULT 'General Acquisition Inquiry',
        artwork_artist VARCHAR(255) NULL,
        artwork_price DECIMAL(12, 2) DEFAULT 0.00,
        artwork_image VARCHAR(500) NULL,
        collector_name VARCHAR(255) NOT NULL,
        collector_email VARCHAR(255) NOT NULL,
        collector_phone VARCHAR(64) NULL,
        frame_preference VARCHAR(255) DEFAULT 'Included Framing',
        notes TEXT NULL,
        status ENUM('Pending', 'Contacted', 'Invoice Sent', 'Closed/Sold') NOT NULL DEFAULT 'Pending',
        opened BOOLEAN NOT NULL DEFAULT FALSE,
        is_customer_submission BOOLEAN NOT NULL DEFAULT TRUE,
        date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        curator_notes TEXT NULL,
        generated_reply TEXT NULL,
        email_delivery_result JSON NULL,
        reply_sent_at TIMESTAMP NULL,
        make_webhook_status VARCHAR(64) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_inq_status (status),
        INDEX idx_inq_opened (opened),
        INDEX idx_inq_date (date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    const usersTable = `
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        tier VARCHAR(64) DEFAULT 'Collector Member',
        phone VARCHAR(64) NULL,
        address TEXT NULL,
        wishlist JSON NULL,
        role VARCHAR(32) DEFAULT 'collector',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    const adminsTable = `
      CREATE TABLE IF NOT EXISTS admins (
        id VARCHAR(64) PRIMARY KEY,
        name VARCHAR(255) NOT NULL DEFAULT '55 smartCREATIVES Admin',
        email VARCHAR(255) NOT NULL UNIQUE,
        password VARCHAR(255) NOT NULL,
        role VARCHAR(32) DEFAULT 'admin',
        last_login TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    const reviewsTable = `
      CREATE TABLE IF NOT EXISTS reviews (
        id VARCHAR(64) PRIMARY KEY,
        artwork_id VARCHAR(64) NULL,
        artwork_title VARCHAR(255) NULL,
        author_name VARCHAR(255) NOT NULL,
        author_email VARCHAR(255) NOT NULL,
        author_location VARCHAR(128) NULL,
        rating INT NOT NULL DEFAULT 5,
        comment TEXT NOT NULL,
        status ENUM('pending', 'approved', 'rejected') NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP NULL,
        INDEX idx_review_status (status),
        INDEX idx_review_artwork (artwork_id),
        INDEX idx_review_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;

    await pool.query(artworksTable);
    await pool.query(inquiriesTable);
    await pool.query(usersTable);
    await pool.query(adminsTable);
    await pool.query(reviewsTable);

    // Auto-migrate column additions for MySQL
    const mysqlMigrations = [
      "ALTER TABLE inquiries ADD COLUMN generated_reply TEXT NULL",
      "ALTER TABLE inquiries ADD COLUMN email_delivery_result JSON NULL",
      "ALTER TABLE inquiries ADD COLUMN reply_sent_at TIMESTAMP NULL",
      "ALTER TABLE inquiries ADD COLUMN make_webhook_status VARCHAR(64) DEFAULT 'pending'",
      "ALTER TABLE artworks ADD COLUMN description TEXT NULL",
      "ALTER TABLE artworks ADD COLUMN shipping_details TEXT NULL",
      "ALTER TABLE artworks ADD COLUMN faq_info JSON NULL",
      "ALTER TABLE artworks ADD COLUMN images JSON NULL"
    ];
    for (const q of mysqlMigrations) {
      try { await pool.query(q); } catch (e) {}
    }
  }

  console.log(`✓ Database tables verified / ready (${isPostgres ? 'PostgreSQL' : 'MySQL'})`);
}

// Seed Database tables if empty from data/*.json files
async function seedIfEmpty() {
  if (!isAvailable || !pool) return;

  try {
    const candidateDirs = [
      path.join(__dirname, 'data'),
      path.join(process.cwd(), 'data')
    ];
    const dataDir = candidateDirs.find(d => fs.existsSync(d)) || path.join(__dirname, 'data');

    // 1. Seed Artworks
    const { rows: artCountRows } = await execute('SELECT COUNT(*) as count FROM artworks');
    const artCount = parseInt(artCountRows[0].count, 10);
    if (artCount === 0 && fs.existsSync(path.join(dataDir, 'artworks.json'))) {
      const artworks = JSON.parse(fs.readFileSync(path.join(dataDir, 'artworks.json'), 'utf-8'));
      for (const a of artworks) {
        if (isPostgres) {
          await execute(
            `INSERT INTO artworks (id, title, artist, year, medium, dimensions, price, status, framing, frame_options, provenance, curatorial_statement, description, shipping_details, faq_info, images, featured, image, high_res_zoom)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (id) DO UPDATE SET 
               description = COALESCE(artworks.description, EXCLUDED.description),
               shipping_details = COALESCE(artworks.shipping_details, EXCLUDED.shipping_details),
               faq_info = COALESCE(artworks.faq_info, EXCLUDED.faq_info),
               images = COALESCE(artworks.images, EXCLUDED.images)`,
            [
              a.id, a.title, a.artist || '55 smartCREATIVES Studio',
              a.year || 2026, a.medium || 'Fine Art', a.dimensions || 'Custom Size',
              a.price || 0, a.status || 'Available', a.framing || 'Included Framing',
              JSON.stringify(a.frameOptions || []), a.provenance || '',
              a.curatorialStatement || '', a.description || '', a.shippingDetails || '',
              JSON.stringify(a.faq || []), JSON.stringify(a.images || [a.image]),
              Boolean(a.featured), a.image, a.highResZoom || a.image
            ]
          );
        } else {
          await execute(
            `INSERT INTO artworks (id, title, artist, year, medium, dimensions, price, status, framing, frame_options, provenance, curatorial_statement, description, shipping_details, faq_info, images, featured, image, high_res_zoom)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE 
               description = COALESCE(description, VALUES(description)),
               shipping_details = COALESCE(shipping_details, VALUES(shipping_details)),
               faq_info = COALESCE(faq_info, VALUES(faq_info)),
               images = COALESCE(images, VALUES(images))`,
            [
              a.id, a.title, a.artist || '55 smartCREATIVES Studio',
              a.year || 2026, a.medium || 'Fine Art', a.dimensions || 'Custom Size',
              a.price || 0, a.status || 'Available', a.framing || 'Included Framing',
              JSON.stringify(a.frameOptions || []), a.provenance || '',
              a.curatorialStatement || '', a.description || '', a.shippingDetails || '',
              JSON.stringify(a.faq || []), JSON.stringify(a.images || [a.image]),
              a.featured ? 1 : 0, a.image, a.highResZoom || a.image
            ]
          );
        }
      }
      console.log(`✓ Seeded & enriched ${artworks.length} artworks into database`);
    }

    // 2. Seed Inquiries
    const { rows: inqCountRows } = await execute('SELECT COUNT(*) as count FROM inquiries');
    const inqCount = parseInt(inqCountRows[0].count, 10);
    if (inqCount === 0 && fs.existsSync(path.join(dataDir, 'inquiries.json'))) {
      const inquiries = JSON.parse(fs.readFileSync(path.join(dataDir, 'inquiries.json'), 'utf-8'));
      for (const inq of inquiries) {
        const inqDate = inq.date ? new Date(inq.date) : new Date();
        const conflictClause = isPostgres ? 'ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status' : 'ON DUPLICATE KEY UPDATE status=VALUES(status)';
        await execute(
          `INSERT INTO inquiries (id, artwork_id, artwork_title, artwork_artist, artwork_price, artwork_image, collector_name, collector_email, collector_phone, frame_preference, notes, status, opened, is_customer_submission, date, curator_notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ${conflictClause}`,
          [
            inq.id, inq.artworkId || null, inq.artworkTitle || 'Acquisition Inquiry',
            inq.artworkArtist || '', inq.artworkPrice || 0, inq.artworkImage || '',
            inq.collectorName || 'Anonymous Collector', inq.collectorEmail || 'unknown@example.com',
            inq.collectorPhone || '', inq.framePreference || 'Included Framing',
            inq.notes || '', inq.status || 'Pending', isPostgres ? Boolean(inq.opened) : (inq.opened ? 1 : 0),
            isPostgres ? (inq.isCustomerSubmission !== false) : (inq.isCustomerSubmission !== false ? 1 : 0), inqDate, inq.curatorNotes || ''
          ]
        );
      }
      console.log(`✓ Seeded ${inquiries.length} inquiries into database`);
    }

    // 3. Seed Users
    const { rows: userCountRows } = await execute('SELECT COUNT(*) as count FROM users');
    const userCount = parseInt(userCountRows[0].count, 10);
    if (userCount === 0 && fs.existsSync(path.join(dataDir, 'users.json'))) {
      const users = JSON.parse(fs.readFileSync(path.join(dataDir, 'users.json'), 'utf-8'));
      for (const u of users) {
        const conflictClause = isPostgres ? 'ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name' : 'ON DUPLICATE KEY UPDATE name=VALUES(name)';
        await execute(
          `INSERT INTO users (id, name, email, password, tier, phone, address, wishlist, role)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ${conflictClause}`,
          [
            u.id, u.name, u.email, u.password, u.tier || 'Collector Member',
            u.phone || '', u.address || '', JSON.stringify(u.wishlist || []), u.role || 'collector'
          ]
        );
      }
      console.log(`✓ Seeded ${users.length} users into database`);
    }

    // 4. Seed Admin
    const { rows: adminCountRows } = await execute('SELECT COUNT(*) as count FROM admins');
    const adminCount = parseInt(adminCountRows[0].count, 10);
    if (adminCount === 0 && fs.existsSync(path.join(dataDir, 'admin.json'))) {
      const adm = JSON.parse(fs.readFileSync(path.join(dataDir, 'admin.json'), 'utf-8'));
      const conflictClause = isPostgres ? 'ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name' : 'ON DUPLICATE KEY UPDATE name=VALUES(name)';
      await execute(
        `INSERT INTO admins (id, name, email, password, role)
         VALUES (?, ?, ?, ?, ?)
         ${conflictClause}`,
        ['adm-1', adm.name || '55 smartCREATIVES Admin', adm.email || 'edsonndyanabo84@gmail.com', adm.password || 'EddyPro256', adm.role || 'admin']
      );
      console.log(`✓ Seeded admin curator account into database`);
    }

    // 5. Seed Reviews
    const { rows: revCountRows } = await execute('SELECT COUNT(*) as count FROM reviews');
    const revCount = parseInt(revCountRows[0].count, 10);
    if (revCount === 0 && fs.existsSync(path.join(dataDir, 'reviews.json'))) {
      const reviews = JSON.parse(fs.readFileSync(path.join(dataDir, 'reviews.json'), 'utf-8'));
      for (const r of reviews) {
        const conflictClause = isPostgres ? 'ON CONFLICT (id) DO NOTHING' : 'ON DUPLICATE KEY UPDATE status=VALUES(status)';
        await execute(
          `INSERT INTO reviews (id, artwork_id, artwork_title, author_name, author_email, author_location, rating, comment, status, created_at, reviewed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ${conflictClause}`,
          [
            r.id, r.artworkId || null, r.artworkTitle || null,
            r.authorName, r.authorEmail, r.authorLocation || null,
            r.rating || 5, r.comment, r.status || 'approved',
            r.createdAt ? new Date(r.createdAt) : new Date(),
            r.reviewedAt ? new Date(r.reviewedAt) : new Date()
          ]
        );
      }
      console.log(`✓ Seeded ${reviews.length} reviews into database`);
    }
  } catch (e) {
    console.warn('Notice during database initial seeding:', e.message);
  }
}

// --- ARTWORKS REPOSITORY ---

function mapArtworkRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    year: r.year,
    medium: r.medium,
    dimensions: r.dimensions,
    price: parseFloat(r.price) || 0,
    status: r.status,
    framing: r.framing,
    frameOptions: typeof r.frame_options === 'string' ? JSON.parse(r.frame_options) : (r.frame_options || []),
    provenance: r.provenance,
    curatorialStatement: r.curatorial_statement,
    description: r.description || '',
    shippingDetails: r.shipping_details || '',
    faq: typeof r.faq_info === 'string' ? JSON.parse(r.faq_info) : (r.faq_info || []),
    images: typeof r.images === 'string' ? JSON.parse(r.images) : (r.images || (r.image ? [r.image] : [])),
    featured: Boolean(r.featured),
    image: r.image,
    highResZoom: r.high_res_zoom || r.image
  };
}

async function getArtworks() {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const { rows } = await execute('SELECT * FROM artworks ORDER BY created_at DESC');
  return rows.map(mapArtworkRow);
}

async function getArtworkById(id) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const { rows } = await execute('SELECT * FROM artworks WHERE id = ?', [id]);
  if (rows.length === 0) return null;
  return mapArtworkRow(rows[0]);
}

async function createArtwork(artwork) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  if (artwork.featured) {
    await execute('UPDATE artworks SET featured = FALSE');
  }
  await execute(
    `INSERT INTO artworks (id, title, artist, year, medium, dimensions, price, status, framing, frame_options, provenance, curatorial_statement, description, shipping_details, faq_info, images, featured, image, high_res_zoom)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      artwork.id, artwork.title, artwork.artist,
      artwork.year, artwork.medium, artwork.dimensions,
      artwork.price, artwork.status || 'Available', artwork.framing,
      JSON.stringify(artwork.frameOptions || []), artwork.provenance,
      artwork.curatorialStatement, artwork.description || '', artwork.shippingDetails || '',
      JSON.stringify(artwork.faq || []), JSON.stringify(artwork.images || (artwork.image ? [artwork.image] : [])),
      isPostgres ? Boolean(artwork.featured) : (artwork.featured ? 1 : 0),
      artwork.image, artwork.highResZoom || artwork.image
    ]
  );
  return getArtworkById(artwork.id);
}

async function updateArtwork(id, updates) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const existing = await getArtworkById(id);
  if (!existing) return null;

  const merged = { ...existing, ...updates };

  if (updates.featured) {
    await execute('UPDATE artworks SET featured = FALSE');
  }

  await execute(
    `UPDATE artworks SET 
       title = ?, artist = ?, year = ?, medium = ?, dimensions = ?, price = ?,
       status = ?, framing = ?, frame_options = ?, provenance = ?, curatorial_statement = ?,
       description = ?, shipping_details = ?, faq_info = ?, images = ?,
       featured = ?, image = ?, high_res_zoom = ?
     WHERE id = ?`,
    [
      merged.title, merged.artist, merged.year, merged.medium, merged.dimensions,
      merged.price, merged.status, merged.framing, JSON.stringify(merged.frameOptions || []),
      merged.provenance, merged.curatorialStatement, merged.description || '',
      merged.shippingDetails || '', JSON.stringify(merged.faq || []), JSON.stringify(merged.images || (merged.image ? [merged.image] : [])),
      isPostgres ? Boolean(merged.featured) : (merged.featured ? 1 : 0),
      merged.image, merged.highResZoom || merged.image, id
    ]
  );
  return getArtworkById(id);
}

async function deleteArtwork(id) {
  const p = await getPool();
  if (!p || !isAvailable) return false;
  const { rowCount } = await execute('DELETE FROM artworks WHERE id = ?', [id]);
  return rowCount > 0;
}

// --- INQUIRIES REPOSITORY ---

function mapInquiryRow(r) {
  if (!r) return null;
  return {
    id: r.id,
    artworkId: r.artwork_id,
    artworkTitle: r.artwork_title,
    artworkArtist: r.artwork_artist,
    artworkPrice: parseFloat(r.artwork_price) || 0,
    artworkImage: r.artwork_image,
    collectorName: r.collector_name,
    collectorEmail: r.collector_email,
    collectorPhone: r.collector_phone,
    framePreference: r.frame_preference,
    notes: r.notes,
    status: r.status,
    opened: Boolean(r.opened),
    isCustomerSubmission: Boolean(r.is_customer_submission),
    date: r.date ? new Date(r.date).toISOString() : new Date().toISOString(),
    curatorNotes: r.curator_notes,
    generatedReply: r.generated_reply || null,
    emailDeliveryResult: typeof r.email_delivery_result === 'string' ? JSON.parse(r.email_delivery_result) : (r.email_delivery_result || null),
    replySentAt: r.reply_sent_at ? new Date(r.reply_sent_at).toISOString() : null,
    makeWebhookStatus: r.make_webhook_status || 'pending'
  };
}

async function getInquiries() {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const { rows } = await execute('SELECT * FROM inquiries ORDER BY date DESC');
  return rows.map(mapInquiryRow);
}

async function getInquiryById(id) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const { rows } = await execute('SELECT * FROM inquiries WHERE id = ?', [id]);
  if (rows.length === 0) return null;
  return mapInquiryRow(rows[0]);
}

async function createInquiry(inquiry) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const inqDate = inquiry.date ? new Date(inquiry.date) : new Date();
  const deliveryResultJson = inquiry.emailDeliveryResult ? JSON.stringify(inquiry.emailDeliveryResult) : null;
  const replySentAt = inquiry.replySentAt ? new Date(inquiry.replySentAt) : null;

  const conflictClause = isPostgres
    ? `ON CONFLICT (id) DO UPDATE SET
         status = EXCLUDED.status,
         opened = EXCLUDED.opened,
         curator_notes = EXCLUDED.curator_notes,
         generated_reply = COALESCE(EXCLUDED.generated_reply, inquiries.generated_reply),
         email_delivery_result = COALESCE(EXCLUDED.email_delivery_result, inquiries.email_delivery_result),
         reply_sent_at = COALESCE(EXCLUDED.reply_sent_at, inquiries.reply_sent_at),
         make_webhook_status = COALESCE(EXCLUDED.make_webhook_status, inquiries.make_webhook_status)`
    : `ON DUPLICATE KEY UPDATE
         status = VALUES(status),
         opened = VALUES(opened),
         curator_notes = VALUES(curator_notes),
         generated_reply = COALESCE(VALUES(generated_reply), generated_reply),
         email_delivery_result = COALESCE(VALUES(email_delivery_result), email_delivery_result),
         reply_sent_at = COALESCE(VALUES(reply_sent_at), reply_sent_at),
         make_webhook_status = COALESCE(VALUES(make_webhook_status), make_webhook_status)`;

  await execute(
    `INSERT INTO inquiries (
       id, artwork_id, artwork_title, artwork_artist, artwork_price, artwork_image, 
       collector_name, collector_email, collector_phone, frame_preference, notes, 
       status, opened, is_customer_submission, date, curator_notes,
       generated_reply, email_delivery_result, reply_sent_at, make_webhook_status
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ${conflictClause}`,
    [
      inquiry.id, inquiry.artworkId || null, inquiry.artworkTitle || 'General Acquisition Inquiry',
      inquiry.artworkArtist || '', inquiry.artworkPrice || 0, inquiry.artworkImage || '',
      inquiry.collectorName || 'Anonymous Collector', inquiry.collectorEmail || 'unknown@example.com',
      inquiry.collectorPhone || '', inquiry.framePreference || 'Included Framing',
      inquiry.notes || '', inquiry.status || 'Pending', isPostgres ? Boolean(inquiry.opened) : (inquiry.opened ? 1 : 0),
      isPostgres ? (inquiry.isCustomerSubmission !== false) : (inquiry.isCustomerSubmission !== false ? 1 : 0), inqDate, inquiry.curatorNotes || '',
      inquiry.generatedReply || null, deliveryResultJson, replySentAt, inquiry.makeWebhookStatus || 'pending'
    ]
  );

  return getInquiryById(inquiry.id);
}

async function updateInquiry(id, updates) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const existing = await getInquiryById(id);
  if (!existing) return null;

  const newStatus = updates.status !== undefined ? updates.status : existing.status;
  const newOpened = updates.opened !== undefined ? (isPostgres ? Boolean(updates.opened) : (updates.opened ? 1 : 0)) : (isPostgres ? existing.opened : (existing.opened ? 1 : 0));
  const newCuratorNotes = updates.curatorNotes !== undefined ? updates.curatorNotes : existing.curatorNotes;
  const newGeneratedReply = updates.generatedReply !== undefined ? updates.generatedReply : existing.generatedReply;
  const newDeliveryResult = updates.emailDeliveryResult !== undefined ? (typeof updates.emailDeliveryResult === 'string' ? updates.emailDeliveryResult : JSON.stringify(updates.emailDeliveryResult)) : (existing.emailDeliveryResult ? JSON.stringify(existing.emailDeliveryResult) : null);
  const newReplySentAt = updates.replySentAt !== undefined ? (updates.replySentAt ? new Date(updates.replySentAt) : null) : (existing.replySentAt ? new Date(existing.replySentAt) : null);
  const newMakeStatus = updates.makeWebhookStatus !== undefined ? updates.makeWebhookStatus : existing.makeWebhookStatus;

  await execute(
    `UPDATE inquiries SET 
       status = ?, opened = ?, curator_notes = ?, 
       generated_reply = ?, email_delivery_result = ?, 
       reply_sent_at = ?, make_webhook_status = ? 
     WHERE id = ?`,
    [newStatus, newOpened, newCuratorNotes, newGeneratedReply, newDeliveryResult, newReplySentAt, newMakeStatus, id]
  );

  return getInquiryById(id);
}

async function updateInquiryReply(id, replyData) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const replySentAt = replyData.replySentAt ? new Date(replyData.replySentAt) : new Date();
  const deliveryResultJson = replyData.emailDeliveryResult ? (typeof replyData.emailDeliveryResult === 'string' ? replyData.emailDeliveryResult : JSON.stringify(replyData.emailDeliveryResult)) : null;
  const status = replyData.status || 'Contacted';

  await execute(
    `UPDATE inquiries SET 
       generated_reply = ?, 
       status = ?, 
       reply_sent_at = ?, 
       email_delivery_result = COALESCE(?, email_delivery_result),
       make_webhook_status = 'completed'
     WHERE id = ?`,
    [replyData.generatedReply, status, replySentAt, deliveryResultJson, id]
  );
  return getInquiryById(id);
}

async function updateInquiryDeliveryResult(id, deliveryResult) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const jsonStr = deliveryResult ? (typeof deliveryResult === 'string' ? deliveryResult : JSON.stringify(deliveryResult)) : null;
  await execute(
    'UPDATE inquiries SET email_delivery_result = ? WHERE id = ?',
    [jsonStr, id]
  );
  return getInquiryById(id);
}

async function updateInquiryMakeStatus(id, status) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  await execute(
    'UPDATE inquiries SET make_webhook_status = ? WHERE id = ?',
    [status, id]
  );
  return getInquiryById(id);
}

async function syncInquiries(inquiriesList) {
  const p = await getPool();
  if (!p || !isAvailable || !Array.isArray(inquiriesList)) return [];
  for (const inq of inquiriesList) {
    if (inq && inq.id) {
      await createInquiry(inq);
    }
  }
  return getInquiries();
}

// --- USERS & AUTH REPOSITORY ---

async function getUsers() {
  const p = await getPool();
  if (!p || !isAvailable) return [];
  const { rows } = await execute('SELECT * FROM users ORDER BY created_at DESC');
  return rows.map(r => ({
    id: r.id,
    name: r.name,
    email: r.email,
    password: r.password,
    tier: r.tier,
    phone: r.phone,
    address: r.address,
    wishlist: typeof r.wishlist === 'string' ? JSON.parse(r.wishlist) : (r.wishlist || []),
    role: r.role
  }));
}

async function getUserByEmail(email) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const { rows } = await execute('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    password: r.password,
    tier: r.tier,
    phone: r.phone,
    address: r.address,
    wishlist: typeof r.wishlist === 'string' ? JSON.parse(r.wishlist) : (r.wishlist || []),
    role: r.role
  };
}

async function getUserById(id) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const { rows } = await execute('SELECT * FROM users WHERE id = ?', [id]);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    password: r.password,
    tier: r.tier,
    phone: r.phone,
    address: r.address,
    wishlist: typeof r.wishlist === 'string' ? JSON.parse(r.wishlist) : (r.wishlist || []),
    role: r.role
  };
}

async function createUser(user) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  await execute(
    `INSERT INTO users (id, name, email, password, tier, phone, address, wishlist, role)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id, user.name, user.email, user.password,
      user.tier || 'Collector Member', user.phone || '',
      user.address || '', JSON.stringify(user.wishlist || []),
      user.role || 'collector'
    ]
  );
  return getUserByEmail(user.email);
}

async function updateUserProfile(email, updates) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const user = await getUserByEmail(email);
  if (!user) return null;

  const name = updates.name !== undefined ? updates.name : user.name;
  const phone = updates.phone !== undefined ? updates.phone : user.phone;
  const address = updates.address !== undefined ? updates.address : user.address;
  const password = updates.password ? updates.password : user.password;

  await execute(
    'UPDATE users SET name = ?, phone = ?, address = ?, password = ? WHERE LOWER(email) = LOWER(?)',
    [name, phone, address, password, email]
  );
  return getUserByEmail(email);
}

async function updateUserWishlist(userId, wishlist) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  await execute('UPDATE users SET wishlist = ? WHERE id = ?', [JSON.stringify(wishlist || []), userId]);
  return getUserById(userId);
}

// --- ADMIN REPOSITORY ---

async function getAdmin() {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const { rows } = await execute('SELECT * FROM admins LIMIT 1');
  if (rows.length === 0) return null;
  return rows[0];
}

async function updateAdminPassword(newPassword) {
  const p = await getPool();
  if (!p || !isAvailable) return false;
  await execute('UPDATE admins SET password = ? LIMIT 1', [newPassword]);
  return true;
}

// --- REVIEWS REPOSITORY ---

async function getApprovedReviews(artworkId = null) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  let sql = "SELECT * FROM reviews WHERE status = 'approved'";
  const params = [];
  if (artworkId) {
    sql += ' AND (artwork_id = ? OR artwork_id IS NULL)';
    params.push(artworkId);
  }
  sql += ' ORDER BY created_at DESC';
  const { rows } = await execute(sql, params);
  return rows.map(r => ({
    id: r.id,
    artworkId: r.artwork_id,
    artworkTitle: r.artwork_title,
    authorName: r.author_name,
    authorEmail: r.author_email,
    authorLocation: r.author_location,
    rating: r.rating,
    comment: r.comment,
    status: r.status,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at
  }));
}

async function getAllReviews(statusFilter = null) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  let sql = 'SELECT * FROM reviews';
  const params = [];
  if (statusFilter && statusFilter !== 'all') {
    sql += ' WHERE status = ?';
    params.push(statusFilter);
  }
  sql += ' ORDER BY created_at DESC';
  const { rows } = await execute(sql, params);
  return rows.map(r => ({
    id: r.id,
    artworkId: r.artwork_id,
    artworkTitle: r.artwork_title,
    authorName: r.author_name,
    authorEmail: r.author_email,
    authorLocation: r.author_location,
    rating: r.rating,
    comment: r.comment,
    status: r.status,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at
  }));
}

async function createReview(rev) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const newId = rev.id || 'rev-' + Math.floor(1000 + Math.random() * 9000);
  const now = new Date();
  await execute(
    `INSERT INTO reviews (id, artwork_id, artwork_title, author_name, author_email, author_location, rating, comment, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
    [
      newId, rev.artworkId || null, rev.artworkTitle || null,
      rev.authorName, rev.authorEmail, rev.authorLocation || null,
      rev.rating || 5, rev.comment, now
    ]
  );
  return {
    id: newId,
    artworkId: rev.artworkId || null,
    artworkTitle: rev.artworkTitle || null,
    authorName: rev.authorName,
    authorEmail: rev.authorEmail,
    authorLocation: rev.authorLocation || null,
    rating: rev.rating || 5,
    comment: rev.comment,
    status: 'pending',
    createdAt: now.toISOString()
  };
}

async function updateReviewStatus(id, status) {
  const p = await getPool();
  if (!p || !isAvailable) return null;
  const validStatus = ['pending', 'approved', 'rejected'].includes(status) ? status : 'pending';
  await execute(
    'UPDATE reviews SET status = ?, reviewed_at = CURRENT_TIMESTAMP WHERE id = ?',
    [validStatus, id]
  );
  const { rows } = await execute('SELECT * FROM reviews WHERE id = ?', [id]);
  if (!rows || rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    artworkId: r.artwork_id,
    artworkTitle: r.artwork_title,
    authorName: r.author_name,
    authorEmail: r.author_email,
    authorLocation: r.author_location,
    rating: r.rating,
    comment: r.comment,
    status: r.status,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at
  };
}

async function deleteReview(id) {
  const p = await getPool();
  if (!p || !isAvailable) return false;
  const { rowCount } = await execute('DELETE FROM reviews WHERE id = ?', [id]);
  return rowCount > 0;
}

module.exports = {
  initDatabase,
  getPool,
  get isAvailable() { return isAvailable; },
  get isPg() { return isPostgres; },
  get pool() { return pool; },
  execute,
  getArtworks,
  getArtworkById,
  createArtwork,
  updateArtwork,
  deleteArtwork,
  getInquiries,
  getInquiryById,
  createInquiry,
  updateInquiry,
  updateInquiryReply,
  updateInquiryDeliveryResult,
  updateInquiryMakeStatus,
  syncInquiries,
  getUsers,
  getUserByEmail,
  getUserById,
  createUser,
  updateUserProfile,
  updateUserWishlist,
  getAdmin,
  updateAdminPassword,
  getApprovedReviews,
  getAllReviews,
  createReview,
  updateReviewStatus,
  deleteReview
};
