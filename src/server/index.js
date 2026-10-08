// ⚠️ MUST be first — load env vars before any other require
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '.env') });        // src/server/.env
dotenv.config({ path: path.resolve(__dirname, 'production.env') }); // src/server/production.env
dotenv.config({ path: path.resolve(process.cwd(), '.env') });    // nodejs root .env

const express = require('express');
const cors = require('cors');
const compression = require('compression');
const { initializeDatabase } = require('./models');

// Redis-backed response cache (falls back to in-memory when Redis is not configured)
const redisCacheMiddleware = require('./middleware/redisCacheMiddleware');

// Create Express app
const app = express();
const PORT = process.env.PORT || 3002;

// Trust the first hop's X-Forwarded-* headers — needed behind a reverse
// proxy (Hostinger, Render, etc.) so express-rate-limit sees the real client
// IP instead of throwing on an unexpected X-Forwarded-For header, and so
// req.ip/req.secure reflect the actual client rather than the proxy.
app.set('trust proxy', 1);

// CORS configuration.
//
// Two things here are deliberate and were both previously wrong:
//
//  1. The server's OWN origin is always allowed. Vite emits its asset tags with
//     `crossorigin`, so the browser fetches index.css / index.js in CORS mode
//     with an Origin header. When the deployed hostname wasn't on the allowlist
//     the app 500'd on its own stylesheet and rendered a blank page — while curl
//     (which sends no Origin) returned 200, hiding it. Comparing against the
//     request's Host means this can never depend on remembering to set an env
//     var after a rename or a new deploy target.
//
//  2. A disallowed origin is answered WITHOUT CORS headers, not with a thrown
//     error. Throwing hands the request to the error handler, which turns a
//     routine policy decision into a 500 on every asset. Omitting the header is
//     what actually enforces the policy — the browser blocks the read itself.
const STATIC_ALLOWED = [
  'https://intellicare-obc.vercel.app',
  'https://intellicare.nilehc.tech',
];

function isAllowedOrigin(origin, req) {
  if (!origin) return true; // non-browser / server-to-server

  // Same-origin: the browser is asking this very server for its own files.
  const host = req && (req.headers['x-forwarded-host'] || req.headers.host);
  if (host) {
    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
    if (origin === `${proto}://${host}` || origin === `https://${host}` || origin === `http://${host}`) {
      return true;
    }
  }

  // Render sets this for every service; covers the origin even on a request
  // that arrives without a usable Host header.
  const renderHost = process.env.RENDER_EXTERNAL_HOSTNAME;
  if (renderHost && (origin === `https://${renderHost}` || origin === `http://${renderHost}`)) return true;

  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  if (/^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/.test(origin)) return true;

  // CORS_ORIGIN may be a single origin or a comma-separated list.
  const extra = (process.env.CORS_ORIGIN || '').split(',').map((o) => o.trim()).filter(Boolean);
  return [...STATIC_ALLOWED, ...extra].includes(origin);
}

// Delegate form (req, callback) rather than the plain options object, because
// the same-origin check above needs to see the request's Host.
const corsOptions = (req, callback) => {
  callback(null, {
    origin: isAllowedOrigin(req.header('Origin'), req),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Branch-ID'],
    optionsSuccessStatus: 200,
  });
};

app.use(compression());
app.use(cors(corsOptions));
// Explicitly handle all CORS preflight requests before any other middleware.
// This ensures OPTIONS responses always carry the correct headers even if the
// DB is still initialising or a route throws during startup.
app.options('*', cors(corsOptions));
// 10mb, not the 100kb express defaults to.
//
// Several payloads legitimately carry an inline data URI — the facility logo
// (Setup > Facility) and user signatures — because documents are printed from
// a window that carries no auth and so cannot fetch an image from a protected
// endpoint. A 512px PNG data URI is routinely 100-400kb, which the default
// limit rejected before the route ever ran: saving a facility with a logo
// failed with a bare 500 (PayloadTooLargeError) and no usable message.
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || '10mb';
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_BODY_LIMIT }));

// Say so plainly when a body really is too big, rather than letting it surface
// as an unexplained 500.
app.use((err, req, res, next) => {
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({
      error: 'That upload is too large',
      details: `Request body exceeds the ${JSON_BODY_LIMIT} limit. If this is an image, use a smaller one.`,
    });
  }
  return next(err);
});

const currenciesRouter = require('./routes/currencies');
const facilitiesRouter = require('./routes/facilities');

// NOTE: /api/facilities/branches/all and /api/facilities/name used to be
// declared here, ahead of `app.use('/api', authenticateToken)`, so that the
// login page could read them without a token. That predates multi-tenancy and
// had become actively wrong:
//
//   - Running before authenticateToken means no tenant context, so the models
//     proxy fell back to the DEFAULT connection — the tenant_template schema.
//     Creating a branch (authenticated, correct schema) then listing them
//     (unauthenticated, template schema) returned an empty list, which looked
//     exactly like "it said success but the branch never appeared".
//   - Being declared on `app` ahead of the router, they SHADOWED the
//     tenant-aware handlers in routes/facilities.js, which could never run.
//   - "Public" is meaningless per-tenant anyway: with no token there is no
//     instance code, so the response could only ever be one arbitrary schema's
//     data served to anyone who asked.
//
// Nothing needs them unauthenticated — Login.tsx calls neither, and every real
// caller (FacilitySetup, Security, useFacilityInfo) is behind auth. They are
// now served by facilitiesRouter, mounted after authenticateToken.

// Public payroll-signing flow (QR code an employee scans on their own
// phone, no login) — mounted here, ahead of authenticateToken, same as
// verify-branch-access below. Unlike that pattern this one is NOT the
// ambient-tenant-proxy anti-pattern described above: every handler in
// publicPayroll.js resolves its own explicit tenant connection from a
// :code segment in the URL (mirrors POST /api/auth/login), so it never
// touches the ambient proxy or depends on any tenant context existing.
app.use('/api/public/payroll-sign', require('./routes/publicPayroll'));

// Branch verification endpoint must be public for login page
const bcrypt = require('bcrypt');
const { User } = require('./models');
const { authLimiter, passwordResetLimiter } = require('./middleware/rateLimiters');
app.post('/api/auth/verify-branch-access', authLimiter, async (req, res) => {
  try {
    const { email, password, branchId } = req.body;
    const { sequelize } = require('./models');

    if (!email || !password || !branchId) {
      return res.status(400).json({ error: 'Email, password, and branch are required' });
    }

    const user = await User.findOne({ where: { email: email.toLowerCase() } });
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    try {
      const [userBranches] = await sequelize.query(`
        SELECT ub.branch_id FROM user_branches ub
        WHERE ub.user_id = ? AND ub.branch_id = ? LIMIT 1
      `, { replacements: [user.id, branchId] });

      if (userBranches.length > 0 || user.branch_id === parseInt(branchId) || user.role === 'admin') {
        return res.json({ success: true, message: 'Branch access verified' });
      }

      return res.status(403).json({ 
        error: 'You do not have access to the selected branch. Please contact your administrator.' 
      });
    } catch (branchError) {
      console.error('Branch verification error:', branchError);
      if (user.branch_id) {
        return res.json({ success: true, message: 'Branch access verified (fallback)' });
      }
      return res.status(403).json({ error: 'Unable to verify branch access' });
    }
  } catch (error) {
    console.error('Branch access verification error:', error);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// Password reset endpoints must be public (before auth middleware) — which also means
// there's no JWT yet to say which tenant this is for, so (like /login) they take the
// instance `code` directly and resolve that tenant's own connection via getTenantConnection,
// instead of the bare `require('./models')` these used before, which — with no tenant
// context active on a public route — always silently resolved to the single default
// tenant's database. That made this only ever work for the default tenant; every other
// tenant's forgot-password request would run its query against the wrong database, find no
// user, and return the same generic "if an account exists" response whether or not one
// actually did. Also fixes a second, independent bug: `$1`/`bind` is Postgres bound-parameter
// syntax and was never valid against this app's MySQL — every one of these queries was
// throwing a SQL syntax error before either bug was ever exercised, caught by the outer
// try/catch and surfaced as a generic 500.
const crypto = require('crypto');
const { sendPasswordResetEmail } = require('./utils/emailService');

app.post('/api/auth/forgot-password', passwordResetLimiter, async (req, res) => {
  try {
    const { code, email } = req.body;

    if (!code || !email) {
      return res.status(400).json({ error: 'Instance code and email are required' });
    }

    const { Client } = require('./models/platform');
    const client = await Client.findOne({ where: { code: String(code).trim().toLowerCase() } });
    if (!client) {
      return res.status(401).json({ error: 'Unknown instance code' });
    }

    const { getTenantConnection } = require('./tenantDb');
    const { sequelize, models } = await getTenantConnection(client.schema_name);

    const user = await models.User.findOne({ where: { email: email.toLowerCase() } });

    if (!user) {
      return res.json({
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.'
      });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await sequelize.query(`
      INSERT INTO password_reset_tokens (user_id, token, expires_at, used)
      VALUES (?, ?, ?, FALSE)
    `, {
      replacements: [user.id, resetToken, expiresAt]
    });

    const emailResult = await sendPasswordResetEmail(email, resetToken, user.display_name || user.email, client.code);
    if (!emailResult.delivered) {
      // Client response stays generic on purpose (never confirm/deny account
      // existence via delivery status), but a real non-delivery needs to be
      // visible server-side instead of silently indistinguishable from success.
      console.error(`Password reset email NOT delivered for ${email} (mode: ${emailResult.mode}${emailResult.error ? `, error: ${emailResult.error}` : ''})`);
    }

    res.json({
      success: true,
      message: 'If an account exists with this email, a password reset link has been sent.'
    });
  } catch (error) {
    console.error('Password reset request error:', error);
    res.status(500).json({ error: 'Failed to process password reset request' });
  }
});

app.get('/api/auth/verify-reset-token/:token', passwordResetLimiter, async (req, res) => {
  try {
    const { token } = req.params;
    const { code } = req.query;
    if (!code) {
      return res.status(400).json({ error: 'Instance code is required' });
    }

    const { Client } = require('./models/platform');
    const client = await Client.findOne({ where: { code: String(code).trim().toLowerCase() } });
    if (!client) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const { getTenantConnection } = require('./tenantDb');
    const { sequelize } = await getTenantConnection(client.schema_name);

    const [tokens] = await sequelize.query(`
      SELECT * FROM password_reset_tokens
      -- IS NOT TRUE, not = FALSE. The column is nullable with no default, so a
      -- freshly inserted token has used = NULL, and NULL = FALSE evaluates to
      -- NULL rather than true — the row never matched and every reset link came
      -- back "invalid or expired". IS NOT TRUE covers both NULL and false, and
      -- repairs tokens already issued.
      WHERE token = ? AND used IS NOT TRUE AND expires_at > NOW()
      LIMIT 1
    `, {
      replacements: [token]
    });

    if (tokens.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    res.json({ success: true, valid: true });
  } catch (error) {
    console.error('Token verification error:', error);
    res.status(500).json({ error: 'Failed to verify token' });
  }
});

app.post('/api/auth/reset-password', passwordResetLimiter, async (req, res) => {
  try {
    const { token, code, newPassword } = req.body;

    if (!token || !code || !newPassword) {
      return res.status(400).json({ error: 'Token, instance code, and new password are required' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters long' });
    }

    const { Client } = require('./models/platform');
    const client = await Client.findOne({ where: { code: String(code).trim().toLowerCase() } });
    if (!client) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const { getTenantConnection } = require('./tenantDb');
    const { sequelize, models } = await getTenantConnection(client.schema_name);

    const [tokens] = await sequelize.query(`
      SELECT * FROM password_reset_tokens
      -- IS NOT TRUE, not = FALSE. The column is nullable with no default, so a
      -- freshly inserted token has used = NULL, and NULL = FALSE evaluates to
      -- NULL rather than true — the row never matched and every reset link came
      -- back "invalid or expired". IS NOT TRUE covers both NULL and false, and
      -- repairs tokens already issued.
      WHERE token = ? AND used IS NOT TRUE AND expires_at > NOW()
      LIMIT 1
    `, {
      replacements: [token]
    });

    if (tokens.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const resetToken = tokens[0];
    const user = await models.User.findByPk(resetToken.user_id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await user.update({ password_hash: hashedPassword });

    await sequelize.query(`
      UPDATE password_reset_tokens
      SET used = TRUE
      WHERE token = ?
    `, {
      replacements: [token]
    });

    res.json({
      success: true,
      message: 'Password has been reset successfully. You can now login with your new password.'
    });
  } catch (error) {
    console.error('Password reset error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Authentication middleware scoped to /api only — static files served without auth
const { authenticateToken } = require('./middleware/auth');
const { branchAccessControl } = require('./middleware/branchAccessControl');
app.use('/api', authenticateToken);
app.use('/api', branchAccessControl);
// Redis cache runs after auth — keys include userId+branchId, no cross-user data leaks
app.use('/api', redisCacheMiddleware());

// Startup: add branch_id to tables that are missing it.
// MySQL 8 doesn't support "ADD COLUMN IF NOT EXISTS" or "CREATE INDEX IF NOT EXISTS"
// (both are silent no-ops on Postgres/MariaDB but a hard syntax error on MySQL) — this
// used to use that syntax, so it threw immediately on every single table, every startup,
// and the surrounding try/catch swallowed it silently. In practice this meant branch_id
// was never actually added to whichever tables hadn't picked it up some other way,
// and every INSERT that referenced branch_id on one of those tables 500'd at request
// time instead (e.g. POST /inventory/physical-counts). Checking information_schema
// first is the correct MySQL-safe idempotent pattern (see also patient_bills.visit_id
// above in patientBills.js, which uses the same approach).
(async () => {
  try {
    const { sequelize: _sq } = require('./models');
    const tablesNeedingBranchId = [
      'dispensing_records', 'lab_requests', 'lab_results',
      'patient_bills', 'invoices', 'patient_queue',
      'insurance_claims', 'pharmacy_prescriptions',
      'inventory_batches', 'inventory_transactions', 'inventory_adjustments',
      'physical_inventory_counts', 'stock_locations',
      'dispensing_returns', 'pharmacy_charges'
    ];
    let added = 0;
    for (const tbl of tablesNeedingBranchId) {
      try {
        // Postgres COUNT(*) comes back as the string "0"/"1" (bigint), which
        // is truthy in JS either way — a bare `if (x.cnt)` silently does the
        // opposite of what it looks like. Found while building the equivalent
        // per-tenant migration in ensureBranchIsolationColumns.js; this loop
        // had the identical bug, so tables it hadn't already reached before
        // this fix were silently never getting branch_id added.
        const [[tableCheck]] = await _sq.query(
          `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = :tbl`,
          { replacements: { tbl } }
        );
        if (Number(tableCheck.cnt) === 0) continue; // table doesn't exist yet

        const [[colCheck]] = await _sq.query(
          `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = :tbl AND column_name = 'branch_id'`,
          { replacements: { tbl } }
        );
        if (Number(colCheck.cnt) > 0) continue; // already has it

        await _sq.query(`ALTER TABLE ${tbl} ADD COLUMN branch_id INTEGER NULL`);

        const [[idxCheck]] = await _sq.query(
          `SELECT COUNT(*) AS cnt FROM pg_indexes WHERE schemaname = current_schema() AND tablename = :tbl AND indexname = :idx`,
          { replacements: { tbl, idx: `idx_${tbl.replace(/_/g, '')}_branch` } }
        );
        if (Number(idxCheck.cnt) === 0) {
          await _sq.query(`CREATE INDEX idx_${tbl.replace(/_/g, '')}_branch ON ${tbl}(branch_id)`);
        }
        added++;
      } catch (e) { console.warn(`Branch migration warning for ${tbl}:`, e.message); }
    }
    console.log(`✅ Branch ID columns ensured on all key tables${added > 0 ? ` (added to ${added} table(s) this run)` : ''}`);
  } catch(e) { console.warn('Branch migration warning:', e.message); }
})();

// Startup: link inpatient_prescriptions to the prescription_lines row Pharmacy dispenses
// against, so the ward UI can tell whether a drug has actually left the pharmacy yet.
(async () => {
  try {
    const { sequelize: _sq } = require('./models');
    const [[colCheck]] = await _sq.query(
      `SELECT COUNT(*) AS cnt FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'inpatient_prescriptions' AND column_name = 'pharmacy_line_id'`
    );
    if (!colCheck.cnt) {
      await _sq.query(`ALTER TABLE inpatient_prescriptions ADD COLUMN pharmacy_line_id CHAR(36) NULL`);
      console.log('✅ inpatient_prescriptions.pharmacy_line_id added');
    }
  } catch (e) { console.warn('inpatient_prescriptions.pharmacy_line_id migration warning:', e.message); }
})();

// Startup: auto-link services to Chart of Accounts revenue accounts by category
(async () => {
  try {
    const { sequelize: _sq } = require('./models');
    // Map service categories to account codes
    const categoryMap = [
      { pattern: 'lab',        code: '4110' },
      { pattern: 'laboratory', code: '4110' },
      { pattern: 'diagnostic', code: '4110' },
      { pattern: 'pharmacy',   code: '4120' },
      { pattern: 'drug',       code: '4120' },
      { pattern: 'medication', code: '4120' },
      { pattern: 'radiology',  code: '4130' },
      { pattern: 'imaging',    code: '4130' },
      { pattern: 'xray',       code: '4130' },
      { pattern: 'scan',       code: '4130' },
      { pattern: 'procedure',  code: '4140' },
      { pattern: 'surgery',    code: '4140' },
      { pattern: 'theater',    code: '4140' },
      { pattern: 'theatre',    code: '4140' },
    ];
    // Apply specific category mappings (overrides any previous default mapping)
    for (const { pattern, code } of categoryMap) {
      await _sq.query(`
        UPDATE services s
        SET revenue_account_id = coa.id::text
        FROM chart_of_accounts coa
        WHERE coa.account_code = '${code}'
          AND (LOWER(s.category) LIKE '%${pattern}%' OR LOWER(s.service_category) LIKE '%${pattern}%')
      `).catch(() => {});
    }
    // Default: link any still-unlinked services to Patient Services Revenue (4100)
    await _sq.query(`
      UPDATE services s
      SET revenue_account_id = coa.id::text
      FROM chart_of_accounts coa
      WHERE coa.account_code = '4100'
        AND (s.revenue_account_id IS NULL OR s.revenue_account_id = '')
    `).catch(() => {});
    console.log('✅ Services linked to Chart of Accounts revenue accounts');
  } catch(e) { console.warn('Service-CoA link warning:', e.message); }
})();

// Global mutation cache-buster: after any successful POST/PUT/PATCH/DELETE,
// wipe every cached GET response for the whole tenant.
//
// This used to clear only the key prefix containing the *mutating* user's id,
// which meant a write was invisible to everybody else until the 60s TTL ran
// out. Registering a patient at reception left the pharmacist's cached patient
// list untouched, so the new patient could not be found on the dispensing or
// billing picker for up to a minute — the "names sometimes load, sometimes
// don't" that only a re-login (by which time the entry had expired anyway)
// appeared to fix. Cached data is shared, so invalidation has to be too.
const redisCache = require('./services/RedisCache');
app.use((req, res, next) => {
  if (req.method === 'GET') return next();
  const originalJson = res.json.bind(res);
  res.json = function(data) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const schemaName = req.tenantSchema || 'default';
      redisCache.delPattern('ic|' + schemaName + '|').catch(() => {});
    }
    return originalJson(data);
  };
  next();
});

// Import route handlers
const usersRouter = require('./routes/users');
const notificationsRouter = require('./routes/notifications');
const patientsRouter = require('./routes/patients');
const labTestsRouter = require('./routes/labTests');
const authRouter = require('./routes/auth');
const patientQueueRouter = require('./routes/patientQueue');
const dashboardRouter = require('./routes/dashboard');
const clinicalRouter = require('./routes/clinical');
const pharmacyRouter = require('./routes/pharmacy');
const patientBillsRouter = require('./routes/patientBills');
const patientDepositsRouter = require('./routes/patientDeposits');
const proformaInvoicesRouter = require('./routes/proformaInvoices');
const clinicsRouter = require('./routes/clinics');
const servicesRouter = require('./routes/services');
const departmentsRouter = require('./routes/departments');
const receiptsRouter = require('./routes/receipts');
const visitsRouter = require('./routes/visits');
const ledgerAccountsRouter = require('./routes/ledger-accounts');
const cashierRouter = require('./routes/cashier');
const cashTransfersRouter = require('./routes/cash-transfers');
const purchaseOrdersRouter = require('./routes/purchase-orders');
const dailyExpensesRouter = require('./routes/daily-expenses');
// facilitiesRouter already required at line 52 for public branches endpoint
const accountingRouter = require('./routes/accounting');
const procurementRouter = require('./routes/procurement');
const approvalsRouter = require('./routes/approvals');
const rolesRouter = require('./routes/roles');
const inventoryRouter = require('./routes/inventory');
const pharmacyModuleRouter = require('./routes/pharmacyModule');
const billingEnhancedRouter = require('./routes/billingEnhanced');
const schemesRouter = require('./routes/schemes');
const invoicesRouter = require('./routes/invoices');
const documentsRouter = require('./routes/documents');
const insuranceClaimsRouter = require('./routes/insuranceClaims');
const exchangeRatesRouter = require('./routes/exchangeRates');
const inpatientRouter = require('./routes/inpatient');
const lisModuleRouter = require('./routes/lisModule');
const radiologyRouter = require('./routes/radiology');
const clinicalInsightsRouter = require('./routes/clinicalInsights');
const patientReferralsRouter = require('./routes/patientReferrals');
const nursingProceduresRouter = require('./routes/nursingProcedures');
const antenatalRouter = require('./routes/antenatal');
const appointmentsRouter = require('./routes/appointments');
const chiefComplaintsRouter = require('./routes/chiefComplaints');
const clinicalDiagnosesRouter = require('./routes/clinicalDiagnoses');
const icd10Router = require('./routes/icd10');

// Import lab routes
const labRequestsRouter = require('./routes/labRequests');
const labResultsRouter = require('./routes/labResults');
const labIntegrationRouter = require('./routes/labIntegration');
const apiConfigurationsRouter = require('./routes/apiConfigurations');

// Platform admin routes (SaaS layer — create/suspend clients, manage billing).
// Authenticated separately from every tenant route above (see
// middleware/platformAuth.js) and mounted before the global authenticateToken
// bypass check runs, so /api/platform/* never touches tenant data.
const platformAuthRouter = require('./routes/platform/auth');
const platformClientsRouter = require('./routes/platform/clients');
const platformPlansRouter = require('./routes/platform/plans');
const platformBillingRouter = require('./routes/platform/billing');
const platformDashboardRouter = require('./routes/platform/dashboard');
const platformAdminsRouter = require('./routes/platform/admins');
const platformCustomersRouter = require('./routes/platform/customers');
const platformQuotationsRouter = require('./routes/platform/quotations');
const platformCompanyProfileRouter = require('./routes/platform/company-profile');
const platformQuotationInvoicesRouter = require('./routes/platform/quotation-invoices');

// API Routes
app.use('/api/platform/auth', platformAuthRouter);
app.use('/api/platform/clients', platformClientsRouter);
app.use('/api/platform/plans', platformPlansRouter);
app.use('/api/platform/billing', platformBillingRouter);
app.use('/api/platform/dashboard', platformDashboardRouter);
app.use('/api/platform/admins', platformAdminsRouter);
app.use('/api/platform/customers', platformCustomersRouter);
app.use('/api/platform/quotations', platformQuotationsRouter);
app.use('/api/platform/company-profile', platformCompanyProfileRouter);
app.use('/api/platform/quotation-invoices', platformQuotationInvoicesRouter);
app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/patients', patientsRouter);
app.use('/api/lab-tests', labTestsRouter);
app.use('/api/lab-requests', labRequestsRouter);
app.use('/api/lab-results', labResultsRouter);
app.use('/api/lab-integration', labIntegrationRouter);
app.use('/api/configurations', apiConfigurationsRouter);
app.use('/api/patient-queue', patientQueueRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/clinical', clinicalRouter);
app.use('/api/pharmacy', pharmacyRouter);
app.use('/api/patient-bills', patientBillsRouter);
app.use('/api/patient-deposits', patientDepositsRouter);
app.use('/api/proforma-invoices', proformaInvoicesRouter);
app.use('/api/clinics', clinicsRouter);
app.use('/api/services', servicesRouter);
app.use('/api/departments', departmentsRouter);
app.use('/api/receipts', receiptsRouter);
app.use('/api/visits', visitsRouter);
app.use('/api/reports-v2/patients', require('./routes/reportPatients'));
app.use('/api/reports-v2/billing-by-user', require('./routes/reportBillingByUser'));
app.use('/api/reports-v2/laboratory', require('./routes/reportLaboratory'));
app.use('/api/reports-v2/pharmacy', require('./routes/reportPharmacy'));
app.use('/api/reports-v2/inventory', require('./routes/reportInventory'));
app.use('/api/reports-v2/income-statement', require('./routes/reportIncomeStatement'));
app.use('/api/reports-v2/overview', require('./routes/reportOverview'));
app.use('/api/reports-v2/ar-aging', require('./routes/reportARAging'));
app.use('/api/reports-v2/clinic-performance', require('./routes/reportClinicPerformance'));
app.use('/api/reports-v2/doctor-performance', require('./routes/reportDoctorPerformance'));
app.use('/api/reports-v2/occupancy', require('./routes/reportOccupancy'));
app.use('/api/reports-v2/dhis2', require('./routes/reportDhis2'));
app.use('/api/fixed-assets', require('./routes/fixedAssets'));
app.use('/api/theatre', require('./routes/theatre'));
app.use('/api/reports-v2/cancelled-transactions', require('./routes/reportCancelledTransactions'));
app.use('/api/reports-v2/audit-summary', require('./routes/reportAuditSummary'));
app.use('/api/ledger-accounts', ledgerAccountsRouter);
app.use('/api/cashier', cashierRouter);
app.use('/api/cash-transfers', cashTransfersRouter);
app.use('/api/purchase-orders', purchaseOrdersRouter);
app.use('/api/daily-expenses', dailyExpensesRouter);
app.use('/api/hr', require('./routes/hr'));
app.use('/api/hr/salary-advances', require('./routes/salaryAdvances'));
app.use('/api/hr/leave', require('./routes/leave'));
app.use('/api/facilities', facilitiesRouter);

// Was mounted before authenticateToken (see the facilities note above for the
// exact same bug, already diagnosed and fixed there): with no tenant context,
// the models proxy fell back to the default connection — tenant_template —
// so every tenant's currency picker actually showed template's currencies
// (including UGX, which template has active but most real tenants never
// added) instead of their own. Same fix: mount after auth like every other
// tenant-scoped route.
app.use('/api/currencies', currenciesRouter);

// Database diagnostic route
app.get('/api/test-db', async (req, res) => {
  try {
    const { Sequelize } = require('sequelize');
    const sequelize = new Sequelize(process.env.DATABASE_URL, {
      dialect: 'mysql',
      dialectOptions: {
        charset: 'utf8mb4',
        collate: 'utf8mb4_0900_ai_ci'
      },
      logging: false
    });
    
    await sequelize.authenticate();
    res.json({
      success: true,
      message: 'Database connection successful!',
      databaseUrl: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@') : 'Not Set',
      env_db_host: process.env.DB_HOST,
      env_db_user: process.env.DB_USER,
      env_db_name: process.env.DB_NAME
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Database connection failed',
      error_name: error.name,
      error_message: error.message,
      error_stack: error.stack,
      databaseUrl: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@]*@/, ':***@') : 'Not Set',
      env_db_host: process.env.DB_HOST,
      env_db_user: process.env.DB_USER,
      env_db_name: process.env.DB_NAME
    });
  }
});

app.use('/api/accounting', accountingRouter);
app.use('/api/procurement', procurementRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/roles', rolesRouter);
app.use('/api/inventory', inventoryRouter);
app.use('/api/pharmacy-module', pharmacyModuleRouter);
app.use('/api/billing-enhanced', billingEnhancedRouter);
app.use('/api/billing', billingEnhancedRouter);
app.use('/api/schemes', schemesRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/documents', documentsRouter);
app.use('/api/insurance-claims', insuranceClaimsRouter);
app.use('/api/exchange-rates', exchangeRatesRouter);
app.use('/api/inpatient', inpatientRouter);
app.use('/api/lis', lisModuleRouter);
app.use('/api/radiology', radiologyRouter);
app.use('/api/lis/orders', clinicalInsightsRouter);
app.use('/api/patient-referrals', patientReferralsRouter);
app.use('/api/nursing-procedures', nursingProceduresRouter);
app.use('/api/antenatal', antenatalRouter);
app.use('/api/appointments', appointmentsRouter);
app.use('/api/chief-complaints', chiefComplaintsRouter);
app.use('/api/clinical-diagnoses', clinicalDiagnosesRouter);
app.use('/api/icd10', icd10Router);

// Health check endpoint — also used by keep-alive cron job to prevent Render cold starts
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    service: 'IntelliCare Backend API',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    uptime: Math.round(process.uptime()),
    cache: process.env.REDIS_ENABLED === 'true' ? 'redis' : 'memory',
  });
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'running',
    database: 'connected',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

// Serve React frontend (production) or return JSON 404 (development)
if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '../../dist');

  // Vite fingerprints every asset, so they can be cached forever — but
  // index.html must never be, because it is what names the current build's
  // assets. A cached index.html pointing at a previous deploy's filenames is
  // exactly how you get "refused to apply style ... MIME type" and 404s on
  // /assets/* right after a deploy: the browser asks for files that no longer
  // exist and gets the SPA shell back instead.
  app.use(express.static(distPath, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('index.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      } else if (filePath.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      }
    },
  }));

  // Anything that looks like a file must 404 rather than fall through to the
  // SPA shell. Handing HTML back for a missing .css/.js makes the browser
  // reject it with a confusing MIME-type error instead of a plain "not found".
  const STATIC_FILE = /\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|webp|avif|woff2?|ttf|eot|json|txt|xml|csv|pdf|webmanifest)$/i;
  app.get('*', (req, res) => {
    if (req.path.startsWith('/assets/') || STATIC_FILE.test(req.path)) {
      return res.status(404).end();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
} else {
  app.use('*', (req, res) => {
    res.status(404).json({ error: 'Route not found' });
  });
}

// ── Background migration runner ──────────────────────────────────────────────
// Runs ALL migrations after the server is already accepting connections.
// This means cold-start time drops from ~60-120s to ~2-3s.
async function runBackgroundMigrations() {
  console.log('⏳ Running background migrations (non-blocking)...');

  const migrations = [
    // Runs first — every accounting posting path (bills, payments, deposits,
    // receipts, theatre, fixed assets) needs document_number_counters to exist
    // before it can allocate a GL/JE number.
    ['DocumentNumberCounters', () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateDocumentNumberCounters').migrateDocumentNumberCounters, 'Document Number Counters'
    )],
    // Performance/correctness audit finding: these 12 migrations (every
    // non-ICD10 entry below) were called with no connection argument at
    // all, which — like PerfIndexes/Theatre/FixedAssets before this session
    // found and fixed the same bug for them — means they only ever reached
    // the default tenant_template connection, never an already-provisioned
    // real tenant. migrateAcrossTenants now runs each one inside the same
    // AsyncLocalStorage tenant context every request handler uses (see its
    // own updated comment), which fixes this regardless of whether the
    // migration function itself accepts a `db` parameter — most of these
    // don't, and still work correctly through the ambient context. Icd10Reference
    // is deliberately left unwrapped: its own default parameter is
    // platformSequelize, a single shared reference table, not one copy per
    // tenant — looping it per-tenant would be wrong, not just redundant.
    ['Accounting',        () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateAccountingTables').setupAccountingModule, 'Accounting'
    )],
    ['CashTransfers',     () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateCashTransfers').migrateCashTransfers, 'Cash Transfers'
    )],
    ['Procurement',       () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateProcurementTables').migrateProcurementTables, 'Procurement'
    )],
    ['Inventory',         () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateInventoryTables').migrateInventoryTables, 'Inventory'
    )],
    ['Pharmacy',          () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migratePharmacyTables').migratePharmacyTables, 'Pharmacy'
    )],
    ['Billing',           () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateBillingEnhancements').migrateBillingEnhancements, 'Billing'
    )],
    ['Schemes',           () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateSchemes').migrateSchemes, 'Schemes'
    )],
    ['Invoices',          () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateInvoices').migrateInvoiceTables, 'Invoices'
    )],
    ['InsuranceClaims',   () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateInsuranceClaims'), 'Insurance Claims'
    )],
    ['MultiCurrency',     () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateMultiCurrency').migrateMultiCurrency, 'Multi-Currency'
    )],
    ['Inpatient',         () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateInpatientTables').migrateInpatientTables, 'Inpatient'
    )],
    ['Radiology',         () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateRadiologyModule').migrateRadiologyModule, 'Radiology'
    )],
    ['Dhis2Report',       () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateDhis2Tables').migrateDhis2Tables, 'Dhis2 Report'
    )],
    ['Icd10Reference',    () => require('./scripts/importIcd10').migrateAndImportIcd10()],
    ['VisitDiagnoses',    () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateVisitDiagnosesTable').migrateVisitDiagnosesTable, 'Visit Diagnoses'
    )],
    // Every other step here only ever touches the default/tenant_template
    // connection, which is why real tenants (dpoc/demo/gudele/nationmc) needed
    // runFixedAssetsMigrationEverywhere.js run by hand after this module shipped
    // — and why production kept 500ing on "column acquisition_currency does not
    // exist" after the currency columns were added on top of it. Looping this
    // one across every real tenant (migrateAcrossTenants already exists for
    // exactly this) means a fresh deploy self-heals every tenant automatically
    // instead of relying on someone remembering the manual script.
    ['FixedAssets',       () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateFixedAssetsTables').migrateFixedAssetsTables, 'Fixed Assets'
    )],
    ['Theatre',           () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateTheatreTables').migrateTheatreTables, 'Theatre'
    )],
    // Same reasoning as FixedAssets/Theatre above: adding a new essential
    // account code only seeds it for brand-new tenants, so this loops the
    // self-heal across every real tenant on each deploy instead of relying
    // on a manually-run script against dpoc/demo/gudele/nationmc.
    ['DailyExpenseAccounts', () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/ensureDailyExpenseAccounts').ensureDailyExpenseAccounts, 'Daily Expense Accounts'
    )],
    ['Departments',       () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/migrateDepartments'), 'Departments'
    )],
    // Was default-connection-only (so tenant_template only) — these never
    // reached any already-provisioned real tenant. Same self-heal pattern as
    // FixedAssets/Theatre above.
    ['PerfIndexes',       () => require('./scripts/migrateAcrossTenants').migrateAcrossTenants(
      require('./scripts/addPerformanceIndexes').addPerformanceIndexes, 'Performance Indexes'
    )],
    ['Reporting',         () => require('./scripts/migrateReportingTables').migrateReportingTables()],
    ['LisBarcodeUnify',   async () => {
      const { sequelize: sq } = require('./models');
      const [[tableCheck]] = await sq.query(
        `SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'lis_specimens'`
      );
      if (!tableCheck.cnt) return;
      const { dropBarcodeUniqueConstraint } = require('./scripts/unifyOrderBarcodes');
      await dropBarcodeUniqueConstraint(sq);
    }],
    ['AuditLogs',         async () => {
      const { sequelize: sq } = require('./models');
      await sq.query(`CREATE TABLE IF NOT EXISTS audit_logs (
        id VARCHAR(36) PRIMARY KEY,
        clinic_id INTEGER,
        user_id VARCHAR(36),
        user_name VARCHAR(255),
        user_role VARCHAR(50),
        module VARCHAR(100) NOT NULL,
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(100),
        entity_id VARCHAR(100),
        description TEXT,
        old_values TEXT,
        new_values TEXT,
        ip_address VARCHAR(45),
        user_agent TEXT,
        status VARCHAR(20) DEFAULT 'success',
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      for (const [idxName, idxSql] of [
        ['idx_audit_logs_created', 'CREATE INDEX idx_audit_logs_created ON audit_logs(created_at DESC)'],
        ['idx_audit_logs_module', 'CREATE INDEX idx_audit_logs_module ON audit_logs(module)'],
        ['idx_audit_logs_user', 'CREATE INDEX idx_audit_logs_user ON audit_logs(user_id)'],
      ]) {
        try {
          const [[idxCheck]] = await sq.query(
            `SELECT COUNT(*) AS cnt FROM pg_indexes WHERE schemaname = current_schema() AND tablename = 'audit_logs' AND indexname = :idxName`,
            { replacements: { idxName } }
          );
          if (!idxCheck.cnt) await sq.query(idxSql);
        } catch (e) { /* index creation is best-effort */ }
      }
    }],
  ];

  for (const [name, run] of migrations) {
    try {
      await run();
      console.log(`  ✅ ${name} migration done`);
    } catch (err) {
      console.log(`  ⚠️  ${name} migration skipped: ${err.message}`);
    }
  }

  // Seed default admin user if none exists
  try {
    const bcrypt = require('bcrypt');
    const { sequelize } = require('./models');
    const [existing] = await sequelize.query(
      `SELECT id FROM users WHERE email = 'kembe699@gmail.com' LIMIT 1`
    );
    if (!existing || existing.length === 0) {
      // Never hardcode this: the previous literal password also happened to be
      // the live database password, so anyone reading the repo had admin on
      // every deployment that ran this seeder. Seeding is now opt-in via
      // SEED_ADMIN_PASSWORD and is skipped entirely when it isn't set.
      const seedPassword = process.env.SEED_ADMIN_PASSWORD;
      if (!seedPassword) {
        console.log('  ⏭  Default admin not seeded (set SEED_ADMIN_PASSWORD to enable)');
        return;
      }
      const hash = await bcrypt.hash(seedPassword, 12);
      const { v4: uuidv4 } = require('uuid');
      await sequelize.query(
        `INSERT INTO users (id, email, password_hash, display_name, role, clinic_id, status, is_active, created_at, updated_at)
         VALUES (:id, 'kembe699@gmail.com', :hash, 'Admin Kembe', 'admin', 1, 'active', true, NOW(), NOW())`,
        { replacements: { id: uuidv4(), hash } }
      );
      console.log('  ✅ Default admin user seeded');
    }
  } catch (seedErr) {
    console.log('  ⚠️  Admin seed skipped:', seedErr.message);
  }

  // Identity sequences must be ahead of the data or the next INSERT collides
  // with an existing primary key. Every one of them sat at 1 after the
  // MySQL -> PostgreSQL migration (dump rows carry explicit ids, which does not
  // advance a sequence), which broke creating users, expenses, purchase orders
  // and password-reset tokens across the migrated tenant. Idempotent and cheap:
  // it only moves a sequence forward to match rows that already exist, so a
  // restored dump or a freshly cloned schema cannot silently reintroduce it.
  try {
    const { resyncAll } = require('./scripts/resyncSequences');
    const fixed = await resyncAll({ quiet: true });
    if (fixed > 0) console.log(`  ✅ Re-synced ${fixed} identity sequence(s) that were behind their data`);
  } catch (seqErr) {
    console.error('  ⚠️  Identity sequence resync failed:', seqErr.message);
  }

  console.log('✅ All background migrations complete');
}

// Start the server.
// The HTTP server starts immediately so Render's health probe never times out.
// DB initialisation is retried up to 5 times with exponential back-off.
// If all retries fail the server keeps running (health endpoint still responds,
// API routes return 503) instead of calling process.exit which causes an
// infinite Render restart loop and persistent 502 errors for the frontend.
async function startServer() {
  await new Promise(resolve => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/health`);
      console.log(`💾 Cache mode: ${process.env.REDIS_ENABLED === 'true' ? 'Redis (Upstash)' : 'In-memory'}`);
      // Resend's HTTP API is the preferred transport and is checked first:
      // Render blocks outbound SMTP ports, so on that host SMTP cannot deliver
      // no matter how it is configured.
      const resendConfigured = !!process.env.RESEND_API_KEY;
      const smtpConfigured = !!((process.env.EMAIL_USER || process.env.SMTP_USER) && (process.env.EMAIL_PASS || process.env.SMTP_PASS));
      if (resendConfigured) {
        console.log(`📧 Email: Resend API, sending as ${process.env.EMAIL_FROM || 'onboarding@resend.dev'}`);
      } else if (smtpConfigured) {
        console.log(`📧 Email: SMTP (${process.env.EMAIL_HOST || process.env.SMTP_HOST || 'smtp.gmail.com'})`);
      } else {
        const level = process.env.NODE_ENV === 'production' ? console.error : console.warn;
        level(`${process.env.NODE_ENV === 'production' ? '🚨' : '⚠️ '} No email transport configured — password reset and welcome emails will NOT be delivered (set RESEND_API_KEY, or EMAIL_USER/EMAIL_PASS)`);
      }
      resolve();
    });
  });

  // Retry DB init with exponential back-off (handles DB cold-start on free tier)
  let dbReady = false;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const ok = await initializeDatabase();
      if (ok) { dbReady = true; break; }
    } catch (err) {
      console.error(`❌ DB init attempt ${attempt}/5 failed:`, err.message);
    }
    if (attempt < 5) {
      const wait = attempt * 3000;
      console.log(`⏳ Retrying DB connection in ${wait / 1000}s...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }

  if (dbReady) {
    console.log('✅ Database ready — server is now accepting requests');
    setImmediate(() => runBackgroundMigrations().catch(console.error));
    // A bill is committed before its ledger entry is written, so any failure in
    // between leaves revenue off the reports with nothing looking wrong — the
    // bill saved, the receipt printed, the cashier balanced, and only the
    // income statement was short. This closes that gap continuously instead of
    // waiting for someone to notice a total disagreeing days later.
    //
    // Scheduled on its own rather than after the platform database finishes
    // setting itself up: whether an admin account could be seeded has nothing
    // to do with whether the books are correct, and chaining the two meant one
    // unrelated startup failure silently switched this off.
    setImmediate(() => {
      const { sweepAllTenants } = require('./services/ledgerSweeper');
      const runLedgerSweep = () => sweepAllTenants()
        .then(({ repaired, corrected, failed }) => {
          if (repaired > 0) console.log(`🧾 Ledger sweep: repaired ${repaired} bill(s), ${corrected.toFixed(2)} adjusted.`);
          if (failed > 0) console.warn(`⚠️  Ledger sweep: ${failed} tenant(s) could not be swept.`);
        })
        .catch((err) => console.error('⚠️  Ledger sweep failed:', err.message));
      runLedgerSweep();
      setInterval(runLedgerSweep, 10 * 60 * 1000); // every 10 minutes
    });

    // A doctor forgetting to close a visit leaves it open indefinitely — still
    // counted as "active" everywhere that checks (duplicate-patient lookup,
    // repeat-test guards, the queue/history views). Auto-closing anything still
    // open 24h after it started keeps "active" meaningful without relying on
    // staff to remember. Checked every 30 minutes — the close itself only needs
    // to happen sometime after the 24h mark, not to the minute.
    setImmediate(() => {
      const { closeStaleVisitsAllTenants } = require('./services/visitAutoCloser');
      const runVisitAutoClose = () => closeStaleVisitsAllTenants()
        .then(({ closed, failed }) => {
          if (failed > 0) console.warn(`⚠️  Visit auto-close: ${failed} tenant(s) could not be checked.`);
        })
        .catch((err) => console.error('⚠️  Visit auto-close failed:', err.message));
      runVisitAutoClose();
      setInterval(runVisitAutoClose, 30 * 60 * 1000); // every 30 minutes
    });

    // A Clinical Insights generation is fire-and-forget (no job queue in this
    // codebase) — if the process restarts mid-call, its row would otherwise
    // sit "pending" forever, leaving a doctor staring at an infinite spinner.
    // Checked every 2 minutes; the sweep itself only fails rows already
    // pending for 3+ minutes.
    setImmediate(() => {
      const { sweepStuckInsightsAllTenants } = require('./services/clinicalInsightsSweeper');
      const runInsightsSweep = () => sweepStuckInsightsAllTenants()
        .then(({ failed, errored }) => {
          if (errored > 0) console.warn(`⚠️  Clinical Insights sweep: ${errored} tenant(s) could not be checked.`);
        })
        .catch((err) => console.error('⚠️  Clinical Insights sweep failed:', err.message));
      runInsightsSweep();
      setInterval(runInsightsSweep, 2 * 60 * 1000); // every 2 minutes
    });

    setImmediate(() => {
      require('./models/platform').initializePlatformDatabase()
        .then(() => {
          console.log('✅ Platform (control-plane) database ready');
          // Auto-suspend any client whose paid coverage has lapsed with
          // nothing renewed — checked once now, then on a recurring timer,
          // the same dunning behavior a real SaaS billing system has.
          const { checkAndSuspendOverdueClients } = require('./services/subscriptionBilling');
          const runCheck = () => checkAndSuspendOverdueClients()
            .then(({ suspendedCount }) => {
              if (suspendedCount > 0) console.log(`⏳ Overdue check: suspended ${suspendedCount} client(s)`);
            })
            .catch((err) => console.error('⚠️  Overdue check failed:', err.message));
          runCheck();
          setInterval(runCheck, 15 * 60 * 1000); // every 15 minutes

          // Snapshot every tenant's real database size so the client detail
          // page's growth chart accumulates actual history over time, not
          // just whatever the size happens to be the moment someone looks.
          const { recordSnapshotsForAllClients } = require('./services/tenantUsage');
          const runUsageSnapshot = () => recordSnapshotsForAllClients()
            .then(({ recorded, total }) => console.log(`📊 DB usage snapshot: recorded ${recorded}/${total} client(s)`))
            .catch((err) => console.error('⚠️  DB usage snapshot failed:', err.message));
          runUsageSnapshot();
          setInterval(runUsageSnapshot, 6 * 60 * 60 * 1000); // every 6 hours

        })
        .catch((err) => console.error('⚠️  Platform database init failed:', err.message));
    });
  } else {
    console.error('⚠️  Database unavailable after 5 attempts — API routes will return 503 until DB recovers');
  }
}

startServer().catch(err => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// A promise rejection that nothing ever catches (e.g. a stray async call after a
// transaction already committed/rolled back) is fatal by default on this Node version —
// the process dies for every clinic at once with nothing but a bare stack trace. Logging
// it clearly first at least tells ops WHAT broke before the same unavoidable exit happens,
// instead of a silent/opaque crash.
process.on('unhandledRejection', (reason) => {
  console.error('🔥 UNHANDLED REJECTION — process will exit:', reason);
  process.exit(1);
});

// A synchronous throw that unwound past every try/catch means the process is in an
// unknown state — per Node's own guidance, never keep serving requests after this,
// always exit and let the process manager restart cleanly.
process.on('uncaughtException', (err) => {
  console.error('🔥 UNCAUGHT EXCEPTION — process will exit:', err);
  process.exit(1);
});
