const http = require('http');

const PORT = 3001;
process.env.PORT = PORT;
const app = require('./server.js');

let server;

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://localhost:' + PORT);
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    if (options.body && !reqOptions.headers['Content-Type']) {
      reqOptions.headers['Content-Type'] = 'application/json';
    }

    const req = http.request(url, reqOptions, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch(e) {}
        resolve({ status: res.statusCode, headers: res.headers, data: parsed });
      });
    });

    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error('❌ FAIL: ' + message);
    process.exit(1);
  }
  console.log('✓ PASS: ' + message);
}

async function runReviewTests() {
  console.log('===============================================================');
  console.log(' STARTING REVIEWS VERIFICATION SUITE');
  console.log('===============================================================');

  await new Promise((resolve) => {
    server = app.listen(PORT, () => {
      console.log('Test server running on port ' + PORT);
      resolve();
    });
  });

  try {
    // 1. Health check
    const health = await request('/api/health');
    assert(health.status === 200, 'Health endpoint responds with 200 OK');

    // 2. Validation: Name too short (< 2 chars)
    const shortNameRes = await request('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({
        authorName: 'A',
        authorEmail: 'valid@example.com',
        rating: 5,
        comment: 'This is a long enough comment for testing.',
        _ts: Date.now() - 3000
      })
    });
    assert(shortNameRes.status === 400 && shortNameRes.data.error === 'Validation Error',
      'Validation rejects name shorter than 2 characters (400 Bad Request)');

    // 3. Validation: Invalid email
    const badEmailRes = await request('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({
        authorName: 'Valid Name',
        authorEmail: 'invalid-email-address',
        rating: 5,
        comment: 'This is a long enough comment for testing.',
        _ts: Date.now() - 3000
      })
    });
    assert(badEmailRes.status === 400,
      'Validation rejects invalid email address (400 Bad Request)');

    // 4. Validation: Invalid rating (99)
    const badRatingRes = await request('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({
        authorName: 'Valid Name',
        authorEmail: 'valid@example.com',
        rating: 99,
        comment: 'This is a long enough comment for testing.',
        _ts: Date.now() - 3000
      })
    });
    assert(badRatingRes.status === 400,
      'Validation rejects rating outside 1–5 range (400 Bad Request)');

    // 5. Validation: Comment too short (< 10 chars)
    const shortCommentRes = await request('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({
        authorName: 'Valid Name',
        authorEmail: 'valid@example.com',
        rating: 5,
        comment: 'Too short',
        _ts: Date.now() - 3000
      })
    });
    assert(shortCommentRes.status === 400,
      'Validation rejects comment shorter than 10 characters (400 Bad Request)');

    // 6. Valid Submission: Should save and auto-publish immediately with status 'approved'
    const uniqueEmail = 'test.collector.' + Date.now() + '@gallery-acquisitions.com';
    const uniqueComment = 'Masterwork fine art piece with extraordinary texture and museum lighting. Tested at ' + new Date().toISOString();
    
    const validRes = await request('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({
        authorName: 'Eleanor Vance',
        authorEmail: uniqueEmail,
        authorLocation: 'London, UK',
        rating: 5,
        comment: uniqueComment,
        _ts: Date.now() - 5000
      })
    });

    assert(validRes.status === 201, 'Valid review returns HTTP 201 Created');
    assert(validRes.data.success === true, 'Response contains success: true');
    assert(validRes.data.review && validRes.data.review.id, 'Returned review contains database ID');
    assert(validRes.data.review.status === 'approved', 'Review status is immediately "approved" (no manual approval needed)');
    const reviewId = validRes.data.review.id;

    // 7. Duplicate Submission Check (exact same email and comment within 60s)
    const dupRes = await request('/api/reviews', {
      method: 'POST',
      body: JSON.stringify({
        authorName: 'Eleanor Vance',
        authorEmail: uniqueEmail,
        authorLocation: 'London, UK',
        rating: 5,
        comment: uniqueComment,
        _ts: Date.now() - 5000
      })
    });
    assert(dupRes.status === 409, 'Duplicate submission within 60 seconds is rejected with HTTP 409 Conflict');

    // 8. Public website endpoint GET /api/reviews: Immediately shows review at top (newest first)
    const pubReviewsRes = await request('/api/reviews');
    assert(pubReviewsRes.status === 200 && Array.isArray(pubReviewsRes.data), 'GET /api/reviews returns 200 with array');
    const foundInPub = pubReviewsRes.data.find(r => r.id === reviewId);
    assert(foundInPub !== undefined, 'Newly submitted review is IMMEDIATELY available on public gallery');
    assert(foundInPub.status === 'approved', 'Public review record is approved and published');
    assert(pubReviewsRes.data[0].id === reviewId, 'Newest review appears FIRST in public catalog (newest-first ordering)');

    // 9. Admin Dashboard reviews endpoint: Immediately shows review
    const adminLoginRes = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'edsonndyanabo84@gmail.com',
        password: 'EddyPro256',
        role: 'admin'
      })
    });
    assert(adminLoginRes.status === 200 && adminLoginRes.data.token, 'Admin login succeeds and returns JWT token');
    const adminToken = adminLoginRes.data.token;

    const adminReviewsRes = await request('/api/admin/reviews', {
      headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    assert(adminReviewsRes.status === 200 && Array.isArray(adminReviewsRes.data), 'GET /api/admin/reviews returns 200');
    const foundInAdmin = adminReviewsRes.data.find(r => r.id === reviewId);
    assert(foundInAdmin !== undefined, 'Newly submitted review is IMMEDIATELY visible in Curator Dashboard');
    assert(foundInAdmin.status === 'approved', 'Curator Dashboard displays status as approved');

    // 10. Admin moderation: Unpublish / Reject works
    const unpublishRes = await request('/api/admin/reviews/' + reviewId, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + adminToken },
      body: JSON.stringify({ status: 'rejected' })
    });
    assert(unpublishRes.status === 200 && unpublishRes.data.review.status === 'rejected',
      'Curator can unpublish/reject the review if necessary');

    // Verify unpublished review is removed from public gallery
    const pubAfterUnpublish = await request('/api/reviews');
    const foundAfterUnpublish = pubAfterUnpublish.data.some(r => r.id === reviewId);
    assert(!foundAfterUnpublish, 'Unpublished review is no longer served on public gallery');

    // 11. Cleanup: Delete test review
    const delRes = await request('/api/admin/reviews/' + reviewId, {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + adminToken }
    });
    assert(delRes.status === 200, 'Test review cleanly removed from database');

    console.log('\n===============================================================');
    console.log(' 🎉 ALL REVIEW PIPELINE TESTS PASSED SUCCESSFULLY!');
    console.log('===============================================================');
    process.exit(0);
  } finally {
    if (server) {
      server.close();
    }
  }
}

runReviewTests().catch(err => {
  console.error('Fatal test error:', err);
  if (server) server.close();
  process.exit(1);
});
