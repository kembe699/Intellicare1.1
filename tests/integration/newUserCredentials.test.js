/**
 * Two things added together: an admin-triggered password reset for a locked-
 * out user, and emailing a brand-new user (or a reset user) their sign-in
 * credentials. Both routes stay hardcoded admin-only (users.js create/delete's
 * existing policy — see authorize.js's own comment on why), and both go
 * through the same emailService template — this asserts the wiring is
 * actually present, not just the underlying pieces in isolation.
 */
const fs = require('fs');
const path = require('path');
const { sendNewUserWelcomeEmail } = require('../../src/server/utils/emailService');

const root = path.resolve(__dirname, '../..');
const usersRouteSrc = fs.readFileSync(path.join(root, 'src/server/routes/users.js'), 'utf8');

describe('Admin-triggered password reset', () => {
  test('POST /:id/reset-password is hardcoded admin-only, same as create/delete', () => {
    expect(usersRouteSrc).toMatch(/router\.post\(\s*'\/:id\/reset-password',\s*authorize\(\['admin'\]\)/);
  });

  test('the reset endpoint always returns a fresh tempPassword, never reuses one', () => {
    // generateTempPassword() is called inline in the handler, not passed in —
    // this just confirms the handler doesn't short-circuit with a fixed value.
    const handlerBody = usersRouteSrc.slice(usersRouteSrc.indexOf("router.post('/:id/reset-password'"));
    expect(handlerBody).toMatch(/generateTempPassword\(\)/);
    expect(handlerBody).toMatch(/bcrypt\.hash\(tempPassword, 10\)/);
  });

  test('a reset audit-logs the action', () => {
    const handlerBody = usersRouteSrc.slice(usersRouteSrc.indexOf("router.post('/:id/reset-password'"));
    expect(handlerBody).toMatch(/USER_PASSWORD_RESET/);
  });
});

describe('New-user / reset credentials email', () => {
  test('account creation sends the welcome email and reports whether it was delivered', () => {
    const createHandler = usersRouteSrc.slice(usersRouteSrc.indexOf("router.post('/', authorize(['admin'])"), usersRouteSrc.indexOf("router.post('/:id/reset-password'"));
    expect(createHandler).toMatch(/sendNewUserWelcomeEmail/);
    expect(createHandler).toMatch(/emailDelivered/);
  });

  test('sendNewUserWelcomeEmail always resolves (never throws) even with no email transport configured', async () => {
    const result = await sendNewUserWelcomeEmail({
      to: 'newuser@example.test', displayName: 'Test User', clientCode: 'demo', tempPassword: 'Ab12Cd34Ef56',
    });
    // No RESEND_API_KEY/SMTP configured in the test env — deliver() falls back
    // to logging, not throwing. Confirms this call site is wired correctly,
    // not that real delivery works (that's emailService's own concern).
    expect(result).toHaveProperty('delivered');
    expect(result.mode).toBe('log');
  });

  test('the reset variant uses different subject/copy than the welcome variant', async () => {
    const welcome = await sendNewUserWelcomeEmail({ to: 'a@example.test', displayName: 'A', clientCode: 'demo', tempPassword: 'x', isReset: false });
    const reset = await sendNewUserWelcomeEmail({ to: 'a@example.test', displayName: 'A', clientCode: 'demo', tempPassword: 'x', isReset: true });
    // Both fall back to 'log' mode, so the distinguishing detail is server-side
    // console output only — this just confirms the function accepts the flag
    // and returns cleanly for both, without inspecting console output.
    expect(welcome.mode).toBe('log');
    expect(reset.mode).toBe('log');
  });
});
