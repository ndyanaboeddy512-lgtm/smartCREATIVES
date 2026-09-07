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
    console.error('Error saving image to disk:', err);
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

// Health check & Environment Audit
app.get(['/api/health', '/health'], async (req, res) => {
  const pool = await db.getPool();
  const hasEmail = Boolean(
    process.env.RESEND_API_KEY || 
    (process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD) || 
    process.env.SENDGRID_API_KEY
  );

  const envAudit = {
    DATABASE_URL: db.isAvailable ? 'connected' : (process.env.DATABASE_URL ? 'configured_but_unreachable' : 'missing'),
    RESEND_API_KEY: Boolean(process.env.RESEND_API_KEY && !process.env.RESEND_API_KEY.includes('your_resend')) ? 'configured' : 'missing',
    RESEND_VERIFIED: Boolean(process.env.RESEND_VERIFIED === 'true') ? 'enabled' : 'disabled',
    EMAIL_FROM: Boolean(process.env.EMAIL_FROM && !process.env.EMAIL_FROM.includes('@resend.dev')) ? 'verified_domain' : 'default_sandbox',
    ADMIN_EMAIL: Boolean(process.env.ADMIN_EMAIL) ? 'configured' : 'default',
    MAKE_INQUIRY_WEBHOOK_URL: Boolean(process.env.MAKE_INQUIRY_WEBHOOK_URL && !process.env.MAKE_INQUIRY_WEBHOOK_URL.includes('your_make')) ? 'configured' : 'missing',
    MAKE_WEBHOOK_SECRET: Boolean(process.env.MAKE_WEBHOOK_SECRET) ? 'configured' : 'missing',
    SITE_URL: Boolean(process.env.SITE_URL) ? 'configured' : 'default'
  };

  res.json({
    status: 'ok',
    gallery: '55 smartCREATIVES — Editorial Fine Art',
    database: db.isAvailable ? 'mysql' : 'unavailable',
    siteUrl: SITE_URL,
    emailService: hasEmail ? 'configured' : 'simulated',
    emailProvider: process.env.RESEND_API_KEY ? 'resend' : (process.env.GMAIL_USER ? 'gmail_smtp' : (process.env.SENDGRID_API_KEY ? 'sendgrid' : 'simulated')),
    makeWebhook: envAudit.MAKE_INQUIRY_WEBHOOK_URL === 'configured' ? 'configured' : 'unconfigured',
    adminEmail: getAdminEmail(),
    environmentAudit: envAudit,
    timestamp: new Date().toISOString()
  });
});


// GET all artworks
app.get(['/api/artworks', '/artworks'], async (req, res) => {
  if (db.isAvailable) {
    try {
      const artworks = await db.getArtworks();
      if (artworks && artworks.length > 0) return res.json(artworks);
    } catch (err) {
      console.warn('MySQL getArtworks notice, falling back:', err.message);
    }
  }
  const artworks = readJSON(ARTWORKS_FILE);
  res.json(artworks);
});

// GET single artwork by ID
app.get(['/api/artworks/:id', '/artworks/:id'], async (req, res) => {
  if (db.isAvailable) {
    try {
      const artwork = await db.getArtworkById(req.params.id);
      if (artwork) return res.json(artwork);
    } catch (err) {
      console.warn('MySQL getArtworkById notice, falling back:', err.message);
    }
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

// POST new artwork (Admin protected)
app.post(['/api/artworks', '/artworks'], authenticateAdmin, async (req, res) => {
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
    featured: Boolean(req.body.featured),
    image: imagePath,
    highResZoom: req.body.highResZoom || imagePath
  };

  let savedArtwork = newArtwork;
  if (db.isAvailable) {
    try {
      const dbSaved = await db.createArtwork(newArtwork);
      if (dbSaved) savedArtwork = dbSaved;
    } catch (err) {
      console.warn('MySQL createArtwork notice:', err.message);
    }
  }

  const artworks = readJSON(ARTWORKS_FILE);
  if (newArtwork.featured) {
    artworks.forEach(a => { a.featured = false; });
  }
  artworks.unshift(savedArtwork);
  writeJSON(ARTWORKS_FILE, artworks);

  res.status(201).json(savedArtwork);
});

// PUT update artwork (Admin protected)
app.put(['/api/artworks/:id', '/artworks/:id'], authenticateAdmin, async (req, res) => {
  let updateData = { ...req.body };
  if (updateData.image && updateData.image.startsWith('data:image/')) {
    const savedPath = saveBase64Image(updateData.image);
    updateData.image = savedPath;
    updateData.highResZoom = savedPath;
  }

  let updatedArtwork = null;
  if (db.isAvailable) {
    try {
      updatedArtwork = await db.updateArtwork(req.params.id, updateData);
    } catch (err) {
      console.warn('MySQL updateArtwork notice:', err.message);
    }
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

// DELETE artwork (Admin protected)
app.delete(['/api/artworks/:id', '/artworks/:id'], authenticateAdmin, async (req, res) => {
  if (db.isAvailable) {
    try {
      await db.deleteArtwork(req.params.id);
    } catch (err) {
      console.warn('MySQL deleteArtwork notice:', err.message);
    }
  }

  let artworks = readJSON(ARTWORKS_FILE);
  const initialLength = artworks.length;
  artworks = artworks.filter(a => a.id !== req.params.id);
  
  if (artworks.length === initialLength && !db.isAvailable) {
    return res.status(404).json({ error: 'Artwork not found' });
  }

  writeJSON(ARTWORKS_FILE, artworks);
  res.json({ success: true, message: `Artwork ${req.params.id} deleted` });
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
  // 1. Decoy honeypot check (only reject if actual spam content exists)
  if (isHoneypotTriggered(req.body)) {
    const decoyVal = String(req.body.website_hp || req.body.gallery_curation_check || req.body.editorial_decoy_trap || '');
    if (decoyVal.includes('http://') || decoyVal.includes('https://') || decoyVal.length > 60) {
      console.log('🛡️ [Security] Automated spam payload detected in decoy field. Rejecting.');
      return res.status(400).json({ error: 'Spam Detected', message: 'Automated submission rejected.' });
    }
    console.warn('Notice: Decoy field contained value (possible autofill); continuing with strict validation.');
  }

  // 2. Human pacing check (log notice without silently dropping valid client inquiries)
  if (isTimeGateFailed(req.body._ts || req.body.clientTimestamp, 0.4)) {
    console.log('🛡️ [Security] Fast submission pace detected; proceeding with data verification.');
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

// POST submit a new visitor review (Public with Rate Limiting & Anti-Spam)
app.post(['/api/reviews', '/reviews'], reviewRateLimiter, async (req, res) => {
  // 1. Honeypot check
  if (isHoneypotTriggered(req.body)) {
    console.log('🛡️ [Security] Honeypot triggered in review submission. Silently dropping bot payload.');
    return res.status(201).json({
      success: true,
      message: 'Thank you for your testimonial. It has been received and will be displayed following curatorial review.'
    });
  }

  // 2. Time-gate check (minimum 1.5s human time)
  if (isTimeGateFailed(req.body._ts || req.body.clientTimestamp, 1.5)) {
    console.log('🛡️ [Security] Time-gate failed in review (< 1.5s). Silently dropping bot payload.');
    return res.status(201).json({
      success: true,
      message: 'Thank you for your testimonial. It has been received and will be displayed following curatorial review.'
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
    status: 'pending', // Unconditionally pending! Client can NEVER force approved
    createdAt: now,
    reviewedAt: null
  };

  let savedReview = newReview;
  if (db.isAvailable) {
    try {
      const dbSaved = await db.createReview(newReview);
      if (dbSaved) savedReview = dbSaved;
      console.log(`✓ Review submitted: ${savedReview.id} from ${savedReview.authorName} (status: pending)`);
    } catch (err) {
      console.warn('MySQL createReview notice:', err.message);
    }
  }

  // Update JSON mirror
  const reviews = readJSON(REVIEWS_FILE, []);
  reviews.unshift(savedReview);
  writeJSON(REVIEWS_FILE, reviews);

  res.status(201).json({
    success: true,
    message: 'Thank you for your testimonial. It has been received and will be displayed following curatorial review.',
    review: {
      id: savedReview.id,
      authorName: savedReview.authorName,
      authorLocation: savedReview.authorLocation,
      rating: savedReview.rating,
      comment: savedReview.comment,
      status: 'pending'
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

// In standard Node environment, start the listener. In Vercel serverless, export the app handler.
if (!process.env.VERCEL) {
  startServer(PORT);
}

module.exports = app;

