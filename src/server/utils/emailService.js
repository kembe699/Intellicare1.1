const nodemailer = require('nodemailer');

// Transports, in the order they are tried:
//
//   1. Resend's HTTP API (RESEND_API_KEY). Preferred — it is one HTTPS request,
//      so it works on hosts that block outbound SMTP ports, which Render does
//      on its free tier. This is why SMTP alone was never going to deliver
//      there no matter how the credentials were set.
//   2. SMTP (EMAIL_USER/EMAIL_PASS or SMTP_USER/SMTP_PASS), for a self-hosted
//      deployment that would rather use its own relay.
//   3. Neither configured — the message is logged, never silently swallowed.
//
// EMAIL_FROM must be on a domain verified in the Resend dashboard. Without one
// Resend only delivers to the account's own address, which looks exactly like
// "sending works in testing, nothing arrives in production".
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

function fromAddress() {
  const addr = process.env.EMAIL_FROM || 'onboarding@resend.dev';
  const name = process.env.EMAIL_FROM_NAME || 'IntelliCare';
  return `${name} <${addr}>`;
}

function supportEmail() {
  return process.env.SUPPORT_EMAIL || 'support@nilehc.tech';
}

function frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:8080').replace(/\/+$/, '');
}

const createTransporter = () => {
  const emailUser = process.env.EMAIL_USER || process.env.SMTP_USER;
  const emailPass = process.env.EMAIL_PASS || process.env.SMTP_PASS;
  const emailHost = process.env.EMAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com';
  const emailPort = process.env.EMAIL_PORT || process.env.SMTP_PORT || 587;
  if (!emailUser || !emailPass) return null;
  return nodemailer.createTransport({
    host: emailHost,
    port: emailPort,
    secure: emailPort == 465,
    auth: { user: emailUser, pass: emailPass },
  });
};

/**
 * Deliver one message through whichever transport is configured.
 *
 * Always resolves — a delivery failure must never take down the request that
 * triggered it (creating a tenant still succeeds if its welcome email bounces).
 * The outcome is returned so the caller can report it honestly rather than
 * claiming an email was sent when it wasn't.
 *
 * `attachments` (optional): [{ filename, content: base64 string, contentType }].
 * Added for the demo-booking confirmation's .ics calendar invite — a data:
 * URI link in the body is blocked by several webmail clients (Gmail strips
 * data: hrefs), while a real attachment is what every client actually
 * recognizes as "add to calendar".
 */
async function deliver({ to, subject, html, text, replyTo, attachments }) {
  const apiKey = process.env.RESEND_API_KEY;

  if (apiKey) {
    try {
      const res = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress(),
          to: [to],
          subject,
          html,
          text,
          ...(replyTo ? { reply_to: replyTo } : {}),
          ...(attachments?.length ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content })) } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Resend reports a bad key, an unverified domain or a rejected
        // recipient with a 4xx and a message — surface it rather than a bare
        // status, because those three are the whole failure surface in practice.
        console.error(`❌ Resend rejected the message to ${to}: ${res.status} ${body?.message || JSON.stringify(body)}`);
        return { delivered: false, mode: 'resend', error: body?.message || `HTTP ${res.status}` };
      }
      console.log(`✅ Email sent to ${to} via Resend (id ${body?.id || 'n/a'})`);
      return { delivered: true, mode: 'resend', id: body?.id };
    } catch (err) {
      console.error(`❌ Resend request failed for ${to}: ${err.message}`);
      return { delivered: false, mode: 'resend', error: err.message };
    }
  }

  const transporter = createTransporter();
  if (transporter) {
    try {
      await transporter.sendMail({
        from: fromAddress(), to, subject, html, text, replyTo,
        ...(attachments?.length
          ? { attachments: attachments.map((a) => ({ filename: a.filename, content: a.content, encoding: 'base64', contentType: a.contentType })) }
          : {}),
      });
      console.log(`✅ Email sent to ${to} via SMTP`);
      return { delivered: true, mode: 'smtp' };
    } catch (err) {
      console.error(`❌ SMTP send failed for ${to}: ${err.message}`);
      return { delivered: false, mode: 'smtp', error: err.message };
    }
  }

  if (process.env.NODE_ENV === 'production') {
    console.error('\n' + '!'.repeat(80));
    console.error(`🚨 EMAIL NOT SENT — no transport configured in production`);
    console.error(`   Set RESEND_API_KEY (preferred) or EMAIL_USER/EMAIL_PASS.`);
    console.error(`   Intended recipient: ${to} — subject: ${subject}`);
    console.error('!'.repeat(80));
  }
  console.log('\n' + '='.repeat(80));
  console.log(`📧 EMAIL (no transport configured — logged, not sent)`);
  console.log(`To: ${to}\nSubject: ${subject}`);
  console.log(text || '(html only)');
  console.log('='.repeat(80) + '\n');
  return { delivered: false, mode: 'log' };
}

// ── Shared chrome ──────────────────────────────────────────────────────────
const shell = (title, inner) => `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background-color:#f4f4f4;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f4;padding:20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
        <tr><td style="background:linear-gradient(135deg,#3D8A97 0%,#2d6a75 100%);padding:40px 30px;text-align:center;">
          <h1 style="margin:0;color:#ffffff;font-size:26px;">${title}</h1>
        </td></tr>
        <tr><td style="padding:40px 30px;">${inner}</td></tr>
        <tr><td style="background-color:#f8f9fa;padding:30px;text-align:center;">
          <p style="margin:0 0 10px;font-size:14px;color:#666;"><strong>IntelliCare Hospital Management</strong></p>
          <p style="margin:0;font-size:13px;color:#999;">Need help? Contact <a href="mailto:${supportEmail()}" style="color:#3D8A97;">${supportEmail()}</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

// ── Password reset ─────────────────────────────────────────────────────────
async function sendPasswordResetEmail(email, resetToken, userName = 'User', clientCode = '') {
  // The reset token is only ever looked up within one tenant's own schema, so
  // the link has to carry which tenant that is — the same way the login page
  // asks for an instance code. A bare token doesn't say which schema to check.
  const resetLink = `${frontendUrl()}/reset-password?token=${resetToken}&code=${encodeURIComponent(clientCode)}`;

  const html = shell('Password Reset', `
    <p style="margin:0 0 20px;font-size:16px;color:#333;">Hello <strong>${userName}</strong>,</p>
    <p style="margin:0 0 20px;font-size:16px;color:#333;">We received a request to reset your password. Click the button below:</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0;"><tr><td align="center">
      <a href="${resetLink}" style="display:inline-block;padding:16px 40px;background-color:#3D8A97;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;">Reset Password</a>
    </td></tr></table>
    <p style="margin:20px 0;font-size:14px;color:#666;">Or copy this link:</p>
    <p style="margin:0 0 20px;padding:12px;background-color:#f8f9fa;font-size:13px;color:#555;word-break:break-all;">${resetLink}</p>
    <div style="margin:30px 0;padding:20px;background-color:#fff3cd;border-left:4px solid #ffc107;border-radius:4px;">
      <p style="margin:0;font-size:14px;color:#856404;">⚠️ <strong>Important:</strong> This link expires in <strong>1 hour</strong>.</p>
    </div>
    <p style="margin:20px 0 0;font-size:14px;color:#666;">If you didn't request this, please ignore this email.</p>`);

  const text = `Hello ${userName},

We received a request to reset your password for your IntelliCare account.

Reset your password by clicking this link:
${resetLink}

This link will expire in 1 hour for security reasons.

If you didn't request a password reset, please ignore this email.

---
IntelliCare Hospital Management System
Need help? Contact ${supportEmail()}`;

  return deliver({ to: email, subject: 'Password Reset Request - IntelliCare', html, text });
}

// ── New tenant welcome ─────────────────────────────────────────────────────
/**
 * Sent when a platform admin provisions a new hospital. Carries the three
 * things needed to sign in — instance code, email, temporary password — because
 * the temporary password is shown exactly once in the platform-admin UI and is
 * unrecoverable after that response.
 */
async function sendTenantWelcomeEmail({ to, facilityName, adminName, clientCode, tempPassword }) {
  const loginUrl = `${frontendUrl()}/login`;
  const safeName = adminName || 'there';

  const html = shell(`Welcome to IntelliCare`, `
    <p style="margin:0 0 20px;font-size:16px;color:#333;">Hello <strong>${safeName}</strong>,</p>
    <p style="margin:0 0 20px;font-size:16px;color:#333;">
      <strong>${facilityName}</strong> has been set up on IntelliCare and your administrator account is ready.
    </p>
    <p style="margin:0 0 12px;font-size:15px;color:#333;font-weight:600;">Your sign-in details</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #e5e7eb;border-radius:6px;">
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#666;width:45%;">Instance code</td>
          <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111;font-weight:700;">${clientCode}</td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#666;">Email address</td>
          <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111;font-weight:700;">${to}</td></tr>
      <tr><td style="padding:12px 16px;font-size:14px;color:#666;">Temporary password</td>
          <td style="padding:12px 16px;font-size:14px;color:#111;font-weight:700;font-family:monospace;">${tempPassword}</td></tr>
    </table>
    <p style="margin:0 0 12px;font-size:15px;color:#333;font-weight:600;">How to sign in</p>
    <ol style="margin:0 0 24px;padding-left:20px;font-size:15px;color:#333;line-height:1.7;">
      <li>Open <a href="${loginUrl}" style="color:#3D8A97;">${loginUrl}</a></li>
      <li>Enter the instance code <strong>${clientCode}</strong></li>
      <li>Sign in with your email and the temporary password above</li>
      <li>Change your password straight away from your profile</li>
    </ol>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0;"><tr><td align="center">
      <a href="${loginUrl}" style="display:inline-block;padding:16px 40px;background-color:#3D8A97;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;">Sign In</a>
    </td></tr></table>
    <div style="margin:30px 0 0;padding:20px;background-color:#fff3cd;border-left:4px solid #ffc107;border-radius:4px;">
      <p style="margin:0;font-size:14px;color:#856404;">⚠️ <strong>Please change this password after your first sign-in.</strong> It was generated for you and is shared only in this email.</p>
    </div>`);

  const text = `Hello ${safeName},

${facilityName} has been set up on IntelliCare and your administrator account is ready.

YOUR SIGN-IN DETAILS
  Instance code:      ${clientCode}
  Email address:      ${to}
  Temporary password: ${tempPassword}

HOW TO SIGN IN
  1. Open ${loginUrl}
  2. Enter the instance code: ${clientCode}
  3. Sign in with your email and the temporary password above
  4. Change your password straight away from your profile

Please change this password after your first sign-in — it was generated for you
and is shared only in this email.

---
IntelliCare Hospital Management System
Need help? Contact ${supportEmail()}`;

  return deliver({ to, subject: `Welcome to IntelliCare — ${facilityName}`, html, text });
}

// ── New staff account credentials ────────────────────────────────────────────
/**
 * Sent to a staff member's own email when an admin creates their account
 * (routes/users.js POST /) or resets their password (POST /:id/reset-password)
 * from Setup > Security. Unlike sendTenantWelcomeEmail (a brand-new tenant's
 * own admin account), this is an existing tenant's staff login — the sign-in
 * page still needs the tenant's instance code, so it's carried the same way.
 * Delivery is always best-effort: the temp password is also returned in the
 * API response for the admin to hand over directly, so a bounced/undelivered
 * email never leaves the account inaccessible.
 */
async function sendNewUserWelcomeEmail({ to, displayName, clientCode, tempPassword, isReset = false }) {
  const loginUrl = `${frontendUrl()}/login`;
  const safeName = displayName || 'there';
  const intro = isReset
    ? `Your IntelliCare password has been reset by an administrator.`
    : `Your IntelliCare account has been created.`;

  const html = shell(isReset ? 'Password Reset' : 'Welcome to IntelliCare', `
    <p style="margin:0 0 20px;font-size:16px;color:#333;">Hello <strong>${safeName}</strong>,</p>
    <p style="margin:0 0 20px;font-size:16px;color:#333;">${intro}</p>
    <p style="margin:0 0 12px;font-size:15px;color:#333;font-weight:600;">Your sign-in details</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #e5e7eb;border-radius:6px;">
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#666;width:45%;">Instance code</td>
          <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111;font-weight:700;">${clientCode}</td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#666;">Email address</td>
          <td style="padding:12px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111;font-weight:700;">${to}</td></tr>
      <tr><td style="padding:12px 16px;font-size:14px;color:#666;">Temporary password</td>
          <td style="padding:12px 16px;font-size:14px;color:#111;font-weight:700;font-family:monospace;">${tempPassword}</td></tr>
    </table>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:30px 0;"><tr><td align="center">
      <a href="${loginUrl}" style="display:inline-block;padding:16px 40px;background-color:#3D8A97;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;">Sign In</a>
    </td></tr></table>
    <div style="margin:30px 0 0;padding:20px;background-color:#fff3cd;border-left:4px solid #ffc107;border-radius:4px;">
      <p style="margin:0;font-size:14px;color:#856404;">⚠️ <strong>Please change this password after signing in.</strong> It is shared only in this email.</p>
    </div>`);

  const text = `Hello ${safeName},

${intro}

YOUR SIGN-IN DETAILS
  Instance code:      ${clientCode}
  Email address:      ${to}
  Temporary password: ${tempPassword}

Sign in at ${loginUrl}, then change this password straight away from your profile.

---
IntelliCare Hospital Management System
Need help? Contact ${supportEmail()}`;

  return deliver({ to, subject: isReset ? 'Your IntelliCare password was reset' : 'Welcome to IntelliCare', html, text });
}

// ── Book a Demo ─────────────────────────────────────────────────────────────
// Brand colours for this one template — same exact hex values as the public
// /book-demo page (BookDemo.tsx), deliberately not the shared shell()'s
// #3D8A97 gradient look used by every other email in this file. Kept as its
// own bespoke, minimal markup rather than reusing shell() so this one stays
// visually tied to the booking page it follows, without changing how every
// other email (password reset, welcome) looks.
const DEMO_TEAL = '#0A96A1';
const DEMO_NAVY = '#153765';

/**
 * Sent to the visitor right after they book a demo slot on the public
 * /book-demo page (routes/publicBookDemo.js). Carries exactly what they'd
 * need to show up — date/time/timezone and demo type — our contacts, and a
 * real .ics attachment. A data: URI link in the body would be simpler but
 * Gmail and several other webmail clients strip data: hrefs outright; a real
 * attachment is what every mail client actually recognizes as a calendar
 * invite (Gmail/Outlook both offer their own "add to calendar" prompt for
 * a text/calendar attachment without any extra markup needed here).
 */
async function sendDemoBookingConfirmationEmail({ to, fullName, bookingDate, startTime, endTime, demoType, facilityName }) {
  const safeName = fullName || 'there';
  const { buildDemoBookingIcs } = require('./icsBuilder');
  const ics = buildDemoBookingIcs({ bookingDate, startTime, endTime, facilityName, demoType });
  const icsBase64 = Buffer.from(ics).toString('base64');
  const logoUrl = `${frontendUrl()}/hjd.png`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your Demo is Booked</title></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background-color:#ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;">
    <tr><td align="center" style="padding:40px 20px;">
      <table width="480" cellpadding="0" cellspacing="0" style="max-width:480px;">
        <tr><td align="center" style="padding-bottom:28px;">
          <img src="${logoUrl}" alt="IntelliCare" height="40" style="height:40px;width:auto;display:block;">
        </td></tr>
        <tr><td align="center" style="padding-bottom:4px;">
          <span style="font-size:12px;font-weight:700;letter-spacing:0.06em;color:${DEMO_TEAL};text-transform:uppercase;">Demo Confirmed</span>
        </td></tr>
        <tr><td align="center" style="padding-bottom:20px;">
          <h1 style="margin:0;font-size:22px;font-weight:700;color:${DEMO_NAVY};">Your demo is booked</h1>
        </td></tr>
        <tr><td style="padding-bottom:24px;font-size:15px;line-height:1.6;color:#44546a;">
          Hi ${safeName}, thanks for booking a demo of IntelliCare HMIS for <strong style="color:${DEMO_NAVY};">${facilityName}</strong>. Here are the details:
        </td></tr>
        <tr><td style="padding-bottom:28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e7ecf2;border-radius:10px;">
            <tr><td style="padding:14px 18px;border-bottom:1px solid #e7ecf2;font-size:13px;color:#8a97ab;width:38%;">Date</td>
                <td style="padding:14px 18px;border-bottom:1px solid #e7ecf2;font-size:14px;color:${DEMO_NAVY};font-weight:600;">${bookingDate}</td></tr>
            <tr><td style="padding:14px 18px;border-bottom:1px solid #e7ecf2;font-size:13px;color:#8a97ab;">Time</td>
                <td style="padding:14px 18px;border-bottom:1px solid #e7ecf2;font-size:14px;color:${DEMO_NAVY};font-weight:600;">${startTime} – ${endTime} (Africa/Juba, UTC+2)</td></tr>
            <tr><td style="padding:14px 18px;font-size:13px;color:#8a97ab;">Demo type</td>
                <td style="padding:14px 18px;font-size:14px;color:${DEMO_NAVY};font-weight:600;">${demoType}</td></tr>
          </table>
        </td></tr>
        <tr><td align="center" style="padding-bottom:28px;">
          <span style="display:inline-block;padding:10px 20px;background-color:#f0fafb;border:1px solid #d7eef1;border-radius:8px;font-size:13px;font-weight:600;color:${DEMO_TEAL};">📅 Calendar invite attached — tap to add to calendar</span>
        </td></tr>
        <tr><td align="center" style="font-size:13px;color:#8a97ab;line-height:1.6;">
          Need to reschedule? Email <a href="mailto:${supportEmail()}" style="color:${DEMO_TEAL};text-decoration:none;">${supportEmail()}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const text = `Hi ${safeName},

Thanks for booking a demo of IntelliCare HMIS for ${facilityName}. Here are the details:

  Date:        ${bookingDate}
  Time:        ${startTime} - ${endTime} (Africa/Juba, UTC+2)
  Demo type:   ${demoType}

Need to reschedule? Email ${supportEmail()}.

---
IntelliCare`;

  return deliver({
    to,
    subject: `Your IntelliCare demo is booked — ${bookingDate} ${startTime}`,
    html,
    text,
    attachments: [{ filename: 'intellicare-demo.ics', content: icsBase64, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }],
  });
}

/**
 * Sent to our own team (always info@nilehc.tech, not configurable — see
 * routes/publicBookDemo.js) for every new demo booking, so sales/support
 * knows to prepare regardless of whether anyone is watching the admin panel.
 */
async function sendDemoBookingNotificationEmail({ booking }) {
  const rows = [
    ['Date', booking.booking_date],
    ['Time', `${booking.start_time} – ${booking.end_time} (Africa/Juba, UTC+2)`],
    ['Demo type', booking.demo_type],
    ['Full name', booking.full_name],
    ['Email', booking.email],
    ['Phone/WhatsApp', booking.phone],
    ['Job title', booking.job_title || '—'],
    ['Facility name', booking.facility_name],
    ['Facility type', booking.facility_type],
    ['Location/city', booking.location_city],
    ['Staff/beds', booking.staff_or_beds_range || '—'],
    ['Notes', booking.notes || '—'],
  ];
  const rowsHtml = rows.map(([label, value]) => `
    <tr><td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#666;width:35%;">${label}</td>
        <td style="padding:10px 16px;border-bottom:1px solid #e5e7eb;font-size:14px;color:#111;">${value}</td></tr>`).join('');
  const rowsText = rows.map(([label, value]) => `  ${label}: ${value}`).join('\n');

  const html = shell('New Demo Booking', `
    <p style="margin:0 0 20px;font-size:16px;color:#333;">A new demo was booked on the public Book a Demo page.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;border:1px solid #e5e7eb;border-radius:6px;">${rowsHtml}</table>`);

  const text = `A new demo was booked on the public Book a Demo page.

${rowsText}`;

  return deliver({ to: 'info@nilehc.tech', subject: `New demo booking — ${booking.facility_name} (${booking.booking_date} ${booking.start_time})`, html, text });
}

module.exports = {
  sendPasswordResetEmail,
  sendTenantWelcomeEmail,
  sendNewUserWelcomeEmail,
  sendDemoBookingConfirmationEmail,
  sendDemoBookingNotificationEmail,
  deliver,
};
