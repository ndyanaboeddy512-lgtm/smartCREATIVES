/**
 * 55 smartCREATIVES — Database Migration Script
 * Migrates data from JSON files into the MySQL Database.
 * Run anytime with: node scripts/migrate-to-mysql.js
 */

const fs = require('fs');
const path = require('path');

// Automatically parse .env if present
const envPath = path.join(__dirname, '..', '.env');
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

const db = require('../db');

async function migrate() {
  console.log('====================================================');
  console.log(' Starting 55 smartCREATIVES Migration to MySQL');
  console.log('====================================================');

  const pool = await db.getPool();
  if (!pool || !db.isAvailable) {
    console.error('❌ Could not connect to MySQL database. Please check your DATABASE_URL credentials or ensure MySQL is running.');
    process.exit(1);
  }

  const dataDir = path.join(__dirname, '..', 'data');

  try {
    // 1. Migrate Artworks
    const artworksFile = path.join(dataDir, 'artworks.json');
    if (fs.existsSync(artworksFile)) {
      const artworks = JSON.parse(fs.readFileSync(artworksFile, 'utf-8'));
      console.log(`\nImporting ${artworks.length} artworks...`);
      for (const a of artworks) {
        await pool.query(
          `INSERT INTO artworks (id, title, artist, year, medium, dimensions, price, status, framing, frame_options, provenance, curatorial_statement, description, shipping_details, faq_info, images, featured, image, high_res_zoom)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             title = VALUES(title),
             artist = VALUES(artist),
             price = VALUES(price),
             status = VALUES(status),
             featured = VALUES(featured),
             image = VALUES(image),
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
      console.log(`✓ Artworks migrated successfully.`);
    }

    // 2. Migrate Inquiries
    const inquiriesFile = path.join(dataDir, 'inquiries.json');
    if (fs.existsSync(inquiriesFile)) {
      const inquiries = JSON.parse(fs.readFileSync(inquiriesFile, 'utf-8'));
      console.log(`\nImporting ${inquiries.length} customer inquiries...`);
      for (const inq of inquiries) {
        const inqDate = inq.date ? new Date(inq.date) : new Date();
        await pool.query(
          `INSERT INTO inquiries (id, artwork_id, artwork_title, artwork_artist, artwork_price, artwork_image, collector_name, collector_email, collector_phone, frame_preference, notes, status, opened, is_customer_submission, date, curator_notes, generated_reply, email_delivery_result, reply_sent_at, make_webhook_status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             status = VALUES(status),
             opened = VALUES(opened),
             curator_notes = VALUES(curator_notes),
             generated_reply = COALESCE(inquiries.generated_reply, VALUES(generated_reply)),
             email_delivery_result = COALESCE(inquiries.email_delivery_result, VALUES(email_delivery_result)),
             reply_sent_at = COALESCE(inquiries.reply_sent_at, VALUES(reply_sent_at)),
             make_webhook_status = COALESCE(inquiries.make_webhook_status, VALUES(make_webhook_status))`,
          [
            inq.id, inq.artworkId || null, inq.artworkTitle || 'Acquisition Inquiry',
            inq.artworkArtist || '', inq.artworkPrice || 0, inq.artworkImage || '',
            inq.collectorName || 'Anonymous Collector', inq.collectorEmail || 'unknown@example.com',
            inq.collectorPhone || '', inq.framePreference || 'Included Framing',
            inq.notes || '', inq.status || 'Pending', inq.opened ? 1 : 0,
            inq.isCustomerSubmission !== false ? 1 : 0, inqDate, inq.curatorNotes || '',
            inq.generatedReply || null, inq.emailDeliveryResult ? JSON.stringify(inq.emailDeliveryResult) : null,
            inq.replySentAt ? new Date(inq.replySentAt) : null, inq.makeWebhookStatus || 'pending'
          ]
        );
      }
      console.log(`✓ Customer inquiries migrated successfully.`);
    }

    // 3. Migrate Users
    const usersFile = path.join(dataDir, 'users.json');
    if (fs.existsSync(usersFile)) {
      const users = JSON.parse(fs.readFileSync(usersFile, 'utf-8'));
      console.log(`\nImporting ${users.length} collector accounts...`);
      for (const u of users) {
        await pool.query(
          `INSERT INTO users (id, name, email, password, tier, phone, address, wishlist, role)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             name = VALUES(name),
             password = VALUES(password)`,
          [
            u.id, u.name, u.email, u.password, u.tier || 'Collector Member',
            u.phone || '', u.address || '', JSON.stringify(u.wishlist || []), u.role || 'collector'
          ]
        );
      }
      console.log(`✓ Collector accounts migrated successfully.`);
    }

    // 4. Migrate Admin
    const adminFile = path.join(dataDir, 'admin.json');
    if (fs.existsSync(adminFile)) {
      const adm = JSON.parse(fs.readFileSync(adminFile, 'utf-8'));
      console.log(`\nImporting curator admin credentials...`);
      await pool.query(
        `INSERT INTO admins (id, name, email, password, role)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           name = VALUES(name),
           password = VALUES(password)`,
        ['adm-1', adm.name || '55 smartCREATIVES Admin', adm.email || 'edsonndyanabo84@gmail.com', adm.password || 'EddyPro256', adm.role || 'admin']
      );
      console.log(`✓ Admin credentials migrated successfully.`);
    }

    // Summary query
    const [[artCount]] = await pool.query('SELECT COUNT(*) as count FROM artworks');
    const [[inqCount]] = await pool.query('SELECT COUNT(*) as count FROM inquiries');
    const [[usrCount]] = await pool.query('SELECT COUNT(*) as count FROM users');

    console.log('\n====================================================');
    console.log(' Migration Complete!');
    console.log(` - Artworks in MySQL:  ${artCount.count}`);
    console.log(` - Inquiries in MySQL: ${inqCount.count}`);
    console.log(` - Users in MySQL:     ${usrCount.count}`);
    console.log('====================================================\n');

    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
}

migrate();
