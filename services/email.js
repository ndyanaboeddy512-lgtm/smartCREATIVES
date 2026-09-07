/**
 * 55 smartCREATIVES — Transactional Email Service
 * Supports Resend (primary) and SendGrid (fallback) via native HTTPS REST API.
 * Zero dependency bloat, 100% serverless compatible on Vercel.
 */

const RESEND_API_URL = 'https://api.resend.com/emails';
const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';

function getSiteUrl() {
  return process.env.SITE_URL || 
         (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
}

function getSenderEmail() {
  return process.env.EMAIL_FROM || '55 smartCREATIVES <onboarding@resend.dev>';
}

function getAdminEmail() {
  return process.env.ADMIN_EMAIL || 'edsonndyanabo84@gmail.com';
}

/**
 * Validate RFC-5322 compliant email format
 */
function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email.trim());
}

/**
 * Send an email via Resend or SendGrid
 */
async function sendEmail({ to, subject, text, html, replyTo }) {
  const resendKey = process.env.RESEND_API_KEY;
  const sendgridKey = process.env.SENDGRID_API_KEY;
  const smtpUser = process.env.SMTP_USER || process.env.GMAIL_USER;
  const smtpPass = process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD;
  const from = getSenderEmail();
  
  // Resend is verified if explicit flag is set or custom sending domain is used (not onboarding@resend.dev)
  const isResendVerified = Boolean(
    process.env.RESEND_VERIFIED === 'true' || 
    (process.env.EMAIL_FROM && !process.env.EMAIL_FROM.includes('@resend.dev'))
  );
  const isProduction = Boolean(process.env.VERCEL || process.env.NODE_ENV === 'production');

  let resendError = null;

  // 1. Resend API (Exclusive production delivery when verified)
  if (resendKey && !resendKey.includes('your_resend_api_key')) {
    try {
      const res = await fetch(RESEND_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from,
          to: Array.isArray(to) ? to : [to],
          subject,
          text: text || undefined,
          html,
          reply_to: replyTo || undefined
        })
      });

      const data = await res.json();
      if (res.ok) {
        console.log(`✓ [Resend Email Sent] to: ${to} | Subject: "${subject}" | id: ${data.id || 'ok'}`);
        return { success: true, provider: 'resend', id: data.id };
      } else {
        resendError = data.message || (typeof data === 'string' ? data : JSON.stringify(data));
        console.error(`! [Resend API Error]:`, resendError);
        
        // If Resend is verified with a custom domain, do NOT fall back to prototype Gmail SMTP
        if (isResendVerified) {
          return { success: false, provider: 'resend', error: resendError };
        }
      }
    } catch (err) {
      resendError = err.message;
      console.error(`! [Resend Network Exception]:`, err.message);
      if (isResendVerified) {
        return { success: false, provider: 'resend', error: resendError };
      }
    }
  }

  // 2. Fallback SMTP (Active only during transition phase until Resend domain is verified)
  const hasSmtp = Boolean(smtpUser && smtpPass && !smtpPass.includes('your_app_password'));
  if (hasSmtp && !isResendVerified) {
    try {
      const nodemailer = require('nodemailer');
      const transporter = nodemailer.createTransport({
        service: process.env.SMTP_SERVICE || (smtpUser.includes('@gmail') ? 'gmail' : undefined),
        host: process.env.SMTP_HOST || undefined,
        port: parseInt(process.env.SMTP_PORT, 10) || undefined,
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user: smtpUser, pass: smtpPass }
      });

      const info = await transporter.sendMail({
        from: `55 smartCREATIVES <${smtpUser}>`,
        to,
        subject,
        text,
        html,
        replyTo: replyTo || undefined
      });
      console.log(`✓ [Gmail SMTP Email Sent] to: ${to} | Subject: "${subject}" | id: ${info.messageId}`);
      return { success: true, provider: 'smtp', id: info.messageId };
    } catch (err) {
      smtpError = err.message;
      console.warn(`! [SMTP Email Exception]:`, err.message);
    }
  }

  // 3. SendGrid API (Tertiary Fallback)
  if (sendgridKey && !sendgridKey.includes('your_sendgrid_key')) {
    try {
      const content = [];
      if (text) content.push({ type: 'text/plain', value: text });
      if (html) content.push({ type: 'text/html', value: html });

      const res = await fetch(SENDGRID_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${sendgridKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          personalizations: [{ to: (Array.isArray(to) ? to : [to]).map(e => ({ email: e })) }],
          from: { email: from.includes('<') ? from.match(/<([^>]+)>/)[1] : from, name: '55 smartCREATIVES' },
          subject,
          content,
          reply_to: replyTo ? { email: replyTo } : undefined
        })
      });

      if (res.status >= 200 && res.status < 300) {
        console.log(`✓ [SendGrid Email Sent] to: ${to} | Subject: "${subject}"`);
        return { success: true, provider: 'sendgrid' };
      } else {
        const errText = await res.text();
        console.warn(`! [SendGrid Error]:`, errText);
      }
    } catch (err) {
      console.warn(`! [SendGrid Network Exception]:`, err.message);
    }
  }

  // 4. Return error if providers were configured but all failed
  if (resendKey || hasSmtp || sendgridKey) {
    return {
      success: false,
      provider: hasSmtp ? 'smtp_fallback_failed' : 'all_providers_failed',
      error: smtpError || resendError || 'Email delivery failed across all configured providers.'
    };
  }

  // 5. Simulated Mode (when no real email providers are configured in local dev)
  console.log(`ℹ [Email Notice - Simulated] to: ${to} | Subject: "${subject}"`);
  return { success: true, simulated: true };
}

/**
 * Send automated confirmation email directly to the customer
 */
async function sendCustomerConfirmation(inquiry) {
  const rawEmail = inquiry.collectorEmail;
  const customerEmail = rawEmail ? rawEmail.trim() : '';

  // Validate email address format before sending; skip and log if invalid
  if (!isValidEmail(customerEmail)) {
    console.warn(`! [Email Skipped] Invalid customer email address format: "${rawEmail}". Skipping confirmation email.`);
    return { success: false, skipped: true, error: 'Invalid email format' };
  }

  const subject = "We've received your inquiry — 55 smartCREATIVES";
  const exactMessage = "Thank you for your enquiry. We are preparing a response with the available artwork details.";

  const artworkTitle = inquiry.artworkTitle || 'Curated Artwork';
  const collectorName = inquiry.collectorName || 'Valued Client';
  const siteUrl = getSiteUrl();
  const adminEmail = getAdminEmail();
  const artworkLink = inquiry.artworkId ? `${siteUrl}/artwork.html?id=${inquiry.artworkId}` : `${siteUrl}/#catalog`;

  const htmlBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${subject}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #121211; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e0e0e0; }
    .container { max-width: 600px; margin: 20px auto; background-color: #181716; border: 1px solid #2a2826; border-radius: 4px; overflow: hidden; }
    .header { padding: 32px 28px 24px; text-align: center; border-bottom: 1px solid #2a2826; background: #141312; }
    .brand { font-size: 20px; font-weight: 700; letter-spacing: 0.18em; color: #ffffff; text-transform: uppercase; }
    .tagline { font-size: 11px; letter-spacing: 0.25em; color: #c2a57e; text-transform: uppercase; margin-top: 6px; }
    .content { padding: 36px 32px; line-height: 1.6; }
    .greeting { font-size: 17px; color: #ffffff; margin-bottom: 18px; font-weight: 600; }
    .main-message { font-size: 15px; color: #f0f0f0; background: rgba(194, 165, 126, 0.08); border-left: 3px solid #c2a57e; padding: 18px 20px; margin-bottom: 24px; line-height: 1.6; }
    .artwork-card { background-color: #121211; border: 1px solid #2a2826; padding: 18px 20px; border-radius: 4px; margin-bottom: 24px; }
    .artwork-label { font-size: 11px; letter-spacing: 0.1em; color: #888; text-transform: uppercase; margin-bottom: 4px; }
    .artwork-title { font-size: 16px; font-weight: 600; color: #ffffff; }
    .btn { display: inline-block; background-color: #c2a57e; color: #121211; font-weight: 700; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; text-decoration: none; padding: 12px 24px; border-radius: 2px; }
    .footer { padding: 20px 32px; border-top: 1px solid #2a2826; font-size: 12px; color: #666; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">55 smartCREATIVES</div>
      <div class="tagline">CREATIVE PLATFORM &bull; CURATOR DIRECTORATE</div>
    </div>
    <div class="content">
      <div class="greeting">Hello ${collectorName},</div>
      
      <div class="main-message">
        ${exactMessage}
      </div>

      <div class="artwork-card">
        <div class="artwork-label">Artwork in Review:</div>
        <div class="artwork-title">"${artworkTitle}"</div>
        ${inquiry.framePreference ? `<div style="font-size: 13px; color: #999; margin-top: 6px;">Framing: ${inquiry.framePreference}</div>` : ''}
        ${inquiry.notes ? `<div style="font-size: 13px; color: #888; margin-top: 6px; font-style: italic;">"${inquiry.notes}"</div>` : ''}
      </div>

      <div style="text-align: center; margin-top: 24px;">
        <a href="${artworkLink}" class="btn">View Artwork Online</a>
      </div>
    </div>
    <div class="footer">
      55 smartCREATIVES &bull; Creative Platform &bull; Reference: ${inquiry.id || 'INQ'}
    </div>
  </div>
</body>
</html>
`;

  return sendEmail({
    to: customerEmail,
    subject,
    text: exactMessage,
    html: htmlBody,
    replyTo: adminEmail
  });
}

/**
 * Send alert email directly to the curator/admin
 */
async function sendAdminNotification(inquiry) {
  const adminEmail = getAdminEmail();
  if (!isValidEmail(adminEmail)) return { success: false, skipped: true };

  const siteUrl = getSiteUrl();
  const artworkTitle = inquiry.artworkTitle || 'Curated Fine Art';
  const collectorName = inquiry.collectorName || 'Anonymous Collector';
  const collectorEmail = inquiry.collectorEmail || 'Not provided';
  const collectorPhone = inquiry.collectorPhone || 'Not provided';
  const formattedPrice = inquiry.artworkPrice ? `$${Number(inquiry.artworkPrice).toLocaleString()}` : 'Price Upon Request';
  const framePref = inquiry.framePreference || 'Gallery Presentation';
  const notes = inquiry.notes || 'Inquired about purchasing this artwork.';
  const adminDashboardLink = `${siteUrl}/admin.html`;

  const subject = `⚡ New Customer Inquiry: "${artworkTitle}" from ${collectorName}`;

  const adminHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { margin: 0; padding: 0; background-color: #121211; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #e0e0e0; }
    .container { max-width: 600px; margin: 20px auto; background-color: #181716; border: 1px solid #2a2826; border-radius: 4px; overflow: hidden; }
    .header { padding: 24px 32px; background: rgba(194, 165, 126, 0.15); border-bottom: 2px solid #c2a57e; }
    .badge { display: inline-block; background: #c2a57e; color: #121211; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 2px; letter-spacing: 0.1em; text-transform: uppercase; margin-bottom: 8px; }
    .title { font-size: 20px; font-weight: 700; color: #ffffff; margin: 0; }
    .content { padding: 32px; }
    .section-title { font-size: 12px; font-weight: 700; letter-spacing: 0.15em; color: #c2a57e; text-transform: uppercase; margin-top: 20px; margin-bottom: 8px; }
    .data-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; background: #121211; border: 1px solid #2a2826; }
    .data-table td { padding: 10px 14px; font-size: 13px; border-bottom: 1px solid #222; }
    .data-label { color: #888; width: 140px; font-weight: 600; }
    .data-val { color: #fff; }
    .btn { display: inline-block; background-color: #c2a57e; color: #121211; font-weight: 700; font-size: 13px; letter-spacing: 0.1em; text-transform: uppercase; text-decoration: none; padding: 12px 24px; border-radius: 2px; margin-top: 16px; }
    .footer { padding: 20px 32px; border-top: 1px solid #2a2826; font-size: 11px; color: #666; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <span class="badge">New Customer Inquiry</span>
      <h1 class="title">"${artworkTitle}"</h1>
    </div>
    <div class="content">
      <div class="section-title">Customer Details</div>
      <table class="data-table">
        <tr>
          <td class="data-label">Name:</td>
          <td class="data-val"><strong>${collectorName}</strong></td>
        </tr>
        <tr>
          <td class="data-label">Email:</td>
          <td class="data-val"><a href="mailto:${collectorEmail}" style="color: #c2a57e; text-decoration: underline;">${collectorEmail}</a></td>
        </tr>
        <tr>
          <td class="data-label">Phone:</td>
          <td class="data-val">${collectorPhone}</td>
        </tr>
        <tr>
          <td class="data-label">Received At:</td>
          <td class="data-val">${new Date().toLocaleString()}</td>
        </tr>
      </table>

      <div class="section-title">Artwork Details</div>
      <table class="data-table">
        <tr>
          <td class="data-label">Artwork:</td>
          <td class="data-val"><strong>${artworkTitle}</strong></td>
        </tr>
        <tr>
          <td class="data-label">Listed Price:</td>
          <td class="data-val" style="color: #c2a57e; font-weight: 700;">${formattedPrice}</td>
        </tr>
        <tr>
          <td class="data-label">Framing:</td>
          <td class="data-val">${framePref}</td>
        </tr>
        <tr>
          <td class="data-label">Inquiry Ref:</td>
          <td class="data-val"><code>${inquiry.id || 'N/A'}</code></td>
        </tr>
      </table>

      <div class="section-title">Customer Message</div>
      <div style="background: #121211; border: 1px solid #2a2826; padding: 14px; font-style: italic; color: #ddd; font-size: 14px; line-height: 1.5;">
        "${notes}"
      </div>

      <div style="text-align: center; margin-top: 24px;">
        <a href="${adminDashboardLink}" class="btn">Open Curator Dashboard ↗</a>
      </div>
    </div>
    <div class="footer">
      55 smartCREATIVES Creative Platform &bull; Live Inquiry Dispatch
    </div>
  </div>
</body>
</html>
`;

  return sendEmail({
    to: adminEmail,
    subject,
    text: `New customer inquiry received from ${collectorName} (${collectorEmail}) regarding "${artworkTitle}". Message: "${notes}"`,
    html: adminHtml,
    replyTo: collectorEmail
  });
}

/**
 * Send customized/verified artwork reply directly to the customer (via Make.com or curator action)
 */
async function sendCustomerReply({ to, subject, html, text, inquiryId, artworkTitle }) {
  const rawEmail = to;
  const customerEmail = rawEmail ? rawEmail.trim() : '';

  if (!isValidEmail(customerEmail)) {
    console.warn(`! [Customer Reply Skipped] Invalid customer email: "${rawEmail}".`);
    return { success: false, skipped: true, error: 'Invalid email format' };
  }

  const emailSubject = subject || `Regarding your inquiry: ${artworkTitle || '55 smartCREATIVES'}`;
  const adminEmail = getAdminEmail();
  const siteUrl = getSiteUrl();

  const formattedHtml = html || `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${emailSubject}</title>
  <style>
    body { margin: 0; padding: 0; background-color: #121211; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #e0e0e0; }
    .container { max-width: 600px; margin: 20px auto; background-color: #181716; border: 1px solid #2a2826; border-radius: 4px; overflow: hidden; }
    .header { padding: 32px 28px 24px; text-align: center; border-bottom: 1px solid #2a2826; background: #141312; }
    .brand { font-size: 20px; font-weight: 700; letter-spacing: 0.18em; color: #ffffff; text-transform: uppercase; }
    .tagline { font-size: 11px; letter-spacing: 0.25em; color: #c2a57e; text-transform: uppercase; margin-top: 6px; }
    .content { padding: 36px 32px; line-height: 1.7; font-size: 15px; color: #f0f0f0; white-space: pre-line; }
    .footer { padding: 20px 32px; border-top: 1px solid #2a2826; font-size: 12px; color: #666; text-align: center; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">55 smartCREATIVES</div>
      <div class="tagline">CREATIVE PLATFORM &bull; CURATOR DIRECTORATE</div>
    </div>
    <div class="content">
${text || ''}
    </div>
    <div class="footer">
      55 smartCREATIVES &bull; Creative Platform &bull; Reference: ${inquiryId || 'INQ'}
    </div>
  </div>
</body>
</html>
`;

  return sendEmail({
    to: customerEmail,
    subject: emailSubject,
    text: text || undefined,
    html: formattedHtml,
    replyTo: adminEmail
  });
}

/**
 * Dispatch both notifications asynchronously
 */
async function sendInquiryNotifications(inquiry) {
  const [customerEmail, adminEmail] = await Promise.allSettled([
    sendCustomerConfirmation(inquiry),
    sendAdminNotification(inquiry)
  ]);

  return {
    customerEmail: customerEmail.status === 'fulfilled' ? customerEmail.value : { success: false, error: customerEmail.reason },
    adminEmail: adminEmail.status === 'fulfilled' ? adminEmail.value : { success: false, error: adminEmail.reason }
  };
}

module.exports = {
  sendEmail,
  isValidEmail,
  sendCustomerConfirmation,
  sendAdminNotification,
  sendCustomerReply,
  sendInquiryNotifications,
  getSiteUrl,
  getAdminEmail
};
