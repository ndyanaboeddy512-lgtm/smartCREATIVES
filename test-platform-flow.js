/**
 * 55 smartCREATIVES — Global Platform Verification Suite
 * Tests multi-filtering, story collections, artists ateliers, visitor reflections (comments),
 * soft-delete archive/restore, and public route availability.
 */

const http = require('http');
const app = require('./server');

const TEST_PORT = 3003;
let server;

function request(options, postData = null) {
  return new Promise((resolve, reject) => {
    const defaultOptions = {
      hostname: '127.0.0.1',
      port: TEST_PORT,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    const reqOptions = { ...defaultOptions, ...options };
    if (options.headers) {
      reqOptions.headers = { ...defaultOptions.headers, ...options.headers };
    }

    const req = http.request(reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) {}
        resolve({
          status: res.statusCode,
          headers: res.headers,
          data: json !== null ? json : data
        });
      });
    });

    req.on('error', reject);
    if (postData) {
      req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function runPlatformTests() {
  console.log('===============================================================');
  console.log(' STARTING GLOBAL ART PLATFORM TEST SUITE');
  console.log(` Target: http://127.0.0.1:${TEST_PORT}`);
  console.log('===============================================================');

  server = http.createServer(app);
  await new Promise(resolve => server.listen(TEST_PORT, resolve));
  console.log(`Server listening on port ${TEST_PORT}\n`);

  let passCount = 0;
  let failCount = 0;

  function assert(condition, message) {
    if (condition) {
      console.log(`  ✓ PASS: ${message}`);
      passCount++;
    } else {
      console.error(`  ✕ FAIL: ${message}`);
      failCount++;
    }
  }

  try {
    // 1. Static Routes
    console.log('--- SECTION 1: Public Architecture & Routes ---');
    const resGallery = await request({ path: '/gallery', method: 'GET' });
    assert(resGallery.status === 200, 'GET /gallery returns 200 OK');

    const resCatalogues = await request({ path: '/catalogues', method: 'GET' });
    assert(resCatalogues.status === 200, 'GET /catalogues returns 200 OK');

    const resArtist = await request({ path: '/artist', method: 'GET' });
    assert(resArtist.status === 200, 'GET /artist returns 200 OK');

    // 2. Artists API
    console.log('\n--- SECTION 2: Master Artists & Atelier API ---');
    const resArtists = await request({ path: '/api/artists', method: 'GET' });
    assert(resArtists.status === 200, 'GET /api/artists returns 200 OK');
    assert(Array.isArray(resArtists.data) && resArtists.data.length >= 6, `GET /api/artists returns resident artists (${resArtists.data.length} found)`);
    const eddy = resArtists.data.find(a => a.name === 'Eddy');
    assert(eddy && (eddy.style.includes('Sculpture') || eddy.bio.includes('sculptor')), 'Master Artist Eddy is registered with sculpturing discipline');

    // 3. Catalogues API
    console.log('\n--- SECTION 3: Monographic Story Collections API ---');
    const resCats = await request({ path: '/api/catalogues', method: 'GET' });
    assert(resCats.status === 200, 'GET /api/catalogues returns 200 OK');
    assert(Array.isArray(resCats.data) && resCats.data.length >= 3, `GET /api/catalogues returns story collections (${resCats.data.length} found)`);
    const riftCat = resCats.data.find(c => c.id === 'cat-01');
    assert(riftCat && riftCat.title.includes('Great Rift'), 'Roots of the Great Rift collection registered with narrative');

    // 4. Multi-filter Artworks API
    console.log('\n--- SECTION 4: Multi-Filter Artworks Discovery ---');
    const resAllArtworks = await request({ path: '/api/artworks', method: 'GET' });
    assert(resAllArtworks.status === 200 && Array.isArray(resAllArtworks.data), 'GET /api/artworks returns active collection');

    const resEastAfrican = await request({ path: '/api/artworks?culture=East+African', method: 'GET' });
    assert(resEastAfrican.status === 200, 'GET /api/artworks?culture=East+African returns 200 OK');
    assert(resEastAfrican.data.every(a => a.culture === 'East African'), 'Every item in filtered response matches East African culture');

    const resEddyWorks = await request({ path: '/api/artworks?artist=Eddy', method: 'GET' });
    assert(resEddyWorks.status === 200 && resEddyWorks.data.length > 0, 'GET /api/artworks?artist=Eddy returns Eddy original masterworks');

    const resCat1Works = await request({ path: '/api/artworks?catalogueId=cat-01', method: 'GET' });
    assert(resCat1Works.status === 200 && resCat1Works.data.length > 0, 'GET /api/artworks?catalogueId=cat-01 returns member artworks');

    const resSearchWood = await request({ path: '/api/artworks?search=wood', method: 'GET' });
    assert(resSearchWood.status === 200 && resSearchWood.data.length > 0, 'GET /api/artworks?search=wood searches title, medium, and story');

    // 5. Visitor Reflections & Interpretations System
    console.log('\n--- SECTION 5: Sacred Visitor Interpretations (Comments) ---');
    // Test honeypot protection
    const spamRes = await request({
      path: '/api/comments',
      method: 'POST'
    }, {
      artwork_id: 'art-mtkeap1c',
      author_name: 'Bot Spammer',
      feeling: 'Awe',
      comment_text: 'Spam comment text here that should be rejected',
      website_hp: 'spam-bot-trap-filled'
    });
    assert(spamRes.status === 200 && spamRes.data.success === true, 'Honeypot trap silently drops bot comment submission with 200 OK');

    // Valid reflection submission
    const testCommentPayload = {
      artwork_id: 'art-mtkeap1c',
      author_name: 'Patron M. Fontaine',
      author_location: 'Kigali, Rwanda',
      feeling: 'Transcendence',
      comment_text: 'The raw cedar grain evokes centuries of ancestral silence and grounded spiritual presence.',
      _ts: Date.now() - 3000
    };

    const submitCommentRes = await request({
      path: '/api/comments',
      method: 'POST'
    }, testCommentPayload);

    assert(submitCommentRes.status === 201, 'POST /api/comments persists reflection with HTTP 201 Created');
    assert(submitCommentRes.data.comment && submitCommentRes.data.comment.id, 'Comment response contains unique database ID');
    const createdCommentId = submitCommentRes.data.comment.id;

    // Verify immediate public visibility on artwork dossier
    const getCommentsRes = await request({ path: `/api/comments?artworkId=art-mtkeap1c`, method: 'GET' });
    assert(getCommentsRes.status === 200 && Array.isArray(getCommentsRes.data), 'GET /api/comments?artworkId=... returns comments array');
    const foundComment = getCommentsRes.data.find(c => c.id === createdCommentId);
    assert(Boolean(foundComment), 'Newly submitted interpretation is IMMEDIATELY visible on artwork dossier');
    assert(foundComment && foundComment.feeling === 'Transcendence', 'Interpretation preserves selected feeling badge');

    // 6. Admin Soft-Delete Archive & Restore
    console.log('\n--- SECTION 6: Soft-Delete Archive & Restore ---');
    // Login admin to get auth token
    const loginRes = await request({ path: '/api/auth/login', method: 'POST' }, {
      email: 'edsonndyanabo84@gmail.com',
      password: 'EddyPro256',
      role: 'admin'
    });
    assert(loginRes.status === 200 && loginRes.data.token, 'Admin login generates valid Bearer token');
    const adminToken = loginRes.data.token;

    // Archive artwork
    const archiveRes = await request({
      path: '/api/artworks/art-04/archive',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(archiveRes.status === 200, 'POST /api/artworks/:id/archive archives piece with 200 OK');

    // Public catalog should now omit art-04
    const resAfterArchive = await request({ path: '/api/artworks', method: 'GET' });
    assert(!resAfterArchive.data.some(a => a.id === 'art-04'), 'Archived artwork is omitted from standard public catalog');

    // Admin catalog with includeArchived=true includes it
    const resWithArchived = await request({ path: '/api/artworks?includeArchived=true', method: 'GET' });
    const archivedPiece = resWithArchived.data.find(a => a.id === 'art-04');
    assert(archivedPiece && (archivedPiece.isArchived || archivedPiece.is_archived), 'Artwork includes is_archived = 1 flag in archive query');

    // Restore artwork
    const restoreRes = await request({
      path: '/api/artworks/art-04/restore',
      method: 'POST',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });
    assert(restoreRes.status === 200, 'POST /api/artworks/:id/restore restores piece with 200 OK');

    const resAfterRestore = await request({ path: '/api/artworks', method: 'GET' });
    assert(resAfterRestore.data.some(a => a.id === 'art-04'), 'Restored artwork is immediately visible in public catalog again');

    // Clean up test comment
    await request({
      path: `/api/comments/${createdCommentId}`,
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${adminToken}` }
    });

  } catch (err) {
    console.error('Fatal test runner error:', err);
    failCount++;
  } finally {
    server.close();
    console.log('\n===============================================================');
    console.log(` TEST SUMMARY: ${passCount} PASSED, ${failCount} FAILED`);
    console.log('===============================================================');
    process.exit(failCount === 0 ? 0 : 1);
  }
}

runPlatformTests();
