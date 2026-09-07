/**
 * 55 smartCREATIVES — Make.com Webhook Dispatcher
 * Sends asynchronous, non-blocking webhook payloads to Make.com (or any automation endpoint)
 * when client inquiries are submitted.
 */

const db = require('../db');

function getSiteUrl() {
  return process.env.SITE_URL || 
         (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
}

async function dispatchMakeInquiryWebhook(inquiry, artworkData = null) {
  const webhookUrl = process.env.MAKE_INQUIRY_WEBHOOK_URL;
  if (!webhookUrl || webhookUrl.trim().length === 0 || webhookUrl.includes('your_make_webhook_url')) {
    // Not configured: exit cleanly without errors
    return { success: true, configured: false };
  }

  try {
    let artwork = artworkData;
    const artId = inquiry.artworkId || inquiry.artwork_id;
    if (!artwork && artId) {
      try {
        artwork = await db.getArtworkById(artId);
      } catch (_) {
        // Fallback to inquiry properties if DB query fails
      }
    }

    const siteUrl = getSiteUrl();
    const callbackUrl = `${siteUrl}/api/inquiries/${inquiry.id}/reply`;
    const detailsUrl = `${siteUrl}/api/inquiries/${inquiry.id}/details`;

    const payload = {
      event: 'inquiry.created',
      timestamp: new Date().toISOString(),
      platform: '55 smartCREATIVES',
      callbackUrl,
      detailsUrl,
      inquiry: {
        id: inquiry.id,
        date: inquiry.date,
        status: inquiry.status,
        framePreference: inquiry.framePreference || inquiry.frame_preference || 'Included Framing',
        notes: inquiry.notes || '',
        collector: {
          name: inquiry.collectorName || inquiry.collector_name,
          email: inquiry.collectorEmail || inquiry.collector_email,
          phone: inquiry.collectorPhone || inquiry.collector_phone
        },
        artwork: {
          id: artwork ? artwork.id : (artId || null),
          title: artwork ? artwork.title : (inquiry.artworkTitle || inquiry.artwork_title || 'General Acquisition Inquiry'),
          artist: artwork ? artwork.artist : (inquiry.artworkArtist || inquiry.artwork_artist || '55 smartCREATIVES Studio'),
          price: artwork ? artwork.price : (inquiry.artworkPrice || inquiry.artwork_price || 0),
          medium: artwork ? artwork.medium : '',
          dimensions: artwork ? artwork.dimensions : '',
          year: artwork ? artwork.year : 2026,
          status: artwork ? artwork.status : 'Available',
          description: artwork ? (artwork.description || '') : '',
          shippingDetails: artwork ? (artwork.shippingDetails || '') : '',
          faq: artwork ? (artwork.faq || []) : [],
          images: artwork ? (artwork.images || (artwork.image ? [artwork.image] : [])) : (inquiry.artworkImage ? [inquiry.artworkImage] : [])
        }
      }
    };

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': '55smartCREATIVES-Platform/1.0'
    };

    if (process.env.MAKE_WEBHOOK_SECRET) {
      headers['x-make-secret'] = process.env.MAKE_WEBHOOK_SECRET;
    }

    const res = await fetch(webhookUrl.trim(), {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      console.log(`✓ [Make.com Webhook Dispatched] Inquiry: ${inquiry.id}`);
      return { success: true, configured: true, status: res.status };
    } else {
      console.warn(`! [Make.com Webhook Notice]: Endpoint responded with HTTP ${res.status}`);
      return { success: false, configured: true, status: res.status };
    }
  } catch (err) {
    console.warn('! [Make.com Webhook Exception]:', err.message);
    return { success: false, configured: true, error: err.message };
  }
}

module.exports = {
  dispatchMakeInquiryWebhook
};
