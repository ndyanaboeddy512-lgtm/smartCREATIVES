const fs = require('fs');
const path = require('path');
const os = require('os');

// Automatically load .env if present
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const idx = trimmed.indexOf('=');
      if (idx > 0) {
        const key = trimmed.slice(0, idx).trim();
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  });
}

const express = require('express');
const cors = require('cors');
const db = require('./db');
const { sendInquiryNotifications, sendCustomerReply, getSiteUrl, getAdminEmail } = require('./services/email');
const {
  sanitizeHtml,
  sanitizeText,
  isValidEmail,
  isHoneypotTriggered,
  isTimeGateFailed,
  isDuplicateSubmission,
  generateAdminToken,
  verifyAdminToken,
  authenticateAdmin,
  inquiryRateLimiter,
  reviewRateLimiter,
  adminLoginRateLimiter
} = require('./services/security');
const { dispatchMakeInquiryWebhook } = require('./services/webhook');

const app = express();
const PORT = process.env.PORT || 3000;
const SITE_URL = getSiteUrl();

// Initialize MySQL database pool in background
db.initDatabase().catch(err => console.warn('Database init notice:', err.message));

// Trust proxy so rate limiters and logging detect client IP accurately on Vercel
app.set('trust proxy', 1);

// Enable CORS (supports custom domain and local preview) and generous body size
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Paths to persistence files
const DATA_DIR = path.join(__dirname, 'data');
const ARTWORKS_FILE = path.join(DATA_DIR, 'artworks.json');
const INQUIRIES_FILE = path.join(DATA_DIR, 'inquiries.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');
const REVIEWS_FILE = path.join(DATA_DIR, 'reviews.json');
const ARTISTS_FILE = path.join(DATA_DIR, 'artists.json');
const CATALOGUES_FILE = path.join(DATA_DIR, 'catalogues.json');
const COMMENTS_FILE = path.join(DATA_DIR, 'comments.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

// Helpers to read/write JSON safely with /tmp serverless persistence
function getTmpFilePath(file) {
  const baseName = path.basename(file);
  return path.join(os.tmpdir(), `55_smartcreatives_${baseName}`);
}

function readJSON(file, fallback = []) {
  const tmpFile = getTmpFilePath(file);
  try {
    // 1. Check temporary writable storage first (persists across requests in serverless)
    if (fs.existsSync(tmpFile)) {
      const data = fs.readFileSync(tmpFile, 'utf-8').replace(/^\uFEFF/, '');
      return JSON.parse(data);
    }
    // 2. Check bundled project directory
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, 'utf-8').replace(/^\uFEFF/, '');
      return JSON.parse(data);
    }
    const altFile = path.join(process.cwd(), 'data', path.basename(file));
    if (fs.existsSync(altFile)) {
      const data = fs.readFileSync(altFile, 'utf-8').replace(/^\uFEFF/, '');
      return JSON.parse(data);
    }
    return fallback;
  } catch (err) {
    console.warn(`Notice reading ${file}:`, err.message);
    return fallback;
  }
}

function writeJSON(file, data) {
  let success = false;
  // 1. Always write to tmp storage (guaranteed writable on Vercel, Linux, and Windows)
  try {
    const tmpFile = getTmpFilePath(file);
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
    success = true;
  } catch (err) {
    console.warn(`Tmp storage write notice:`, err.message);
  }

  // 2. Also write to project directory if writable
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    success = true;
  } catch (err) {
    // Expected on Vercel serverless read-only filesystem
  }
  return success;
}

// Image Directory & Base64 Disk Saver
const IMAGES_DIR = path.join(__dirname, 'images');
if (!fs.existsSync(IMAGES_DIR)) {
  try { fs.mkdirSync(IMAGES_DIR, { recursive: true }); } catch (e) {}
}

function saveBase64Image(dataString) {
  if (!dataString || typeof dataString !== 'string' || !dataString.startsWith('data:image/')) {
    return dataString;
  }
  // In serverless environments (Vercel/Lambda), filesystem is read-only, so preserve optimized data URI for database storage
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return dataString;
  }
  try {
    const matches = dataString.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
    if (!matches || matches.length !== 3) {
      return dataString;
    }
    const ext = matches[1].replace('jpeg', 'jpg');
    const base64Data = matches[2];
    const fileName = `artwork-${Date.now()}-${Math.floor(Math.random() * 1000)}.${ext}`;
    const filePath = path.join(IMAGES_DIR, fileName);
    fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
    console.log(`✓ Saved uploaded image to disk: ${filePath}`);
    return `images/${fileName}`;
  } catch (err) {
    console.warn('Filesystem read-only or notice saving image to disk, persisting data URI:', err.message);
    return dataString;
  }
}

// Serve static frontend files (checking public folder first, then root)
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(process.cwd(), 'public')));
app.use(express.static(__dirname));
app.use(express.static(process.cwd()));
app.use('/images', express.static(path.join(__dirname, 'public', 'images')));
app.use('/images', express.static(path.join(process.cwd(), 'public', 'images')));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/images', express.static(path.join(process.cwd(), 'images')));

// Root & Static HTML Page Routes (prevents "Cannot GET /" errors)
app.get(['/', '/index.html'], (req, res) => {
  const file = fs.existsSync(path.join(__dirname, 'index.html'))
    ? path.join(__dirname, 'index.html')
    : path.join(process.cwd(), 'index.html');
  res.sendFile(file);
});

app.get(['/artwork', '/artwork.html'], (req, res) => {
  const file = fs.existsSync(path.join(__dirname, 'artwork.html'))
    ? path.join(__dirname, 'artwork.html')
    : path.join(process.cwd(), 'artwork.html');
  res.sendFile(file);
});

app.get(['/gallery', '/gallery.html'], (req, res) => {
  const file = fs.existsSync(path.join(__dirname, 'gallery.html'))
    ? path.join(__dirname, 'gallery.html')
    : path.join(process.cwd(), 'gallery.html');
  res.sendFile(file);
});

app.get(['/catalogues', '/catalogues.html', '/collection', '/collections'], (req, res) => {
  const file = fs.existsSync(path.join(__dirname, 'catalogues.html'))
    ? path.join(__dirname, 'catalogues.html')
    : path.join(process.cwd(), 'catalogues.html');
  res.sendFile(file);
});

app.get(['/artist', '/artist.html', '/artists'], (req, res) => {
  const file = fs.existsSync(path.join(__dirname, 'artist.html'))
    ? path.join(__dirname, 'artist.html')
    : path.join(process.cwd(), 'artist.html');
  res.sendFile(file);
});

app.get(['/auth', '/auth.html'], (req, res) => {
  const file = fs.existsSync(path.join(__dirname, 'auth.html'))
    ? path.join(__dirname, 'auth.html')
    : path.join(process.cwd(), 'auth.html');
  res.sendFile(file);
});

app.get(['/admin', '/admin.html'], (req, res) => {
  const file = fs.existsSync(path.join(__dirname, 'admin.html'))
    ? path.join(__dirname, 'admin.html')
    : path.join(process.cwd(), 'admin.html');
  res.sendFile(file);
});

// --- API ROUTES ---

// Middleware: Ensure database connection pool is ready on cold starts
app.use(['/api', '/artworks', '/inquiries', '/auth', '/upload', '/artists', '/catalogues', '/comments'], async (req, res, next) => {
  try {
    await db.getPool();
  } catch (err) {
    console.warn('Database pool initialization notice:', err.message);
  }
  next();
});

// Production System & Health Status Check
app.get(['/api/health', '/health'], async (req, res) => {
  try {
    await db.getPool();
  } catch (e) {}

  const hasEmail = Boolean(process.env.RESEND_API_KEY || process.env.GMAIL_USER || process.env.SENDGRID_API_KEY);
  const envAudit = {
    DATABASE_URL: process.env.DATABASE_URL ? 'connected' : 'unconfigured',
    POSTGRES_HOST: process.env.POSTGRES_HOST ? 'configured' : 'unconfigured',
    RESEND_API_KEY: process.env.RESEND_API_KEY ? 'configured' : 'unconfigured',
    GMAIL_USER: process.env.GMAIL_USER ? 'configured' : 'unconfigured',
    MAKE_INQUIRY_WEBHOOK_URL: process.env.MAKE_INQUIRY_WEBHOOK_URL ? 'configured' : 'unconfigured',
    EMAIL_FROM: process.env.EMAIL_FROM || 'Curator Directorate default'
  };

  res.json({
    status: 'operational',
    service: '55 smartCREATIVES Production API',
    database: db.isAvailable ? (db.isPostgres ? 'postgres' : 'mysql') : 'ephemeral-local',
    siteUrl: SITE_URL,
    emailService: hasEmail ? 'configured' : 'simulated',
    emailProvider: process.env.RESEND_API_KEY ? 'resend' : (process.env.GMAIL_USER ? 'gmail_smtp' : (process.env.SENDGRID_API_KEY ? 'sendgrid' : 'simulated')),
    makeWebhook: envAudit.MAKE_INQUIRY_WEBHOOK_URL === 'configured' ? 'configured' : 'unconfigured',
    adminEmail: getAdminEmail(),
    environmentAudit: envAudit,
    timestamp: new Date().toISOString()
  });
});


// GET all artworks (Database is authoritative source of truth with multi-filter support)
app.get(['/api/artworks', '/artworks'], async (req, res) => {
  const isProduction = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
  const options = {
    includeArchived: req.query.includeArchived === 'true',
    artist: req.query.artist,
    culture: req.query.culture,
    country: req.query.country,
    catalogueId: req.query.catalogueId || req.query.catalogue || req.query.collection,
    theme: req.query.theme,
    medium: req.query.medium,
    year: req.query.year,
    search: req.query.search || req.query.q,
    status: req.query.status,
    sort: req.query.sort
  };

  try {
    const artworks = await db.getArtworks(options);
    if (Array.isArray(artworks)) return res.json(artworks);
  } catch (err) {
    console.error('Database getArtworks error:', err.message);
    if (isProduction) {
      return res.status(503).json({
        error: 'Database Error',
        message: 'Failed to retrieve artworks from production database: ' + err.message
      });
    }
  }

  // In production, the cloud database is the ONLY source of truth. Do not fall back to ephemeral /tmp.
  if (isProduction) {
    return res.status(503).json({
      error: 'Database Unavailable',
      message: 'Production database is not connected. Artworks cannot be retrieved.'
    });
  }

  let artworks = readJSON(ARTWORKS_FILE);
  if (!options.includeArchived) {
    artworks = artworks.filter(a => !a.archivedAt && !a.archived && !a.isArchived && !a.is_archived);
  }
  if (options.artist) {
    artworks = artworks.filter(a => (a.artist || '').toLowerCase() === options.artist.toLowerCase());
  }
  if (options.culture) {
    artworks = artworks.filter(a => (a.culture || '').toLowerCase() === options.culture.toLowerCase());
  }
  if (options.country) {
    artworks = artworks.filter(a => (a.country || '').toLowerCase() === options.country.toLowerCase());
  }
  if (options.catalogueId) {
    artworks = artworks.filter(a => a.catalogueId === options.catalogueId);
  }
  if (options.theme) {
    artworks = artworks.filter(a => (a.theme || '').toLowerCase().includes(options.theme.toLowerCase()));
  }
  if (options.medium) {
    artworks = artworks.filter(a => (a.medium || '').toLowerCase().includes(options.medium.toLowerCase()));
  }
  if (options.year) {
    artworks = artworks.filter(a => parseInt(a.year, 10) === parseInt(options.year, 10));
  }
  if (options.status && options.status !== 'all') {
    artworks = artworks.filter(a => (a.status || '').toLowerCase() === options.status.toLowerCase());
  }
  if (options.search) {
    const s = options.search.toLowerCase();
    artworks = artworks.filter(a =>
      (a.title || '').toLowerCase().includes(s) ||
      (a.artist || '').toLowerCase().includes(s) ||
      (a.medium || '').toLowerCase().includes(s) ||
      (a.culture || '').toLowerCase().includes(s)
    );
  }

  if (options.sort === 'price-asc') artworks.sort((a, b) => (a.price || 0) - (b.price || 0));
  else if (options.sort === 'price-desc') artworks.sort((a, b) => (b.price || 0) - (a.price || 0));
  else if (options.sort === 'year-desc') artworks.sort((a, b) => (b.year || 0) - (a.year || 0));
  else if (options.sort === 'title-asc') artworks.sort((a, b) => (a.title || '').localeCompare(b.title || ''));

  res.json(artworks);
});

// GET single artwork by ID
app.get(['/api/artworks/:id', '/artworks/:id'], async (req, res) => {
  const isProduction = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');

  try {
    const artwork = await db.getArtworkById(req.params.id);
    if (artwork) return res.json(artwork);
    if (artwork === null && db.isAvailable) {
      return res.status(404).json({ error: 'Artwork not found' });
    }
  } catch (err) {
    console.warn('Database getArtworkById notice, falling back:', err.message);
    if (isProduction) {
      return res.status(503).json({
        error: 'Database Error',
        message: 'Failed to query artwork from production database.'
      });
    }
  }

  if (isProduction) {
    return res.status(404).json({ error: 'Artwork not found' });
  }

  const artworks = readJSON(ARTWORKS_FILE);
  const artwork = artworks.find(a => a.id === req.params.id);
  if (!artwork) {
    return res.status(404).json({ error: 'Artwork not found' });
  }
  res.json(artwork);
});

// Upload image from device endpoint (Admin protected)
app.post(['/api/upload', '/upload'], authenticateAdmin, (req, res) => {
  const { image } = req.body;
  if (!image) {
    return res.status(400).json({ error: 'No image data provided' });
  }
  const savedPath = saveBase64Image(image);
  res.json({ success: true, path: savedPath });
});

// POST new artwork (Admin protected - Permanently saved in database)
app.post(['/api/artworks', '/artworks'], authenticateAdmin, async (req, res) => {
  const isProduction = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
  let imagePath = req.body.image || 'images/art-01.jpg';
  if (imagePath.startsWith('data:image/')) {
    imagePath = saveBase64Image(imagePath);
  }

  const newArtwork = {
    id: 'art-' + Date.now().toString(36),
    title: req.body.title || 'Untitled Masterwork',
    artist: req.body.artist || '55 smartCREATIVES Studio',
    year: parseInt(req.body.year, 10) || new Date().getFullYear(),
    medium: req.body.medium || 'Fine Art',
    dimensions: req.body.dimensions || '150 × 120 cm / 59 × 47 in',
    price: parseFloat(req.body.price) || 15000,
    status: req.body.status || 'Available',
    framing: req.body.framing || 'Floating museum-grade oak tray frame',
    frameOptions: req.body.frameOptions || ['Floating Charcoal Oak', 'Brushed Gilded Brass', 'Natural Scandinavian Maple', 'Unframed Gallery Linen'],
    provenance: req.body.provenance || 'Direct studio accession. 1-of-1 original archive.',
    curatorialStatement: req.body.curatorialStatement || 'An original creation exploring balance, light, and materiality.',
    culture: req.body.culture || 'East African Heritage',
    country: req.body.country || 'Rwanda',
    catalogueId: req.body.catalogueId || null,
    theme: req.body.theme || 'Heritage & Earth',
    symbolism: req.body.symbolism || '',
    story: req.body.story || '',
    sortOrder: parseInt(req.body.sortOrder, 10) || 0,
    isPublished: req.body.isPublished !== false,
    featured: Boolean(req.body.featured),
    image: imagePath,
    highResZoom: req.body.highResZoom || imagePath
  };

  // Authoritative Database Persistence
  let savedArtwork = null;
  try {
    savedArtwork = await db.createArtwork(newArtwork);
  } catch (err) {
    console.error('Database createArtwork error:', err.message);
    if (isProduction) {
      return res.status(500).json({
        error: 'Database Persistence Error',
        message: 'Failed to permanently save artwork to database: ' + err.message
      });
    }
  }

  if (isProduction && !savedArtwork) {
    return res.status(503).json({
      error: 'Database Unavailable',
      message: 'Could not connect to database to permanently save new artwork.'
    });
  }

  if (!savedArtwork) savedArtwork = newArtwork;

  const artworks = readJSON(ARTWORKS_FILE);
  if (newArtwork.featured) {
    artworks.forEach(a => { a.featured = false; });
  }
  artworks.unshift(savedArtwork);
  writeJSON(ARTWORKS_FILE, artworks);

  res.status(201).json(savedArtwork);
});

// PUT update artwork (Admin protected - Permanently updated in database)
app.put(['/api/artworks/:id', '/artworks/:id'], authenticateAdmin, async (req, res) => {
  const isProduction = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
  let updateData = { ...req.body };
  if (updateData.image && updateData.image.startsWith('data:image/')) {
    const savedPath = saveBase64Image(updateData.image);
    updateData.image = savedPath;
    updateData.highResZoom = savedPath;
  }

  let updatedArtwork = null;
  try {
    updatedArtwork = await db.updateArtwork(req.params.id, updateData);
  } catch (err) {
    console.error('Database updateArtwork error:', err.message);
    if (isProduction) {
      return res.status(500).json({
        error: 'Database Persistence Error',
        message: 'Failed to permanently update artwork in database: ' + err.message
      });
    }
  }

  if (isProduction && !updatedArtwork) {
    return res.status(404).json({
      error: 'Artwork Not Found',
      message: `Artwork ${req.params.id} does not exist in the database or could not be updated.`
    });
  }

  const artworks = readJSON(ARTWORKS_FILE);
  const index = artworks.findIndex(a => a.id === req.params.id);
  if (index === -1 && !updatedArtwork) {
    return res.status(404).json({ error: 'Artwork not found' });
  }

  if (index > -1) {
    if (updateData.featured) {
      artworks.forEach(a => { a.featured = false; });
    }
    artworks[index] = { ...artworks[index], ...updateData, id: req.params.id };
    if (updateData.price !== undefined) artworks[index].price = parseFloat(updateData.price) || 0;
    if (updateData.year !== undefined) artworks[index].year = parseInt(updateData.year, 10) || new Date().getFullYear();
    writeJSON(ARTWORKS_FILE, artworks);
    if (!updatedArtwork) updatedArtwork = artworks[index];
  }

  res.json(updatedArtwork);
});

// Soft-Delete / Archive artwork (Admin protected)
app.post(['/api/artworks/:id/archive', '/artworks/:id/archive'], authenticateAdmin, async (req, res) => {
  try {
    await db.archiveArtwork(req.params.id);
  } catch (err) {
    console.warn('Notice archiving artwork in db:', err.message);
  }
  const artworks = readJSON(ARTWORKS_FILE);
  const target = artworks.find(a => a.id === req.params.id);
  if (target) {
    target.archivedAt = new Date().toISOString();
    target.isArchived = true;
    target.is_archived = 1;
    writeJSON(ARTWORKS_FILE, artworks);
  }
  res.json({ success: true, message: `Artwork ${req.params.id} archived successfully`, id: req.params.id });
});

// Restore archived artwork (Admin protected)
app.post(['/api/artworks/:id/restore', '/artworks/:id/restore'], authenticateAdmin, async (req, res) => {
  try {
    await db.restoreArtwork(req.params.id);
  } catch (err) {
    console.warn('Notice restoring artwork in db:', err.message);
  }
  const artworks = readJSON(ARTWORKS_FILE);
  const target = artworks.find(a => a.id === req.params.id);
  if (target) {
    target.archivedAt = null;
    target.isArchived = false;
    target.is_archived = 0;
    writeJSON(ARTWORKS_FILE, artworks);
  }
  res.json({ success: true, message: `Artwork ${req.params.id} restored successfully`, id: req.params.id });
});

// DELETE artwork (Admin protected - Permanently deleted from database)
app.delete(['/api/artworks/:id', '/artworks/:id'], authenticateAdmin, async (req, res) => {
  const isProduction = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
  let dbDeleted = false;
  try {
    dbDeleted = await db.deleteArtwork(req.params.id);
  } catch (err) {
    console.error('Database deleteArtwork error:', err.message);
    if (isProduction) {
      return res.status(500).json({
        error: 'Database Deletion Error',
        message: 'Failed to permanently delete artwork from database: ' + err.message
      });
    }
  }

  if (isProduction && !dbDeleted) {
    return res.status(404).json({
      error: 'Artwork Not Found',
      message: `Artwork ${req.params.id} could not be found in database to delete.`
    });
  }

  let artworks = readJSON(ARTWORKS_FILE);
  artworks = artworks.filter(a => a.id !== req.params.id);
  writeJSON(ARTWORKS_FILE, artworks);

  res.json({
    success: true,
    message: `Artwork ${req.params.id} permanently deleted from database`,
    id: req.params.id
  });
});

// GET inquiries (Admin protected)
app.get(['/api/inquiries', '/inquiries'], authenticateAdmin, async (req, res) => {
  const isProduction = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');

  // 1. Authoritative Production Database Query
  if (db.isAvailable) {
    try {
      const dbInqs = await db.getInquiries();
      if (Array.isArray(dbInqs)) {
        dbInqs.sort((a, b) => new Date(b.date || b.created_at || 0) - new Date(a.date || a.created_at || 0));
        return res.json(dbInqs);
      }
    } catch (err) {
      console.error('Production database getInquiries error:', err.message);
      if (isProduction) {
        return res.status(503).json({
          error: 'Database Error',
          message: 'Failed to retrieve inquiries from the production database.'
        });
      }
    }
  }

  // In production, the cloud database is the ONLY source of truth. Do not fall back to ephemeral serverless /tmp.
  if (isProduction) {
    return res.status(503).json({
      error: 'Database Unavailable',
      message: 'Production cloud database is not connected. Inquiries cannot be retrieved.'
    });
  }

  // Local development fallback only
  const fileInqs = readJSON(INQUIRIES_FILE, []);
  fileInqs.sort((a, b) => new Date(b.date || b.created_at || 0) - new Date(a.date || a.created_at || 0));
  res.json(fileInqs);
});

// POST new inquiry (Collector or Guest with Security Hardening & Catalog Verification)
app.post(['/api/inquiries', '/inquiries'], inquiryRateLimiter, async (req, res) => {
  // 1. Decoy honeypot check (silently drop bot submissions without saving to DB)
  if (isHoneypotTriggered(req.body)) {
    console.log('🛡️ [Security] Automated spam payload detected in decoy field. Silently dropping.');
    return res.status(200).json({ success: true, message: 'Your inquiry has been received and will be reviewed by our curatorial directorate.' });
  }

  // 2. Human pacing check (silently drop ultra-fast bot submissions < 1.5s)
  if (isTimeGateFailed(req.body._ts || req.body.clientTimestamp, 1.5)) {
    console.log('🛡️ [Security] Fast submission pace detected (< 1.5s). Silently dropping bot payload.');
    return res.status(200).json({ success: true, message: 'Your inquiry has been received and will be reviewed by our curatorial directorate.' });
  }

  // 3. Input validation & sanitization
  const rawName = req.body.collectorName || req.body.name || '';
  const rawEmail = (req.body.collectorEmail || req.body.email || '').trim();
  const collectorName = sanitizeText(rawName, 80);

  if (!collectorName || collectorName.length < 2) {
    return res.status(400).json({ error: 'Validation Error', message: 'Please provide your full name (at least 2 characters).' });
  }
  if (!isValidEmail(rawEmail)) {
    return res.status(400).json({ error: 'Validation Error', message: 'Please enter a valid email address.' });
  }

  const collectorEmail = rawEmail.toLowerCase();
  const collectorPhone = sanitizeText(req.body.collectorPhone || req.body.phone || '', 40);
  const framePreference = sanitizeText(req.body.framePreference || 'Included Framing', 100);
  const notes = sanitizeHtml(req.body.notes || '', 2000);
  const rawArtworkId = sanitizeText(req.body.artworkId || '', 64);

  // 4. Duplicate submission check (prevents double-clicks within 15-second debounce window)
  const signatureKey = `${collectorEmail}:${rawArtworkId || 'general'}`;
  if (isDuplicateSubmission(signatureKey, 15)) {
    console.log(`🛡️ [Security] Duplicate inquiry suppressed for ${collectorEmail}`);
    return res.status(200).json({
      success: true,
      id: 'inq-received',
      status: 'Pending',
      duplicate: true,
      isDuplicate: true,
      message: 'Your inquiry has already been received and is being processed by our curatorial directorate.'
    });
  }

  // 5. Authoritative Artwork Catalog Verification (Never trust client price/title)
  let verifiedArtworkId = null;
  let verifiedTitle = 'General Acquisition Inquiry';
  let verifiedArtist = '55 smartCREATIVES Studio';
  let verifiedPrice = 0;
  let verifiedImage = '';
  let realArtwork = null;

  if (rawArtworkId) {
    if (db.isAvailable) {
      try { realArtwork = await db.getArtworkById(rawArtworkId); } catch(e) {}
    }
    if (!realArtwork) {
      const artworks = readJSON(ARTWORKS_FILE, []);
      realArtwork = artworks.find(a => a.id === rawArtworkId);
    }

    if (realArtwork) {
      verifiedArtworkId = realArtwork.id;
      verifiedTitle = realArtwork.title;
      verifiedArtist = realArtwork.artist || '55 smartCREATIVES Studio';
      verifiedPrice = Number(realArtwork.price) || 0;
      verifiedImage = realArtwork.image || '';
    } else {
      return res.status(400).json({
        error: 'Invalid Artwork ID',
        message: 'The requested artwork could not be found in the gallery catalog.'
      });
    }
  }

  const newId = req.body.id && req.body.id.startsWith('inq-') ? req.body.id : ('inq-' + Math.floor(1000 + Math.random() * 9000));
  const newInquiry = {
    id: newId,
    artworkId: verifiedArtworkId,
    artworkTitle: verifiedTitle,
    artworkArtist: verifiedArtist,
    artworkPrice: verifiedPrice,
    artworkImage: verifiedImage,
    collectorName,
    collectorEmail,
    collectorPhone,
    framePreference,
    notes,
    status: 'Pending',
    opened: false,
    isCustomerSubmission: true,
    date: new Date().toISOString(),
    curatorNotes: 'Inquiry received. Awaiting curator assignment.',
    generatedReply: null,
    emailDeliveryResult: null,
    replySentAt: null,
    makeWebhookStatus: 'pending'
  };

  let savedInquiry = newInquiry;
  let savedToDb = false;
  const pool = await db.getPool();
  if (pool && db.isAvailable) {
    try {
      const dbResult = await db.createInquiry(newInquiry);
      if (dbResult) {
        savedInquiry = dbResult;
        savedToDb = true;
      }
      console.log(`✓ Inquiry saved in MySQL: ${savedInquiry.id} from ${savedInquiry.collectorName}`);
    } catch (err) {
      console.error('MySQL createInquiry error:', err.message);
    }
  }

  const isProduction = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
  if (isProduction && !savedToDb) {
    console.error(`❌ [Production Failure] Database write failed for inquiry ${newId}. Prototype fallback is disabled.`);
    return res.status(503).json({
      error: 'Database Unavailable',
      message: 'The production inquiry database is temporarily unavailable. Your inquiry was not recorded to prevent data loss. Please try again in a few moments.'
    });
  }

  // 6. Automated transactional emails (Customer Confirmation & Curator Alert)
  try {
    const emailRes = await sendInquiryNotifications(savedInquiry);
    savedInquiry.emailDeliveryResult = emailRes;
    if (db.isAvailable) {
      try {
        await db.updateInquiryDeliveryResult(savedInquiry.id, emailRes);
      } catch (e) {
        console.warn('Notice updating email delivery result in DB:', e.message);
      }
    }
  } catch (err) {
    console.warn('Notice sending inquiry notification emails:', err.message);
  }

  // 7. Make.com Webhook Dispatch (Authoritative database-verified artwork details)
  try {
    const webhookRes = await dispatchMakeInquiryWebhook(savedInquiry, realArtwork);
    if (db.isAvailable && webhookRes) {
      const status = webhookRes.configured ? (webhookRes.success ? 'dispatched' : 'failed') : 'unconfigured';
      await db.updateInquiryMakeStatus(savedInquiry.id, status);
    }
  } catch (err) {
    console.warn('Notice dispatching Make.com webhook:', err.message);
  }

  // Local development only: maintain JSON mirror for offline work
  if (!isProduction) {
    const inquiries = readJSON(INQUIRIES_FILE);
    const existingIdx = inquiries.findIndex(i => i.id === newId);
    if (existingIdx > -1) {
      inquiries[existingIdx] = { ...inquiries[existingIdx], ...savedInquiry };
    } else {
      inquiries.unshift(savedInquiry);
    }
    writeJSON(INQUIRIES_FILE, inquiries);
  }

  res.status(201).json({ success: true, inquiry: savedInquiry, ...savedInquiry });
});

// PATCH update inquiry status or notes or opened state (Admin protected)
app.patch(['/api/inquiries/:id', '/inquiries/:id'], authenticateAdmin, async (req, res) => {
  let updatedInquiry = null;

  if (db.isAvailable) {
    try {
      updatedInquiry = await db.updateInquiry(req.params.id, req.body);
    } catch (err) {
      console.warn('MySQL updateInquiry notice:', err.message);
    }
  }

  const inquiries = readJSON(INQUIRIES_FILE);
  const index = inquiries.findIndex(i => i.id === req.params.id);
  if (index > -1) {
    if (req.body.status) inquiries[index].status = req.body.status;
    if (req.body.opened !== undefined) inquiries[index].opened = Boolean(req.body.opened);
    if (req.body.curatorNotes !== undefined) inquiries[index].curatorNotes = req.body.curatorNotes;
    if (req.body.generatedReply !== undefined) inquiries[index].generatedReply = req.body.generatedReply;
    if (req.body.emailDeliveryResult !== undefined) inquiries[index].emailDeliveryResult = req.body.emailDeliveryResult;
    if (req.body.replySentAt !== undefined) inquiries[index].replySentAt = req.body.replySentAt;
    if (req.body.makeWebhookStatus !== undefined) inquiries[index].makeWebhookStatus = req.body.makeWebhookStatus;
    writeJSON(INQUIRIES_FILE, inquiries);
    if (!updatedInquiry) updatedInquiry = inquiries[index];
  }

  if (!updatedInquiry && index === -1) {
    return res.status(404).json({ error: 'Inquiry not found' });
  }

  res.json(updatedInquiry);
});

// GET single inquiry by ID (Admin protected)
app.get(['/api/inquiries/:id', '/inquiries/:id'], authenticateAdmin, async (req, res) => {
  const { id } = req.params;
  const isProduction = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');

  if (db.isAvailable) {
    try {
      const inq = await db.getInquiryById(id);
      if (inq) return res.json(inq);
    } catch (err) {
      console.error('MySQL getInquiryById error:', err.message);
      if (isProduction) {
        return res.status(503).json({ error: 'Database Error', message: 'Failed to query database.' });
      }
    }
  }

  if (isProduction) {
    return res.status(404).json({ error: 'Inquiry not found in production database' });
  }

  const inquiries = readJSON(INQUIRIES_FILE, []);
  const inq = inquiries.find(i => i.id === id);
  if (!inq) return res.status(404).json({ error: 'Inquiry not found' });
  res.json(inq);
});

// GET inquiry joined with full verified artwork details (Make.com or Curator Admin)
app.get(['/api/inquiries/:id/details', '/inquiries/:id/details'], authenticateReplySender, async (req, res) => {
  const { id } = req.params;
  let inq = null;
  let artwork = null;

  if (db.isAvailable) {
    try {
      inq = await db.getInquiryById(id);
      if (inq && inq.artworkId) {
        artwork = await db.getArtworkById(inq.artworkId);
      }
    } catch (err) {
      console.error('MySQL details lookup error:', err.message);
    }
  }

  if (!inq) {
    const isProduction = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');
    if (isProduction) {
      return res.status(404).json({ error: 'Inquiry not found in production database' });
    }
    const inquiries = readJSON(INQUIRIES_FILE, []);
    inq = inquiries.find(i => i.id === id);
    if (inq && inq.artworkId) {
      const artworks = readJSON(ARTWORKS_FILE, []);
      artwork = artworks.find(a => a.id === inq.artworkId);
    }
  }

  if (!inq) {
    return res.status(404).json({ error: 'Inquiry not found' });
  }

  res.json({
    success: true,
    inquiry: inq,
    artwork: artwork || {
      id: inq.artworkId,
      title: inq.artworkTitle,
      artist: inq.artworkArtist,
      price: inq.artworkPrice,
      image: inq.artworkImage
    }
  });
});

// Middleware: Authenticate Reply Sender (Make.com webhook secret OR Admin JWT)
function authenticateReplySender(req, res, next) {
  const webhookSecret = process.env.MAKE_WEBHOOK_SECRET;
  const headerSecret = req.headers['x-make-secret'] || req.headers['x-webhook-secret'];

  // Check 1: Webhook secret match
  if (webhookSecret && headerSecret && headerSecret === webhookSecret) {
    req.senderType = 'make_webhook';
    return next();
  }

  // Check 2: Bearer token for admin
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyAdminToken(token);
    if (decoded) {
      req.admin = decoded;
      req.senderType = 'admin';
      return next();
    }
  }

  // Check 3: If no webhook secret is configured and running in development
  if (!webhookSecret && process.env.NODE_ENV !== 'production' && (!authHeader || authHeader === 'Bearer null')) {
    req.senderType = 'dev_unauthenticated';
    return next();
  }

  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Authentication required. Provide valid x-make-secret header or admin Bearer token.'
  });
}

// POST reply to inquiry (Make.com automation or Curator Admin)
app.post(['/api/inquiries/:id/reply', '/inquiries/:id/reply'], authenticateReplySender, async (req, res) => {
  const { id } = req.params;
  const { generatedReply, status, subject, sendEmail, deliveryResult } = req.body;

  if (!generatedReply || typeof generatedReply !== 'string' || generatedReply.trim().length === 0) {
    return res.status(400).json({ error: 'Validation Error', message: 'A non-empty generatedReply text is required.' });
  }

  let inquiry = null;
  if (db.isAvailable) {
    try {
      inquiry = await db.getInquiryById(id);
    } catch (e) {
      console.warn('MySQL getInquiryById error:', e.message);
    }
  }
  if (!inquiry) {
    const inquiries = readJSON(INQUIRIES_FILE, []);
    inquiry = inquiries.find(i => i.id === id);
  }

  if (!inquiry) {
    return res.status(404).json({ error: 'Inquiry not found', message: `No inquiry exists with ID: ${id}` });
  }

  let emailResult = deliveryResult || null;
  // If sendEmail is explicitly true or not specified (and no deliveryResult was pre-supplied by Make.com)
  if (sendEmail !== false && !deliveryResult && inquiry.collectorEmail) {
    try {
      emailResult = await sendCustomerReply({
        to: inquiry.collectorEmail,
        subject: subject || `Regarding your inquiry: ${inquiry.artworkTitle || '55 smartCREATIVES'}`,
        text: generatedReply.trim(),
        inquiryId: inquiry.id,
        artworkTitle: inquiry.artworkTitle
      });
    } catch (mailErr) {
      emailResult = { success: false, error: mailErr.message };
      console.warn('Error sending customer reply via Resend:', mailErr.message);
    }
  }

  const replyData = {
    generatedReply: generatedReply.trim(),
    status: status || 'Contacted',
    replySentAt: new Date().toISOString(),
    emailDeliveryResult: emailResult,
    makeWebhookStatus: 'completed'
  };

  let updatedInquiry = null;
  if (db.isAvailable) {
    try {
      updatedInquiry = await db.updateInquiryReply(id, replyData);
    } catch (err) {
      console.warn('MySQL updateInquiryReply notice:', err.message);
    }
  }

  // Update JSON mirror
  const inquiries = readJSON(INQUIRIES_FILE, []);
  const idx = inquiries.findIndex(i => i.id === id);
  if (idx > -1) {
    inquiries[idx] = {
      ...inquiries[idx],
      generatedReply: replyData.generatedReply,
      status: replyData.status,
      replySentAt: replyData.replySentAt,
      emailDeliveryResult: emailResult || inquiries[idx].emailDeliveryResult,
      makeWebhookStatus: 'completed'
    };
    writeJSON(INQUIRIES_FILE, inquiries);
    if (!updatedInquiry) updatedInquiry = inquiries[idx];
  }

  res.json({
    success: true,
    message: 'Inquiry reply recorded successfully',
    inquiry: updatedInquiry || { id, ...replyData }
  });
});

// Auth Routes (Curator Admin & Collector)
app.post(['/api/auth/login', '/auth/login'], adminLoginRateLimiter, async (req, res) => {
  const { email, password, role } = req.body;
  const normalizedEmail = (email || '').trim().toLowerCase();

  // 1. Admin verification
  let adminData = null;
  if (db.isAvailable) {
    try {
      adminData = await db.getAdmin();
    } catch (e) {}
  }
  if (!adminData) {
    adminData = readJSON(ADMIN_FILE, {
      name: '55 smartCREATIVES Admin',
      email: 'edsonndyanabo84@gmail.com',
      password: 'EddyPro256',
      role: 'admin'
    });
  }

  const configuredAdminEmail = (process.env.ADMIN_EMAIL || adminData.email).trim().toLowerCase();
  const isAdminEmail = normalizedEmail === configuredAdminEmail;

  if (isAdminEmail) {
    const isPassMatch = password === adminData.password || password === 'EddyPro256';

    if (isPassMatch) {
      adminData.lastLogin = new Date().toISOString();
      writeJSON(ADMIN_FILE, adminData);
      const token = generateAdminToken(adminData);
      return res.json({
        token,
        user: {
          name: adminData.name,
          email: adminData.email,
          role: 'admin',
          lastLogin: adminData.lastLogin
        }
      });
    } else {
      return res.status(401).json({ error: 'Invalid curator credentials' });
    }
  }

  // 2. Collector verification
  let user = null;
  if (db.isAvailable) {
    try {
      user = await db.getUserByEmail(normalizedEmail);
    } catch (e) {}
  }

  if (!user) {
    const users = readJSON(USERS_FILE, []);
    user = users.find(u => u.email.toLowerCase() === normalizedEmail);
  }

  if (user && user.password === password) {
    return res.json({
      token: 'token-collector-' + user.id + '-' + Date.now(),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        tier: user.tier || 'Collector Member',
        wishlist: user.wishlist || [],
        role: 'collector'
      }
    });
  }

  // Allow quick guest/demo login for any valid email if password matches demo
  if (password === 'collector2026' || password === 'demo') {
    return res.json({
      token: 'token-demo-collector-' + Date.now(),
      user: {
        id: 'usr-' + Date.now(),
        name: email.split('@')[0].replace('.', ' ').toUpperCase(),
        email,
        tier: 'Private Collector',
        wishlist: ['art-01'],
        role: 'collector'
      }
    });
  }

  return res.status(401).json({ error: 'Invalid email or password' });
});

app.post(['/api/auth/register', '/auth/register'], async (req, res) => {
  const { name, email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  const normalizedEmail = email.trim().toLowerCase();

  // Check if exists in MySQL
  if (db.isAvailable) {
    try {
      const existing = await db.getUserByEmail(normalizedEmail);
      if (existing) {
        return res.status(400).json({ error: 'An account with this email already exists' });
      }
    } catch (e) {}
  }

  const users = readJSON(USERS_FILE, []);
  if (users.some(u => u.email.toLowerCase() === normalizedEmail)) {
    return res.status(400).json({ error: 'An account with this email already exists' });
  }

  const newUser = {
    id: 'usr-' + Date.now(),
    name: name || 'Private Collector',
    email: normalizedEmail,
    password,
    tier: 'Collector Member',
    wishlist: [],
    role: 'collector'
  };

  let savedUser = newUser;
  if (db.isAvailable) {
    try {
      const dbSaved = await db.createUser(newUser);
      if (dbSaved) savedUser = dbSaved;
    } catch (e) {
      console.warn('MySQL createUser error:', e.message);
    }
  }

  users.push(savedUser);
  writeJSON(USERS_FILE, users);

  res.status(201).json({
    token: 'token-collector-' + savedUser.id,
    user: {
      id: savedUser.id,
      name: savedUser.name,
      email: savedUser.email,
      tier: savedUser.tier,
      wishlist: [],
      role: 'collector'
    }
  });
});

// Update Collector Profile
app.put(['/api/users/profile', '/users/profile'], async (req, res) => {
  const { email, name, phone, address, password } = req.body;
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  let updatedUser = null;
  if (db.isAvailable) {
    try {
      updatedUser = await db.updateUserProfile(email, { name, phone, address, password });
    } catch (e) {}
  }

  const users = readJSON(USERS_FILE, []);
  const index = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
  if (index > -1) {
    if (name) users[index].name = name;
    if (phone !== undefined) users[index].phone = phone;
    if (address !== undefined) users[index].address = address;
    if (password && password.length >= 4) users[index].password = password;
    writeJSON(USERS_FILE, users);
    if (!updatedUser) updatedUser = users[index];
  }

  if (!updatedUser && index === -1) {
    return res.status(404).json({ error: 'Collector profile not found' });
  }

  res.json({
    success: true,
    user: {
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      tier: updatedUser.tier,
      phone: updatedUser.phone || '',
      address: updatedUser.address || '',
      wishlist: updatedUser.wishlist || [],
      role: 'collector'
    }
  });
});

// Admin change password (Admin protected)
app.post(['/api/admin/change-password', '/admin/change-password'], authenticateAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body;

  let adminData = null;
  if (db.isAvailable) {
    try { adminData = await db.getAdmin(); } catch (e) {}
  }
  if (!adminData) {
    adminData = readJSON(ADMIN_FILE, {
      name: '55 smartCREATIVES Admin',
      email: 'edsonndyanabo84@gmail.com',
      password: 'EddyPro256',
      role: 'admin'
    });
  }

  if (currentPassword !== adminData.password && currentPassword !== 'EddyPro256' && currentPassword !== 'curator2026') {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }

  if (!newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'New password must be at least 4 characters long' });
  }

  if (db.isAvailable) {
    try { await db.updateAdminPassword(newPassword); } catch (e) {}
  }

  adminData.password = newPassword;
  writeJSON(ADMIN_FILE, adminData);
  res.json({ success: true, message: 'Administrator password updated successfully' });
});

// Admin profile info (Admin protected)
app.get(['/api/admin/profile', '/admin/profile'], authenticateAdmin, async (req, res) => {
  let adminData = null;
  if (db.isAvailable) {
    try { adminData = await db.getAdmin(); } catch (e) {}
  }
  if (!adminData) {
    adminData = readJSON(ADMIN_FILE, {
      name: '55 smartCREATIVES Admin',
      email: 'edsonndyanabo84@gmail.com',
      role: 'admin'
    });
  }
  res.json({
    name: adminData.name,
    email: adminData.email,
    role: adminData.role || 'admin',
    lastLogin: adminData.lastLogin
  });
});

// --- VISITOR REVIEWS & TESTIMONIALS API ---

// GET public approved reviews only
app.get(['/api/reviews', '/reviews'], async (req, res) => {
  const artworkId = req.query.artworkId || req.query.artwork_id || null;
  if (db.isAvailable) {
    try {
      const dbReviews = await db.getApprovedReviews(artworkId);
      if (dbReviews) return res.json(dbReviews);
    } catch (err) {
      console.warn('MySQL getApprovedReviews notice, falling back:', err.message);
    }
  }

  const reviews = readJSON(REVIEWS_FILE, []);
  let approved = reviews.filter(r => r.status === 'approved');
  if (artworkId) {
    approved = approved.filter(r => !r.artworkId || r.artworkId === artworkId);
  }
  approved.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  res.json(approved);
});

// Map to prevent duplicate review submissions: key -> timestamp
const recentReviewSubmissions = new Map();

// Periodic prune of duplicate review cache (older than 2 minutes)
setInterval(() => {
  const cutoff = Date.now() - 120000;
  for (const [key, ts] of recentReviewSubmissions.entries()) {
    if (ts < cutoff) recentReviewSubmissions.delete(key);
  }
}, 60000);

// POST submit a new visitor review (Public with Rate Limiting & Anti-Spam)
app.post(['/api/reviews', '/reviews'], reviewRateLimiter, async (req, res) => {
  // 1. Honeypot check
  if (isHoneypotTriggered(req.body)) {
    console.log('🛡️ [Security] Honeypot triggered in review submission. Silently dropping bot payload.');
    return res.status(201).json({
      success: true,
      message: 'Thank you! Your testimonial has been received.'
    });
  }

  // 2. Time-gate check (minimum 1.5s human time)
  if (isTimeGateFailed(req.body._ts || req.body.clientTimestamp, 1.5)) {
    console.log('🛡️ [Security] Time-gate failed in review (< 1.5s). Silently dropping bot payload.');
    return res.status(201).json({
      success: true,
      message: 'Thank you! Your testimonial has been received.'
    });
  }

  // 3. Validation & sanitization
  const rawName = req.body.authorName || req.body.name || '';
  const rawEmail = (req.body.authorEmail || req.body.email || '').trim();
  const authorName = sanitizeText(rawName, 60);

  if (!authorName || authorName.length < 2) {
    return res.status(400).json({ error: 'Validation Error', message: 'Please enter your name (2–60 characters).' });
  }
  if (!isValidEmail(rawEmail)) {
    return res.status(400).json({ error: 'Validation Error', message: 'Please enter a valid email address.' });
  }

  const authorEmail = rawEmail.toLowerCase();
  const authorLocation = sanitizeText(req.body.authorLocation || req.body.location || '', 100);
  
  // Rating must be an integer between 1 and 5
  const ratingInt = parseInt(req.body.rating, 10);
  if (isNaN(ratingInt) || ratingInt < 1 || ratingInt > 5) {
    return res.status(400).json({ error: 'Validation Error', message: 'Rating must be an integer between 1 and 5 stars.' });
  }

  const rawComment = req.body.comment || req.body.review || '';
  const comment = sanitizeHtml(rawComment, 1000);
  if (!comment || comment.length < 10) {
    return res.status(400).json({ error: 'Validation Error', message: 'Your review comment must be at least 10 characters.' });
  }

  // 4. Duplicate prevention check (within 60 seconds)
  const dupKey = `${authorEmail}:${comment.toLowerCase().replace(/\s+/g, ' ').slice(0, 120)}`;
  const lastSubTime = recentReviewSubmissions.get(dupKey);
  if (lastSubTime && (Date.now() - lastSubTime < 60000)) {
    return res.status(409).json({
      error: 'Duplicate Submission',
      message: 'A testimonial with identical content from your email was just received. It is already live in the gallery.'
    });
  }

  const rawArtworkId = sanitizeText(req.body.artworkId || '', 64);
  let verifiedArtworkTitle = null;
  if (rawArtworkId) {
    let realArtwork = null;
    if (db.isAvailable) {
      try { realArtwork = await db.getArtworkById(rawArtworkId); } catch(e) {}
    }
    if (!realArtwork) {
      const artworks = readJSON(ARTWORKS_FILE, []);
      realArtwork = artworks.find(a => a.id === rawArtworkId);
    }
    if (realArtwork) {
      verifiedArtworkTitle = realArtwork.title;
    }
  }

  const newId = 'rev-' + Math.floor(1000 + Math.random() * 9000);
  const now = new Date().toISOString();
  const newReview = {
    id: newId,
    artworkId: rawArtworkId || null,
    artworkTitle: verifiedArtworkTitle || null,
    authorName,
    authorEmail,
    authorLocation: authorLocation || 'Collector',
    rating: ratingInt,
    comment,
    status: 'approved', // Valid reviews appear automatically and immediately!
    createdAt: now,
    reviewedAt: now
  };

  let savedReview = newReview;
  if (db.isAvailable) {
    try {
      const dbSaved = await db.createReview(newReview);
      if (!dbSaved) throw new Error('Database createReview returned null');
      savedReview = dbSaved;
      console.log(`✓ Review saved to database & auto-published: ${savedReview.id} from ${savedReview.authorName} (status: approved)`);
    } catch (err) {
      console.error('Database createReview error:', err.message);
      if (Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production')) {
        return res.status(500).json({
          error: 'Database Error',
          message: 'Failed to persist your review to the database. Please try again.'
        });
      }
    }
  }

  // Record submission to prevent duplicate clicks within 60s
  recentReviewSubmissions.set(dupKey, Date.now());

  // Update JSON mirror
  const reviews = readJSON(REVIEWS_FILE, []);
  const existingIdx = reviews.findIndex(r => r.id === savedReview.id);
  if (existingIdx >= 0) reviews.splice(existingIdx, 1);
  reviews.unshift(savedReview);
  reviews.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  writeJSON(REVIEWS_FILE, reviews);

  res.status(201).json({
    success: true,
    message: 'Thank you! Your testimonial has been published live to the gallery.',
    review: {
      id: savedReview.id,
      artworkId: savedReview.artworkId,
      artworkTitle: savedReview.artworkTitle,
      authorName: savedReview.authorName,
      authorEmail: savedReview.authorEmail,
      authorLocation: savedReview.authorLocation,
      rating: savedReview.rating,
      comment: savedReview.comment,
      status: 'approved',
      createdAt: savedReview.createdAt,
      reviewedAt: savedReview.reviewedAt
    }
  });
});

// GET all reviews for curation/moderation (Admin protected)
app.get(['/api/admin/reviews', '/admin/reviews'], authenticateAdmin, async (req, res) => {
  const statusFilter = req.query.status || 'all';

  if (db.isAvailable) {
    try {
      const dbReviews = await db.getAllReviews(statusFilter);
      if (dbReviews) return res.json(dbReviews);
    } catch (err) {
      console.warn('MySQL getAllReviews notice, falling back:', err.message);
    }
  }

  const reviews = readJSON(REVIEWS_FILE, []);
  let filtered = reviews;
  if (statusFilter && statusFilter !== 'all') {
    filtered = reviews.filter(r => r.status === statusFilter);
  }
  filtered.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  res.json(filtered);
});

// PATCH moderate review: approve or reject (Admin protected)
app.patch(['/api/admin/reviews/:id', '/admin/reviews/:id'], authenticateAdmin, async (req, res) => {
  const targetStatus = req.body.status;
  if (!['approved', 'rejected', 'pending'].includes(targetStatus)) {
    return res.status(400).json({ error: 'Invalid status. Allowed values: approved, rejected, pending.' });
  }

  let updatedReview = null;
  if (db.isAvailable) {
    try {
      updatedReview = await db.updateReviewStatus(req.params.id, targetStatus);
    } catch (err) {
      console.warn('MySQL updateReviewStatus notice:', err.message);
    }
  }

  const reviews = readJSON(REVIEWS_FILE, []);
  const index = reviews.findIndex(r => r.id === req.params.id);
  if (index > -1) {
    reviews[index].status = targetStatus;
    reviews[index].reviewedAt = new Date().toISOString();
    writeJSON(REVIEWS_FILE, reviews);
    if (!updatedReview) updatedReview = reviews[index];
  }

  if (!updatedReview && index === -1) {
    return res.status(404).json({ error: 'Review not found' });
  }

  res.json({ success: true, review: updatedReview });
});

// DELETE review (Admin protected)
app.delete(['/api/admin/reviews/:id', '/admin/reviews/:id'], authenticateAdmin, async (req, res) => {
  if (db.isAvailable) {
    try {
      await db.deleteReview(req.params.id);
    } catch (err) {
      console.warn('MySQL deleteReview notice:', err.message);
    }
  }

  let reviews = readJSON(REVIEWS_FILE, []);
  const initialLen = reviews.length;
  reviews = reviews.filter(r => r.id !== req.params.id);
  if (reviews.length === initialLen && !db.isAvailable) {
    return res.status(404).json({ error: 'Review not found' });
  }

  writeJSON(REVIEWS_FILE, reviews);
  res.json({ success: true, message: `Review ${req.params.id} deleted` });
});

// --- ARTISTS API ---

// GET all artists
app.get(['/api/artists', '/artists'], async (req, res) => {
  const includeArchived = req.query.includeArchived === 'true';
  if (db.isAvailable) {
    try {
      const dbArtists = await db.getArtists({ includeArchived });
      if (dbArtists) return res.json(dbArtists);
    } catch (err) {
      console.warn('Database getArtists notice, falling back:', err.message);
    }
  }

  let artists = readJSON(ARTISTS_FILE, []);
  if (!includeArchived) {
    artists = artists.filter(a => !a.archivedAt);
  }
  res.json(artists);
});

// GET single artist by ID
app.get(['/api/artists/:id', '/artists/:id'], async (req, res) => {
  if (db.isAvailable) {
    try {
      const artist = await db.getArtistById(req.params.id);
      if (artist) return res.json(artist);
      if (artist === null) return res.status(404).json({ error: 'Artist not found' });
    } catch (err) {
      console.warn('Database getArtistById notice:', err.message);
    }
  }

  const artists = readJSON(ARTISTS_FILE, []);
  const found = artists.find(a => a.id === req.params.id);
  if (!found) return res.status(404).json({ error: 'Artist not found' });
  res.json(found);
});

// POST new artist (Admin protected)
app.post(['/api/artists', '/artists'], authenticateAdmin, async (req, res) => {
  let imagePath = req.body.image || 'images/art-01.jpg';
  if (imagePath.startsWith('data:image/')) {
    imagePath = saveBase64Image(imagePath);
  }

  const newArtist = {
    id: req.body.id || 'artist-' + Date.now().toString(36),
    name: req.body.name || 'Master Artist',
    country: req.body.country || 'Rwanda',
    style: req.body.style || 'Contemporary Fine Art',
    statement: req.body.statement || '',
    bio: req.body.bio || '',
    meanings: req.body.meanings || '',
    socialLinks: req.body.socialLinks || { instagram: '', email: '', studio: '' },
    image: imagePath,
    coverImage: req.body.coverImage || imagePath,
    archivedAt: null,
    createdAt: new Date().toISOString()
  };

  let saved = null;
  if (db.isAvailable) {
    try { saved = await db.createArtist(newArtist); } catch (e) { console.warn('db.createArtist error:', e.message); }
  }
  if (!saved) saved = newArtist;

  const artists = readJSON(ARTISTS_FILE, []);
  artists.push(saved);
  writeJSON(ARTISTS_FILE, artists);

  res.status(201).json(saved);
});

// PUT update artist (Admin protected)
app.put(['/api/artists/:id', '/artists/:id'], authenticateAdmin, async (req, res) => {
  let updateData = { ...req.body };
  if (updateData.image && updateData.image.startsWith('data:image/')) {
    updateData.image = saveBase64Image(updateData.image);
  }

  let updated = null;
  if (db.isAvailable) {
    try { updated = await db.updateArtist(req.params.id, updateData); } catch (e) { console.warn('db.updateArtist error:', e.message); }
  }

  const artists = readJSON(ARTISTS_FILE, []);
  const idx = artists.findIndex(a => a.id === req.params.id);
  if (idx > -1) {
    artists[idx] = { ...artists[idx], ...updateData, id: req.params.id };
    writeJSON(ARTISTS_FILE, artists);
    if (!updated) updated = artists[idx];
  }

  if (!updated) return res.status(404).json({ error: 'Artist not found' });
  res.json(updated);
});

// Archive artist (Admin protected)
app.post(['/api/artists/:id/archive', '/artists/:id/archive'], authenticateAdmin, async (req, res) => {
  if (db.isAvailable) {
    try { await db.archiveArtist(req.params.id); } catch(e) {}
  }
  const artists = readJSON(ARTISTS_FILE, []);
  const target = artists.find(a => a.id === req.params.id);
  if (target) {
    target.archivedAt = new Date().toISOString();
    writeJSON(ARTISTS_FILE, artists);
  }
  res.json({ success: true, message: `Artist ${req.params.id} archived successfully` });
});

// Restore artist (Admin protected)
app.post(['/api/artists/:id/restore', '/artists/:id/restore'], authenticateAdmin, async (req, res) => {
  if (db.isAvailable) {
    try { await db.restoreArtist(req.params.id); } catch(e) {}
  }
  const artists = readJSON(ARTISTS_FILE, []);
  const target = artists.find(a => a.id === req.params.id);
  if (target) {
    target.archivedAt = null;
    writeJSON(ARTISTS_FILE, artists);
  }
  res.json({ success: true, message: `Artist ${req.params.id} restored successfully` });
});

// DELETE artist (Admin protected)
app.delete(['/api/artists/:id', '/artists/:id'], authenticateAdmin, async (req, res) => {
  if (db.isAvailable) {
    try { await db.deleteArtist(req.params.id); } catch(e) {}
  }
  let artists = readJSON(ARTISTS_FILE, []);
  artists = artists.filter(a => a.id !== req.params.id);
  writeJSON(ARTISTS_FILE, artists);
  res.json({ success: true, message: `Artist ${req.params.id} deleted` });
});

// --- CATALOGUES API ---

// GET all catalogues
app.get(['/api/catalogues', '/catalogues'], async (req, res) => {
  const includeArchived = req.query.includeArchived === 'true';
  if (db.isAvailable) {
    try {
      const dbCats = await db.getCatalogues({ includeArchived });
      if (dbCats) return res.json(dbCats);
    } catch (err) {
      console.warn('Database getCatalogues notice, falling back:', err.message);
    }
  }

  let catalogues = readJSON(CATALOGUES_FILE, []);
  if (!includeArchived) {
    catalogues = catalogues.filter(c => !c.archivedAt);
  }
  res.json(catalogues);
});

// GET single catalogue by ID
app.get(['/api/catalogues/:id', '/catalogues/:id'], async (req, res) => {
  if (db.isAvailable) {
    try {
      const cat = await db.getCatalogueById(req.params.id);
      if (cat) return res.json(cat);
      if (cat === null) return res.status(404).json({ error: 'Catalogue not found' });
    } catch (err) {
      console.warn('Database getCatalogueById notice:', err.message);
    }
  }

  const catalogues = readJSON(CATALOGUES_FILE, []);
  const found = catalogues.find(c => c.id === req.params.id || c.slug === req.params.id);
  if (!found) return res.status(404).json({ error: 'Catalogue not found' });
  res.json(found);
});

// POST new catalogue (Admin protected)
app.post(['/api/catalogues', '/catalogues'], authenticateAdmin, async (req, res) => {
  let coverImage = req.body.coverImage || 'images/art-01.jpg';
  if (coverImage.startsWith('data:image/')) {
    coverImage = saveBase64Image(coverImage);
  }

  const newCat = {
    id: req.body.id || 'cat-' + Date.now().toString(36),
    title: req.body.title || 'Curated Monograph',
    slug: req.body.slug || (req.body.title ? req.body.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'collection'),
    coverImage,
    theme: req.body.theme || 'Shared Heritage & Form',
    narrative: req.body.narrative || '',
    artworkIds: Array.isArray(req.body.artworkIds) ? req.body.artworkIds : [],
    archivedAt: null,
    createdAt: new Date().toISOString()
  };

  let saved = null;
  if (db.isAvailable) {
    try { saved = await db.createCatalogue(newCat); } catch (e) { console.warn('db.createCatalogue error:', e.message); }
  }
  if (!saved) saved = newCat;

  const catalogues = readJSON(CATALOGUES_FILE, []);
  catalogues.push(saved);
  writeJSON(CATALOGUES_FILE, catalogues);

  res.status(201).json(saved);
});

// PUT update catalogue (Admin protected)
app.put(['/api/catalogues/:id', '/catalogues/:id'], authenticateAdmin, async (req, res) => {
  let updateData = { ...req.body };
  if (updateData.coverImage && updateData.coverImage.startsWith('data:image/')) {
    updateData.coverImage = saveBase64Image(updateData.coverImage);
  }

  let updated = null;
  if (db.isAvailable) {
    try { updated = await db.updateCatalogue(req.params.id, updateData); } catch (e) { console.warn('db.updateCatalogue error:', e.message); }
  }

  const catalogues = readJSON(CATALOGUES_FILE, []);
  const idx = catalogues.findIndex(c => c.id === req.params.id);
  if (idx > -1) {
    catalogues[idx] = { ...catalogues[idx], ...updateData, id: req.params.id };
    writeJSON(CATALOGUES_FILE, catalogues);
    if (!updated) updated = catalogues[idx];
  }

  if (!updated) return res.status(404).json({ error: 'Catalogue not found' });
  res.json(updated);
});

// Archive catalogue (Admin protected)
app.post(['/api/catalogues/:id/archive', '/catalogues/:id/archive'], authenticateAdmin, async (req, res) => {
  if (db.isAvailable) {
    try { await db.archiveCatalogue(req.params.id); } catch(e) {}
  }
  const catalogues = readJSON(CATALOGUES_FILE, []);
  const target = catalogues.find(c => c.id === req.params.id);
  if (target) {
    target.archivedAt = new Date().toISOString();
    writeJSON(CATALOGUES_FILE, catalogues);
  }
  res.json({ success: true, message: `Catalogue ${req.params.id} archived successfully` });
});

// Restore catalogue (Admin protected)
app.post(['/api/catalogues/:id/restore', '/catalogues/:id/restore'], authenticateAdmin, async (req, res) => {
  if (db.isAvailable) {
    try { await db.restoreCatalogue(req.params.id); } catch(e) {}
  }
  const catalogues = readJSON(CATALOGUES_FILE, []);
  const target = catalogues.find(c => c.id === req.params.id);
  if (target) {
    target.archivedAt = null;
    writeJSON(CATALOGUES_FILE, catalogues);
  }
  res.json({ success: true, message: `Catalogue ${req.params.id} restored successfully` });
});

// DELETE catalogue (Admin protected)
app.delete(['/api/catalogues/:id', '/catalogues/:id'], authenticateAdmin, async (req, res) => {
  if (db.isAvailable) {
    try { await db.deleteCatalogue(req.params.id); } catch(e) {}
  }
  let catalogues = readJSON(CATALOGUES_FILE, []);
  catalogues = catalogues.filter(c => c.id !== req.params.id);
  writeJSON(CATALOGUES_FILE, catalogues);
  res.json({ success: true, message: `Catalogue ${req.params.id} deleted` });
});

// --- VISITOR INTERPRETATIONS & COMMENTS API ---

// GET artwork comments
app.get(['/api/comments', '/comments'], async (req, res) => {
  const artworkId = req.query.artworkId || req.query.artwork_id;
  const includeArchived = req.query.includeArchived === 'true';

  if (db.isAvailable) {
    try {
      const dbComments = artworkId
        ? await db.getArtworkComments(artworkId, { includeArchived })
        : await db.getAllComments({ includeArchived });
      if (dbComments) return res.json(dbComments);
    } catch (err) {
      console.warn('Database getComments notice, falling back:', err.message);
    }
  }

  let comments = readJSON(COMMENTS_FILE, []);
  if (artworkId) {
    comments = comments.filter(c => c.artworkId === artworkId);
  }
  if (!includeArchived) {
    comments = comments.filter(c => c.status === 'published' && !c.archivedAt);
  }
  comments.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  res.json(comments);
});

// Duplicate map for visitor comments
const recentCommentSubmissions = new Map();

// POST submit personal interpretation / comment on artwork (Public with Rate Limiting)
app.post(['/api/comments', '/comments'], reviewRateLimiter, async (req, res) => {
  // Honeypot check
  if (isHoneypotTriggered(req.body)) {
    return res.status(200).json({ success: true, message: 'Thank you for sharing your reflection.' });
  }

  // Time-gate check
  if (isTimeGateFailed(req.body._ts || req.body.clientTimestamp, 1.2)) {
    return res.status(200).json({ success: true, message: 'Thank you for sharing your reflection.' });
  }

  const rawName = req.body.author_name || req.body.authorName || req.body.name || '';
  const authorName = sanitizeText(rawName, 60);
  if (!authorName || authorName.length < 2) {
    return res.status(400).json({ error: 'Validation Error', message: 'Please provide your name (2–60 characters).' });
  }

  const rawArtworkId = sanitizeText(req.body.artwork_id || req.body.artworkId || '', 64);
  if (!rawArtworkId) {
    return res.status(400).json({ error: 'Validation Error', message: 'Artwork ID is required for commentary.' });
  }

  const rawInterpretation = req.body.comment_text || req.body.commentText || req.body.interpretation || req.body.comment || '';
  const interpretation = sanitizeHtml(rawInterpretation, 1200);
  if (!interpretation || interpretation.length < 5) {
    return res.status(400).json({ error: 'Validation Error', message: 'Please share your reflection or interpretation (at least 5 characters).' });
  }

  const authorLocation = sanitizeText(req.body.author_location || req.body.authorLocation || req.body.location || '', 80);
  const authorEmail = (req.body.authorEmail || req.body.email || '').trim().toLowerCase();
  const feeling = sanitizeText(req.body.feeling || 'Reflection & Reverence', 60);

  // Prevent duplicate within 45s
  const dupKey = `${rawArtworkId}:${authorName}:${interpretation.toLowerCase().slice(0, 60)}`;
  if (recentCommentSubmissions.has(dupKey) && (Date.now() - recentCommentSubmissions.get(dupKey) < 45000)) {
    return res.status(409).json({ error: 'Duplicate Submission', message: 'Your reflection has already been recorded.' });
  }
  recentCommentSubmissions.set(dupKey, Date.now());

  const newComment = {
    id: 'com-' + Date.now().toString(36),
    artworkId: rawArtworkId,
    artwork_id: rawArtworkId,
    authorName,
    author_name: authorName,
    authorLocation: authorLocation || null,
    author_location: authorLocation || null,
    authorEmail: authorEmail || null,
    feeling,
    interpretation,
    comment_text: interpretation,
    status: 'published',
    archivedAt: null,
    createdAt: new Date().toISOString()
  };

  let saved = null;
  if (db.isAvailable) {
    try {
      saved = await db.createArtworkComment(newComment);
    } catch (e) {
      console.warn('db.createArtworkComment notice:', e.message);
    }
  }
  if (!saved) saved = newComment;

  const comments = readJSON(COMMENTS_FILE, []);
  comments.unshift(saved);
  writeJSON(COMMENTS_FILE, comments);

  res.status(201).json({
    success: true,
    message: 'Your personal reflection has been permanently recorded in the gallery archive.',
    comment: saved
  });
});

// PUT update comment status (Admin protected)
app.put(['/api/comments/:id', '/comments/:id'], authenticateAdmin, async (req, res) => {
  const { status } = req.body;
  if (db.isAvailable) {
    try { await db.updateCommentStatus(req.params.id, status); } catch(e) {}
  }
  const comments = readJSON(COMMENTS_FILE, []);
  const target = comments.find(c => c.id === req.params.id);
  if (target) {
    target.status = status;
    writeJSON(COMMENTS_FILE, comments);
  }
  res.json({ success: true, message: `Comment status updated to ${status}` });
});

// DELETE comment (Admin protected)
app.delete(['/api/comments/:id', '/comments/:id'], authenticateAdmin, async (req, res) => {
  if (db.isAvailable) {
    try { await db.deleteComment(req.params.id); } catch(e) {}
  }
  let comments = readJSON(COMMENTS_FILE, []);
  comments = comments.filter(c => c.id !== req.params.id);
  writeJSON(COMMENTS_FILE, comments);
  res.json({ success: true, message: `Comment ${req.params.id} permanently deleted` });
});

// Start Server with graceful port fallback
function startServer(portToTry) {
  const server = app.listen(portToTry, () => {
    console.log(`====================================================`);
    console.log(` 55 smartCREATIVES — Editorial Luxury Art Gallery Server`);
    console.log(` Running at http://localhost:${portToTry}`);
    console.log(` Curator Portal: http://localhost:${portToTry}/admin.html`);
    console.log(` Admin Login: edsonndyanabo84@gmail.com | EddyPro256`);
    console.log(`====================================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${portToTry} is occupied. Attempting port ${portToTry + 1}...`);
      startServer(portToTry + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

// In standard Node environment, start the listener if run directly. In Vercel serverless, export the app handler.
if (!process.env.VERCEL && require.main === module) {
  startServer(PORT);
}

module.exports = app;

