const nodemailer = require('nodemailer');

// Email configuration
const createTransporter = () => {
  const emailUser = process.env.EMAIL_USER || process.env.SMTP_USER;
  const emailPass = process.env.EMAIL_PASS || process.env.SMTP_PASS;
  const emailHost = process.env.EMAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com';
  const emailPort = process.env.EMAIL_PORT || process.env.SMTP_PORT || 587;

  if (!emailUser || !emailPass) {
    console.warn('⚠️  Email credentials not configured. Using development mode.');
    return null;
  }

  return nodemailer.createTransport({
    host: emailHost,
    port: emailPort,
    secure: emailPort == 465,
    auth: {
      user: emailUser,
      pass: emailPass,
    },
  });
};

async function sendPasswordResetEmail(email, resetToken, userName = 'User', clientCode = '') {
  try {
    const transporter = createTransporter();
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080';
    // The reset token is only ever looked up within one tenant's own database (see
    // /api/auth/verify-reset-token and /api/auth/reset-password in index.js) — the link
    // has to carry which tenant that is, the same way the login page itself asks for an
    // instance code, since a bare token alone doesn't say which of many tenant databases
    // to check it against.
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}&code=${encodeURIComponent(clientCode)}`;

    if (!transporter) {
      if (process.env.NODE_ENV === 'production') {
        // This is a real deliverability outage, not a dev convenience — the
        // user gets the generic "check your email" response (never leak
        // account existence), but nothing was actually sent. Log loudly so
        // it isn't discovered only when a user complains the link never came.
        console.error('\n' + '!'.repeat(80));
        console.error('🚨 PASSWORD RESET EMAIL NOT SENT — SMTP is not configured in production');
        console.error(`   EMAIL_USER/EMAIL_PASS (or SMTP_USER/SMTP_PASS) are unset.`);
        console.error(`   Requested for: ${email} — reset link was only logged below, not delivered.`);
        console.error('!'.repeat(80));
      }
      console.log('\n' + '='.repeat(80));
      console.log('📧 PASSWORD RESET EMAIL (Development Mode — not actually sent)');
      console.log('='.repeat(80));
      console.log(`To: ${email}`);
      console.log(`User: ${userName}`);
      console.log(`Reset Link: ${resetLink}`);
      console.log(`Token: ${resetToken}`);
      console.log('='.repeat(80) + '\n');
      return { delivered: false, mode: 'dev-log' };
    }

    const mailOptions = {
      // Deliberately NOT process.env.EMAIL_USER/SMTP_USER — for an SMTP relay like Resend
      // that value is the fixed auth username ("resend"), not a real mailbox, so reusing
      // it here would put a nonsense From address on every email. EMAIL_FROM is the actual
      // sending address, which for Resend must be on a domain verified in their dashboard
      // (falls back to their no-verification-needed sandbox sender otherwise, which only
      // delivers to the Resend account's own verified email until a domain is verified).
      from: `"IntelliCare Support" <${process.env.EMAIL_FROM || 'onboarding@resend.dev'}>`,
      to: email,
      subject: 'Password Reset Request - IntelliCare',
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Password Reset</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f4; padding: 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden;">
                  <tr>
                    <td style="background: linear-gradient(135deg, #3D8A97 0%, #2d6a75 100%); padding: 40px 30px; text-align: center;">
                      <h1 style="margin: 0; color: #ffffff; font-size: 28px;">Password Reset</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 40px 30px;">
                      <p style="margin: 0 0 20px; font-size: 16px; color: #333;">Hello <strong>${userName}</strong>,</p>
                      <p style="margin: 0 0 20px; font-size: 16px; color: #333;">We received a request to reset your password. Click the button below:</p>
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 30px 0;">
                        <tr>
                          <td align="center">
                            <a href="${resetLink}" style="display: inline-block; padding: 16px 40px; background-color: #3D8A97; color: #ffffff; text-decoration: none; border-radius: 6px; font-size: 16px; font-weight: 600;">Reset Password</a>
                          </td>
                        </tr>
                      </table>
                      <p style="margin: 20px 0; font-size: 14px; color: #666;">Or copy this link:</p>
                      <p style="margin: 0 0 20px; padding: 12px; background-color: #f8f9fa; font-size: 13px; color: #555; word-break: break-all;">${resetLink}</p>
                      <div style="margin: 30px 0; padding: 20px; background-color: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                        <p style="margin: 0; font-size: 14px; color: #856404;">⚠️ <strong>Important:</strong> This link expires in <strong>1 hour</strong>.</p>
                      </div>
                      <p style="margin: 20px 0 0; font-size: 14px; color: #666;">If you didn't request this, please ignore this email.</p>
                    </td>
                  </tr>
                  <tr>
                    <td style="background-color: #f8f9fa; padding: 30px; text-align: center;">
                      <p style="margin: 0 0 10px; font-size: 14px; color: #666;"><strong>IntelliCare Hospital Management</strong></p>
                      <p style="margin: 0; font-size: 13px; color: #999;">Need help? Contact <a href="mailto:support@intellicare.com" style="color: #3D8A97;">support@intellicare.com</a></p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `,
      text: `
Hello ${userName},

We received a request to reset your password for your IntelliCare account.

Reset your password by clicking this link:
${resetLink}

This link will expire in 1 hour for security reasons.

If you didn't request a password reset, please ignore this email.

---
IntelliCare Hospital Management System
Need help? Contact support@intellicare.com
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Password reset email sent to ${email}`);
    return { delivered: true, mode: 'smtp' };
  } catch (error) {
    console.error('❌ Error sending password reset email:', error);
    return { delivered: false, mode: 'smtp', error: error.message };
  }
}

module.exports = {
  sendPasswordResetEmail
};
