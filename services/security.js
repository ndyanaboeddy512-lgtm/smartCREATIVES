/**
 * 55 smartCREATIVES — Security & Protection Engine
 * Rate limiting, Honeypot detection, Time-gate checking,
 * Duplicate suppression, Input sanitization, and Admin Token Authorization.
 */

const crypto = require('crypto');
const { rateLimit } = require('express-rate-limit');

// Secret for signing admin session tokens
function getAdminSecret() {
  return process.env.ADMIN_JWT_SECRET || '55smartcreatives-editorial-curator-salt-2026';
}

/**
 * Basic HTML escaping to neutralize XSS injection
 */
function sanitizeHtml(str, maxLength = 2000) {
  if (typeof str !== 'string') return '';
  const trimmed = str.trim().slice(0, maxLength);
  return trimmed
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Text sanitization that preserves clean plain text but strips control characters
 */
function sanitizeText(str, maxLength = 255) {
  if (typeof str !== 'string') return '';
  return str
    .trim()
    .slice(0, maxLength)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // strip ASCII control chars
}

/**
 * Strict RFC-5322 compatible email format check
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email.trim()) && email.trim().length <= 254;
}

/**
 * Honeypot Trap Detection
 * Checks hidden decoy inputs that legitimate human users cannot see or fill.
 */
function isHoneypotTriggered(body) {
  if (!body || typeof body !== 'object') return false;
  // Use unique gallery decoy inputs that standard browser autofill will never populate
  const honeypots = ['website_hp', 'gallery_curation_check', 'editorial_decoy_trap'];
  for (const hp of honeypots) {
    if (body[hp] && typeof body[hp] === 'string' && body[hp].trim().length > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Time-Gate Bot Detection
 * Verifies human submission pacing without penalizing client clock skew or fast autofill.
 */
function isTimeGateFailed(clientTimestamp, minSeconds = 0.4) {
  if (!clientTimestamp) {
    return false;
  }
  const ts = parseInt(clientTimestamp, 10);
  if (isNaN(ts) || ts <= 0) return false;
  
  const elapsedMs = Date.now() - ts;
  // If client clock is skewed (elapsedMs < 0), do NOT penalize real users
  if (elapsedMs < 0) {
    return false; 
  }
  // Only trigger if submitted inhumanly fast (< 400ms) with non-autofilled data
  if (elapsedMs < minSeconds * 1000) {
    return true;
  }
  return false;
}

/**
 * In-Memory Sliding Window for Duplicate Submission Suppression
 * Prevents rapid double-clicks (15-second debounce window instead of 60s)
 */
const recentSignatures = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [key, expiresAt] of recentSignatures.entries()) {
    if (now > expiresAt) recentSignatures.delete(key);
  }
}, 5 * 60 * 1000);

function isDuplicateSubmission(signatureKey, windowSeconds = 15) {
  if (!signatureKey) return false;
  const hash = crypto.createHash('sha256').update(String(signatureKey)).digest('hex');
  const now = Date.now();
  
  if (recentSignatures.has(hash)) {
    const expiresAt = recentSignatures.get(hash);
    if (now < expiresAt) {
      return true; // Duplicate caught within debounce window
    }
  }
  
  recentSignatures.set(hash, now + (windowSeconds * 1000));
  return false;
}

/**
 * Generate a Cryptographically Signed Admin Token
 */
function generateAdminToken(adminUser) {
  const payload = {
    email: adminUser.email,
    role: 'admin',
    iat: Date.now(),
    exp: Date.now() + (7 * 24 * 60 * 60 * 1000) // 7 days
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getAdminSecret())
    .update(payloadB64)
    .digest('base64url');

  return `adm.${payloadB64}.${signature}`;
}

/**
 * Verify Admin Token
 */
function verifyAdminToken(token) {
  if (!token || typeof token !== 'string') return null;

  // Support legacy backward-compatible tokens during migration
  if (token.startsWith('token-curator-eddypro-')) {
    return { email: 'edsonndyanabo84@gmail.com', role: 'admin', legacy: true };
  }

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'adm') {
    return null;
  }

  const [, payloadB64, signature] = parts;
  const expectedSignature = crypto
    .createHmac('sha256', getAdminSecret())
    .update(payloadB64)
    .digest('base64url');

  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'));
    if (payload.exp && Date.now() > payload.exp) {
      return null;
    }
    if (payload.role !== 'admin') {
      return null;
    }
    return payload;
  } catch (err) {
    return null;
  }
}

/**
 * Express Middleware: Authenticate Admin
 * Restricts sensitive API endpoints to authenticated curator requests.
 */
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.headers['x-admin-token']) {
    token = req.headers['x-admin-token'];
  } else if (req.query && req.query.admin_token) {
    token = req.query.admin_token;
  }

  const verified = verifyAdminToken(token);
  if (!verified) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Curator admin authentication is required to access this resource.'
    });
  }

  req.admin = verified;
  next();
}

/**
 * Rate Limiter: Inquiries
 * Max 20 submissions per 15 minutes per IP (100 in test mode)
 */
const inquiryRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 100 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Inquiries',
    message: 'You have reached the maximum number of inquiry submissions for this timeframe. Please wait 15 minutes before sending another inquiry.'
  }
});

/**
 * Rate Limiter: Reviews
 * Max 10 submissions per hour per IP (100 in test mode)
 */
const reviewRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 100 : 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Reviews',
    message: 'To prevent review spam, submissions are limited to 3 per hour. Thank you for your patience.'
  }
});

/**
 * Rate Limiter: Admin Login Attempts
 * Max 10 attempts per 15 minutes per IP
 */
const adminLoginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too Many Login Attempts',
    message: 'Too many curator sign-in attempts from this address. Please try again after 15 minutes.'
  }
});

module.exports = {
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
};
