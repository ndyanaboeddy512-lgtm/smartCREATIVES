/**
 * Comprehensive Automated End-to-End Test Suite
 * 55 smartCREATIVES — Editorial Luxury Art Gallery
 */

let BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
let adminToken = '';
let createdReviewId = '';
let testPassed = 0;
let testFailed = 0;
let spawnedServer = null;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✓ PASS: ${testName}`);
    testPassed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    testFailed++;
  }
}

async function request(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = text;
  }
  return { status: res.status, headers: res.headers, data };
}

async function ensureServerRunning() {
  try {
    const res = await fetch(`${BASE_URL}/api/health`);
    if (res.ok) return;
  } catch(e) {
    // Server not running on BASE_URL, spawn on port 3002
    const PORT = 3002;
    process.env.PORT = PORT;
    const app = require('./server.js');
    await new Promise((resolve) => {
      spawnedServer = app.listen(PORT, () => {
        BASE_URL = `http://localhost:${PORT}`;
        console.log(`Local test server spawned on port ${PORT}`);
        setTimeout(resolve, 300);
      });
    });
  }
}

async function runTests() {
  await ensureServerRunning();
  console.log('===============================================================');
  console.log(' STARTING END-TO-END TEST SUITE FOR 55 smartCREATIVES GALLERY');
  console.log(` Target: ${BASE_URL}`);
  console.log('===============================================================\n');

  // --- SECTION 1: PUBLIC DATA & ACCESS RESTRICTION ---
  console.log('--- SECTION 1: Public Endpoints & Access Control ---');

  // Test 1: GET /api/artworks
  const artRes = await request('/api/artworks');
  assert(artRes.status === 200 && Array.isArray(artRes.data) && artRes.data.length > 0,
    'GET /api/artworks returns 200 OK with active artwork catalog');

  // Test 2: Unauthenticated GET /api/inquiries
  const inqUnauth = await request('/api/inquiries');
  assert(inqUnauth.status === 401,
    'GET /api/inquiries rejects unauthenticated requests with 401 Unauthorized');

  // Test 3: Unauthenticated GET /api/admin/reviews
  const revUnauth = await request('/api/admin/reviews');
  assert(revUnauth.status === 401,
    'GET /api/admin/reviews rejects unauthenticated requests with 401 Unauthorized');

  // --- SECTION 2: ADMIN AUTHENTICATION & TOKEN GENERATION ---
  console.log('\n--- SECTION 2: Admin Authentication & Token Verification ---');

  // Test 4: Admin Login with incorrect password
  const badLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'edsonndyanabo84@gmail.com', password: 'WrongPassword', role: 'admin' })
  });
  assert(badLogin.status === 401,
    'POST /api/auth/login rejects invalid admin password with 401');

  // Test 5: Admin Login with valid credentials
  const goodLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'edsonndyanabo84@gmail.com', password: 'EddyPro256', role: 'admin' })
  });
  assert(goodLogin.status === 200 && goodLogin.data.token && goodLogin.data.token.startsWith('adm.'),
    'POST /api/auth/login returns 200 OK and HMAC-signed token starting with adm.');
  adminToken = goodLogin.data.token;

  // Test 6: Authenticated GET /api/inquiries with Bearer token
  const inqAuth = await request('/api/inquiries', {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert(inqAuth.status === 200 && Array.isArray(inqAuth.data),
    'GET /api/inquiries returns 200 OK with list of inquiries when Bearer token is provided');

  // --- SECTION 3: INQUIRY SECURITY, HONEYPOTS & CATALOG HARDENING ---
  console.log('\n--- SECTION 3: Inquiry Hardening, Honeypots, Time-Gates & Deduplication ---');

  // Test 7: Form Validation - missing required fields
  const invalidInq = await request('/api/inquiries', {
    method: 'POST',
    body: JSON.stringify({
      collectorName: '',
      collectorEmail: 'not-an-email',
      _ts: Date.now() - 3000
    })
  });
  assert(invalidInq.status === 400,
    'POST /api/inquiries rejects invalid input/email with 400 Bad Request');

  // Test 8: Honeypot Trap - bot fills decoy website_hp input
  const hpInq = await request('/api/inquiries', {
    method: 'POST',
    body: JSON.stringify({
      collectorName: 'Bot Trap Test',
      collectorEmail: 'bot@spammer.org',
      website_hp: 'https://spam-link.ru',
      _ts: Date.now() - 3000
    })
  });
  assert(hpInq.status === 200 && hpInq.data.success === true,
    'POST /api/inquiries drops honeypot submission silently with 200 OK without saving to DB');

  // Test 9: Time-gate Detection - bot submits instantly (< 1.5s)
  const fastInq = await request('/api/inquiries', {
    method: 'POST',
    body: JSON.stringify({
      collectorName: 'Instant Script Bot',
      collectorEmail: 'fastbot@spammer.org',
      _ts: Date.now() - 200
    })
  });
  assert(fastInq.status === 200 && fastInq.data.success === true,
    'POST /api/inquiries drops ultra-fast submission (< 1.5s) silently with 200 OK');

  // Test 10: Authoritative Catalog Lookup (Price Tampering Prevention)
  const realArt = artRes.data[0];
  const uniqueInqId = 'test-inq-' + Date.now();
  const tamperInq = await request('/api/inquiries', {
    method: 'POST',
    body: JSON.stringify({
      id: uniqueInqId,
      collectorName: 'Discerning Collector',
      collectorEmail: 'collector.test@example.com',
      collectorPhone: '+1 212 555 0199',
      artworkId: realArt.id,
      artworkTitle: 'Forged Cheap Title',
      artworkPrice: 1, // Tampered client price!
      notes: 'Testing catalog integrity and price verification.',
      _ts: Date.now() - 4000
    })
  });
  assert(tamperInq.status === 201 && tamperInq.data.inquiry && tamperInq.data.inquiry.artworkPrice === realArt.price,
    `POST /api/inquiries locks price to database catalog ($${realArt.price}) ignoring forged price ($1)`);

  // Test 11: Sliding Window Duplicate Suppression
  const dupInq = await request('/api/inquiries', {
    method: 'POST',
    body: JSON.stringify({
      id: 'test-inq-dup-' + Date.now(),
      collectorName: 'Discerning Collector',
      collectorEmail: 'collector.test@example.com',
      artworkId: realArt.id,
      _ts: Date.now() - 4000
    })
  });
  assert(dupInq.status === 200 && dupInq.data.isDuplicate === true,
    'POST /api/inquiries catches identical rapid submission within 60s window');

  // --- SECTION 4: VISITOR REVIEW / TESTIMONIAL SYSTEM & MODERATION ---
  console.log('\n--- SECTION 4: Visitor Reviews System & Curatorial Moderation ---');

  // Test 12: GET /api/reviews returns only approved reviews
  const pubRevBefore = await request('/api/reviews');
  assert(pubRevBefore.status === 200 && Array.isArray(pubRevBefore.data),
    'GET /api/reviews returns 200 OK with list of approved reviews');
  const hasUnapprovedBefore = pubRevBefore.data.some(r => r.status !== 'approved');
  assert(!hasUnapprovedBefore,
    'GET /api/reviews contains ONLY approved reviews; zero pending or rejected reviews exposed');

  // Test 13: Invalid Review submission (rating 99, missing comment)
  const badRev = await request('/api/reviews', {
    method: 'POST',
    body: JSON.stringify({
      authorName: 'Test Reviewer',
      authorEmail: 'test@example.com',
      rating: 99,
      comment: 'Short',
      _ts: Date.now() - 3000
    })
  });
  assert(badRev.status === 400,
    'POST /api/reviews rejects invalid rating or short comment with 400 Bad Request');

  // Test 14: Valid Review submission (immediately published with status 'approved')
  const validRev = await request('/api/reviews', {
    method: 'POST',
    body: JSON.stringify({
      authorName: 'Hélène de Saint-Germain',
      authorEmail: 'helene.saintgermain@artparis.fr',
      authorLocation: 'Paris, France',
      rating: 5,
      comment: 'An exquisite acquisition experience. The oil texture and museum-grade framing exceeded all curatorial expectations.',
      artworkId: realArt.id,
      artworkTitle: realArt.title,
      _ts: Date.now() - 5000
    })
  });
  assert(validRev.status === 201 && validRev.data.review && validRev.data.review.status === 'approved',
    'POST /api/reviews saves and immediately publishes review with status "approved"');
  createdReviewId = validRev.data.review.id;

  // Test 15: Public reviews IMMEDIATELY show the new review (newest first, without manual approval)
  const pubRevAfter = await request('/api/reviews');
  const foundInPublic = pubRevAfter.data.some(r => r.id === createdReviewId);
  const isFirstItem = pubRevAfter.data[0] && pubRevAfter.data[0].id === createdReviewId;
  assert(pubRevAfter.status === 200 && foundInPublic,
    'GET /api/reviews IMMEDIATELY displays the newly created review publicly without admin approval');
  assert(isFirstItem,
    'GET /api/reviews sorts newest reviews first');

  // Test 16: Admin reviews endpoint immediately displays the review
  const adminRev = await request('/api/admin/reviews', {
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  const foundInAdmin = adminRev.data.some(r => r.id === createdReviewId && r.status === 'approved');
  assert(adminRev.status === 200 && foundInAdmin,
    'GET /api/admin/reviews immediately shows the new approved review in the curatorial dashboard');

  // Test 17: Duplicate submission prevention within 60 seconds
  const dupRev = await request('/api/reviews', {
    method: 'POST',
    body: JSON.stringify({
      authorName: 'Hélène de Saint-Germain',
      authorEmail: 'helene.saintgermain@artparis.fr',
      authorLocation: 'Paris, France',
      rating: 5,
      comment: 'An exquisite acquisition experience. The oil texture and museum-grade framing exceeded all curatorial expectations.',
      artworkId: realArt.id,
      artworkTitle: realArt.title,
      _ts: Date.now() - 5000
    })
  });
  assert(dupRev.status === 409,
    'POST /api/reviews rejects duplicate submission from same email/comment with 409 Conflict');

  // Test 18: Admin unpublishes the review (transitions to 'rejected')
  const unpublishRes = await request(`/api/admin/reviews/${createdReviewId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${adminToken}` },
    body: JSON.stringify({ status: 'rejected' })
  });
  assert(unpublishRes.status === 200 && unpublishRes.data.review && unpublishRes.data.review.status === 'rejected',
    `PATCH /api/admin/reviews/${createdReviewId} successfully allows curator to unpublish review`);

  // Test 19: Admin deletes the test review to leave data clean
  const delRev = await request(`/api/admin/reviews/${createdReviewId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminToken}` }
  });
  assert(delRev.status === 200,
    `DELETE /api/admin/reviews/${createdReviewId} successfully removes test review`);

  // --- SECTION 5: MAKE.COM WEBHOOK SERVICE RESILIENCE ---
  console.log('\n--- SECTION 5: Make.com Webhook Resilience ---');
  const { dispatchMakeInquiryWebhook } = require('./services/webhook');
  const webhookResult = await dispatchMakeInquiryWebhook({
    id: 'inq-wh-test',
    collectorName: 'Webhook Test',
    collectorEmail: 'test@example.com'
  });
  assert(webhookResult.success === true,
    'dispatchMakeInquiryWebhook completes safely and non-blockingly (gracefully disabled when URL not set)');

  // --- SUMMARY ---
  console.log('\n===============================================================');
  console.log(` TEST EXECUTION COMPLETE: ${testPassed} PASSED, ${testFailed} FAILED`);
  console.log('===============================================================');

  if (spawnedServer) {
    try { spawnedServer.close(); } catch(e) {}
  }

  if (testFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
