/**
 * Public, unauthenticated payroll-signing flow — an employee scans a QR
 * code (generated from the authenticated payroll run page, see hr.js's
 * POST /payroll/runs/:id/lines/:lineId/signing-link) on their own phone,
 * confirms their identity with just their employee number (no account/
 * login needed), reviews their pay, and signs on-screen. Submitting marks
 * that one line paid — the exact same GL posting as the admin-driven pay
 * flow (services/PayrollPayment.js) — and stores the signature so it can
 * be embedded into the downloadable payroll sheet later.
 *
 * Mounted at /api/public/payroll-sign, registered in index.js BEFORE
 * `app.use('/api', authenticateToken)` so these three routes are reached
 * before that middleware ever runs — there is no JWT here, there can't be.
 *
 * This is NOT the same shape as the old pre-multi-tenancy "public"
 * facilities routes that were removed (see the comment above that removal
 * in index.js): that pattern broke because it relied on the ambient
 * tenant-aware models proxy with no request-scoped tenant context, which
 * silently fell back to one default database for every tenant. Every
 * handler here instead resolves its OWN explicit tenant connection from
 * the :code segment in the URL (mirroring exactly how POST /api/auth/login
 * resolves a tenant before any JWT exists) and only ever queries through
 * that connection's own sequelize — never through the ambient proxy.
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { Client } = require('../models/platform');
const { getTenantConnection } = require('../tenantDb');
const tenantContext = require('../tenantContext');
const { payrollSignLimiter } = require('../middleware/rateLimiters');
const { resolvePayrollAccounts, payOnePayrollLine, finalizeRunIfFullyPaid } = require('../services/PayrollPayment');

const MAX_VERIFY_ATTEMPTS = 5;
const TOKEN_MAX_AGE_DAYS = 14;

// Resolves the full tenant connection (not just its sequelize). Every route
// below runs its actual logic inside tenantContext.run(tenantConnection,
// ...) — the same AsyncLocalStorage context authenticateToken establishes
// for a normal logged-in request — because AccountingService (used for the
// real GL posting on /submit) reads its models through the ambient
// tenant-aware proxy in models/index.js, not through an explicitly passed
// connection. With no ALS context at all (true here — there is no JWT and
// authenticateToken never runs), that proxy silently falls back to the
// single default database, so AccountingService would post the payroll
// entry into the WRONG tenant's ledger entirely rather than tenant_demo's.
// Establishing the same context this route resolves its own data through
// makes AccountingService's ambient lookups land in the same schema as
// everything else this request touches.
async function resolveTenantConnection(code) {
  const client = await Client.findOne({ where: { code: String(code || '').trim().toLowerCase() } });
  if (!client || client.status !== 'active') return null;
  return getTenantConnection(client.schema_name);
}

async function findLineByToken(sequelize, token) {
  const [[line]] = await sequelize.query(`
    SELECT prl.*, pr.run_number, pr.period_month, pr.period_year, pr.status AS run_status, pr.clinic_id, pr.run_date,
           pr.payment_account_id AS run_payment_account_id,
           e.employee_number, e.first_name, e.last_name, e.job_title, e.employment_type
    FROM payroll_run_lines prl
    JOIN payroll_runs pr ON pr.id = prl.payroll_run_id
    JOIN employees e ON e.id = prl.employee_id
    WHERE prl.signing_token = :token
  `, { replacements: { token } });
  return line || null;
}

function tokenExpired(line) {
  if (!line.signing_token_created_at) return false;
  const ageMs = Date.now() - new Date(line.signing_token_created_at).getTime();
  return ageMs > TOKEN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

// Status check — deliberately reveals nothing sensitive (no salary, no full
// name) before the employee number is verified. Just enough for the page
// to render something meaningful ("Payroll — March 2026") while it asks.
router.get('/:code/:token', payrollSignLimiter, async (req, res) => {
  try {
    const tenantConnection = await resolveTenantConnection(req.params.code);
    if (!tenantConnection) return res.status(404).json({ error: 'Link not found' });

    await tenantContext.run(tenantConnection, async () => {
      const { sequelize } = tenantConnection;
      const line = await findLineByToken(sequelize, req.params.token);
      if (!line) return res.status(404).json({ error: 'This link is invalid or has expired.' });
      if (tokenExpired(line)) return res.status(410).json({ error: 'This link has expired. Ask HR to generate a new one.' });

      res.json({
        ok: true,
        already_signed: !!line.signed_at,
        run_number: line.run_number,
        period_month: line.period_month,
        period_year: line.period_year,
        locked: (line.signature_verify_attempts || 0) >= MAX_VERIFY_ATTEMPTS,
      });
    });
  } catch (error) {
    console.error('Error checking payroll signing link:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Confirms identity (employee number) and, on success, returns the pay
// breakdown to review before signing. Failed attempts count toward a lock;
// a correct one does not — normal login-style behavior.
router.post('/:code/:token/verify', payrollSignLimiter, async (req, res) => {
  try {
    const tenantConnection = await resolveTenantConnection(req.params.code);
    if (!tenantConnection) return res.status(404).json({ error: 'Link not found' });

    await tenantContext.run(tenantConnection, async () => {
      const { sequelize } = tenantConnection;
      const line = await findLineByToken(sequelize, req.params.token);
      if (!line) return res.status(404).json({ error: 'This link is invalid or has expired.' });
      if (tokenExpired(line)) return res.status(410).json({ error: 'This link has expired. Ask HR to generate a new one.' });
      if (line.signed_at) return res.status(409).json({ error: 'This payment has already been signed for.' });
      if ((line.signature_verify_attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
        return res.status(423).json({ error: 'Too many incorrect attempts. Please contact HR for a new link.' });
      }

      const entered = String(req.body?.employee_number || '').trim().toLowerCase();
      const actual = String(line.employee_number || '').trim().toLowerCase();
      if (!entered || entered !== actual) {
        await sequelize.query(
          `UPDATE payroll_run_lines SET signature_verify_attempts = COALESCE(signature_verify_attempts, 0) + 1, updated_at = NOW() WHERE id = :id`,
          { replacements: { id: line.id } }
        );
        return res.status(401).json({ error: 'Employee number does not match our records.' });
      }

      const [components] = await sequelize.query(
        `SELECT component_type, name, amount FROM payroll_run_line_components WHERE payroll_run_line_id = :id ORDER BY component_type, name`,
        { replacements: { id: line.id } }
      );

      res.json({
        ok: true,
        employee_name: `${line.first_name} ${line.last_name}`,
        employee_number: line.employee_number,
        job_title: line.job_title,
        run_number: line.run_number,
        period_month: line.period_month,
        period_year: line.period_year,
        currency: line.currency,
        basic_salary: line.basic_salary,
        allowances_total: line.allowances_total,
        deductions_total: line.deductions_total,
        gross_pay: line.gross_pay,
        net_pay: line.net_pay,
        components,
      });
    });
  } catch (error) {
    console.error('Error verifying payroll signing link:', error);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// The actual completion: re-verifies the employee number independently
// (never trusts that a prior /verify call succeeded), then pays this one
// line exactly the way the admin-driven flow does, and stores the
// signature against it.
router.post('/:code/:token/submit', payrollSignLimiter, async (req, res) => {
  try {
    const tenantConnection = await resolveTenantConnection(req.params.code);
    if (!tenantConnection) return res.status(404).json({ error: 'Link not found' });

    await tenantContext.run(tenantConnection, async () => {
      const { sequelize } = tenantConnection;
      const line = await findLineByToken(sequelize, req.params.token);
      if (!line) return res.status(404).json({ error: 'This link is invalid or has expired.' });
      if (tokenExpired(line)) return res.status(410).json({ error: 'This link has expired. Ask HR to generate a new one.' });
      if (line.signed_at || line.status === 'paid') return res.status(409).json({ error: 'This payment has already been signed for.' });
      if ((line.signature_verify_attempts || 0) >= MAX_VERIFY_ATTEMPTS) {
        return res.status(423).json({ error: 'Too many incorrect attempts. Please contact HR for a new link.' });
      }
      if (line.run_status !== 'approved') {
        return res.status(409).json({ error: 'This payroll run is no longer open for payment. Please contact HR.' });
      }

      const entered = String(req.body?.employee_number || '').trim().toLowerCase();
      const actual = String(line.employee_number || '').trim().toLowerCase();
      if (!entered || entered !== actual) {
        await sequelize.query(
          `UPDATE payroll_run_lines SET signature_verify_attempts = COALESCE(signature_verify_attempts, 0) + 1, updated_at = NOW() WHERE id = :id`,
          { replacements: { id: line.id } }
        );
        return res.status(401).json({ error: 'Employee number does not match our records.' });
      }

      const signature = req.body?.signature;
      if (!signature || typeof signature !== 'string' || !signature.startsWith('data:image/')) {
        return res.status(400).json({ error: 'A signature is required.' });
      }
      // A signature image can legitimately run a few hundred KB — cap well
      // above that so this can't be used to smuggle an oversized payload in,
      // while still leaving normal signing untouched.
      if (signature.length > 2 * 1024 * 1024) {
        return res.status(400).json({ error: 'Signature image is too large.' });
      }

      if (!line.run_payment_account_id) {
        return res.status(400).json({ error: 'No payment account is set for this payroll run. Please contact HR.' });
      }

      const [[baseCurrencyRow]] = await sequelize.query(`SELECT code FROM currencies WHERE is_base_currency = TRUE LIMIT 1`);
      const baseCurrency = baseCurrencyRow?.code || 'USD';
      const accounts = await resolvePayrollAccounts(line.clinic_id);
      if (!accounts.salariesAccount || !accounts.doctorFeesAccount || !accounts.payrollLiabilitiesAccount) {
        return res.status(500).json({ error: 'Payroll accounts are not set up. Please contact HR.' });
      }

      const run = { run_number: line.run_number, run_date: line.run_date };
      const glEntry = await payOnePayrollLine(sequelize, line.clinic_id, run, line, accounts, baseCurrency, line.run_payment_account_id, null);
      await finalizeRunIfFullyPaid(sequelize, line.payroll_run_id, null);

      await sequelize.query(
        `UPDATE payroll_run_lines SET signature_data = :signature, signed_at = NOW(), updated_at = NOW() WHERE id = :id`,
        { replacements: { id: line.id, signature } }
      );

      try {
        const rr = require('./reports');
        await rr.logAudit({
          user_id: null, user_name: `${line.first_name} ${line.last_name} (self-service)`, user_role: 'employee',
          module: 'HR', action: 'PAYROLL_LINE_SIGNED', entity_type: 'PayrollRunLine', entity_id: line.id,
          description: `Payroll ${line.run_number} — ${line.first_name} ${line.last_name} self-confirmed and signed for payment, GL entry ${glEntry.gl_number}`,
          status: 'success',
        });
      } catch (e) { /* non-blocking */ }

      res.json({
        ok: true,
        employee_name: `${line.first_name} ${line.last_name}`,
        net_pay: line.net_pay,
        currency: line.currency,
        run_number: line.run_number,
      });
    });
  } catch (error) {
    console.error('Error submitting payroll signature:', error);
    res.status(500).json({ error: error.message || 'Something went wrong. Please try again or contact HR.' });
  }
});

module.exports = router;
