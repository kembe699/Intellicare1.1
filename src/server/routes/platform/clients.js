const express = require('express');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const mysql2 = require('mysql2/promise');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { connectionHost } = require('../../config/dbConnectionOptions');
const { Client, Invoice, SubscriptionPlan, DbUsageSnapshot } = require('../../models/platform');
const { authenticatePlatformAdmin } = require('../../middleware/platformAuth');
const { evictTenantConnection } = require('../../tenantDb');
const { createInvoiceForClient, getClientCoverage } = require('../../services/subscriptionBilling');
const { measureDbSize, getDataBreakdown } = require('../../services/tenantUsage');

const execFileAsync = promisify(execFile);
const router = express.Router();
router.use(authenticatePlatformAdmin);

const CODE_PATTERN = /^[a-z][a-z0-9]{2,29}$/; // lowercase slug, 3-30 chars, starts with a letter
const TENANT_DB_PREFIX = process.env.TENANT_DB_PREFIX || 'intellicare_client_';

function generateTempPassword() {
  // 12 chars, mixed case + digits + one symbol — readable enough to read off
  // a screen and hand to a client once, matching the "shown once" pattern the
  // rest of the panel uses.
  const raw = crypto.randomBytes(9).toString('base64').replace(/[+/=]/g, '');
  return raw.slice(0, 10) + '!' + Math.floor(Math.random() * 10);
}

router.get('/', async (req, res) => {
  try {
    const clients = await Client.findAll({
      order: [['created_at', 'DESC']],
      include: [{ model: Invoice, as: 'invoices', attributes: ['id', 'status', 'amount'] }],
    });
    const withSummary = await Promise.all(clients.map(async (c) => {
      const invoices = c.invoices || [];
      const outstanding = invoices
        .filter((i) => i.status !== 'paid')
        .reduce((sum, i) => sum + Number(i.amount), 0);
      const coverage = await getClientCoverage(c.id);
      return { ...c.toJSON(), invoices: undefined, outstandingAmount: outstanding, ...coverage };
    }));
    res.json(withSummary);
  } catch (error) {
    console.error('List clients error:', error);
    res.status(500).json({ error: 'Failed to load clients' });
  }
});

// Lets the "New Client" dialog show the exact database name to pre-create
// (via the host's control panel) before the admin fills in the rest of the
// form — computed from the same prefix + code convention used below.
// Registered before /:id so "db-name-prefix" is never swallowed as an id.
router.get('/db-name-prefix', async (req, res) => {
  res.json({ prefix: TENANT_DB_PREFIX });
});

router.get('/:id', async (req, res) => {
  try {
    const client = await Client.findByPk(req.params.id, {
      include: [{ model: Invoice, as: 'invoices', order: [['created_at', 'DESC']] }],
    });
    if (!client) return res.status(404).json({ error: 'Client not found' });
    const coverage = await getClientCoverage(client.id);
    res.json({ ...client.toJSON(), ...coverage });
  } catch (error) {
    console.error('Get client error:', error);
    res.status(500).json({ error: 'Failed to load client' });
  }
});

router.get('/:id/db-usage', async (req, res) => {
  try {
    const client = await Client.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Current size is measured live (a cheap information_schema lookup) so
    // it's never more than a page-load stale, while the trend comes from
    // the periodic snapshots recorded in the background (see
    // services/tenantUsage.js) — otherwise every page view would need to
    // wait on/duplicate that same measurement just to show "now."
    const current = await measureDbSize(client.db_name);
    const history = await DbUsageSnapshot.findAll({
      where: { client_id: client.id },
      order: [['recorded_at', 'ASC']],
      limit: 60,
    });

    res.json({
      currentSizeBytes: current.sizeBytes,
      currentTableCount: current.tableCount,
      history: history.map((h) => ({ recordedAt: h.recorded_at, sizeBytes: Number(h.size_bytes) })),
    });
  } catch (error) {
    console.error('DB usage error:', error);
    res.status(500).json({ error: 'Failed to load database usage' });
  }
});

router.get('/:id/data-breakdown', async (req, res) => {
  try {
    const client = await Client.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const breakdown = await getDataBreakdown(client);
    res.json({ breakdown });
  } catch (error) {
    console.error('Data breakdown error:', error);
    res.status(500).json({ error: 'Failed to load data breakdown' });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, code, adminName, adminEmail, plan_id, dbUser, dbPassword } = req.body;
    if (!name || !code || !adminName || !adminEmail) {
      return res.status(400).json({ error: 'name, code, adminName, and adminEmail are all required' });
    }

    const normalizedCode = String(code).trim().toLowerCase();
    if (!CODE_PATTERN.test(normalizedCode)) {
      return res.status(400).json({
        error: 'Code must be 3-30 lowercase letters/numbers, starting with a letter (e.g. nationmc)'
      });
    }

    const existing = await Client.findOne({ where: { code: normalizedCode } });
    if (existing) {
      return res.status(409).json({ error: `Code "${normalizedCode}" is already in use` });
    }

    // Validated up front, before provisioning a real database, so a bad
    // plan_id never leaves a half-created client with no invoice behind it.
    let plan = null;
    if (plan_id) {
      plan = await SubscriptionPlan.findByPk(plan_id);
      if (!plan) return res.status(404).json({ error: 'Plan not found' });
    }

    const dbName = `${TENANT_DB_PREFIX}${normalizedCode}`;

    // This app never runs CREATE DATABASE — on hosts like Hostinger shared
    // hosting, every database has its own dedicated MySQL user with no
    // cross-database grant available, so neither the platform user nor a
    // shared app-wide user can be assumed to reach a brand-new tenant
    // database. The target database must already exist (created manually,
    // e.g. via hPanel's MySQL Databases page, with its own user granted full
    // privileges on it) before a client can be provisioned into it — the
    // check below connects with exactly the credentials that will actually
    // be used going forward (dbUser/dbPassword if given, else the shared
    // DB_USER/DB_PASSWORD — matching how tenantDb.js resolves a connection),
    // so a missing database or a wrong/ungranted user fails fast here with a
    // clear message instead of a slow, cryptic child-process timeout.
    let checkConn;
    try {
      checkConn = await mysql2.createConnection({
        host: connectionHost(),
        port: parseInt(process.env.DB_PORT || '3306', 10),
        user: dbUser || process.env.DB_USER,
        password: dbPassword || process.env.DB_PASSWORD || '',
      });
    } catch (connErr) {
      return res.status(400).json({ error: `Could not connect with the given DB credentials: ${connErr.message}` });
    }
    try {
      const [schemaCheck] = await checkConn.query(
        'SELECT 1 FROM information_schema.schemata WHERE schema_name = ?',
        [dbName]
      );
      if (schemaCheck.length === 0) {
        return res.status(400).json({
          error: `Database "${dbName}" doesn't exist yet, or the given DB user can't see it. Create it first via your hosting panel's MySQL Databases page and grant that user full privileges on it, then try again.`,
          expectedDbName: dbName,
        });
      }
    } finally {
      await checkConn.end();
    }

    const tempPassword = generateTempPassword();
    const adminPasswordHash = await bcrypt.hash(tempPassword, 12);

    const provisionArgs = JSON.stringify({
      dbName,
      facilityName: name,
      adminName,
      adminEmail: adminEmail.toLowerCase(),
      adminPasswordHash,
      dbUser: dbUser || undefined,
      dbPassword: dbPassword || undefined,
    });

    try {
      // process.execPath (the absolute path to the currently-running node
      // binary) instead of the bare string 'node' — some managed hosting
      // environments (e.g. Hostinger's Node.js app runner) don't expose a
      // bare `node` command on PATH to spawned child processes, which made
      // this fail with "spawn node ENOENT" in production even though the
      // app itself is obviously running under node.
      await execFileAsync(
        process.execPath,
        [path.resolve(__dirname, '../../scripts/provisionTenant.js'), provisionArgs],
        { timeout: 120000, maxBuffer: 1024 * 1024 * 16 }
      );
    } catch (provisionErr) {
      const rawDetail = provisionErr.stderr || provisionErr.message || '';
      console.error('Tenant provisioning failed:', rawDetail);
      // provisionTenant.js's own top-level catch writes {"ok":false,"error":"..."}
      // as its last stderr line — parsed out here so the platform admin sees the
      // actual reason (e.g. a specific MySQL access-denied message) directly in
      // the browser instead of a generic 500, without needing server log access.
      let detail = rawDetail.trim().split('\n').pop() || '';
      try {
        const parsed = JSON.parse(detail);
        if (parsed && typeof parsed.error === 'string') detail = parsed.error;
      } catch {
        // Not JSON (e.g. a raw Node stack trace) — fall back to a short tail
        // of the raw output, still far more useful than nothing.
        detail = rawDetail.trim().slice(-500);
      }
      return res.status(500).json({
        error: `Failed to provision the new instance — no client was created. ${detail}`,
      });
    }

    // Make sure any stale connection from a previous failed attempt at this
    // exact db_name isn't reused now that the database has been rebuilt.
    evictTenantConnection(dbName);

    const client = await Client.create({
      name,
      code: normalizedCode,
      db_name: dbName,
      admin_email: adminEmail.toLowerCase(),
      status: 'active',
      db_user: dbUser || null,
      db_password: dbPassword || null,
    });

    let invoice = null;
    if (plan) {
      invoice = await createInvoiceForClient(client, plan);
    }

    // Baseline snapshot so the growth chart has a day-0 point immediately
    // instead of waiting for the next scheduled run (up to 6 hours away).
    require('../../services/tenantUsage').recordSnapshotForClient(client).catch((err) =>
      console.error(`Initial DB usage snapshot failed for client ${client.id}:`, err.message)
    );

    res.status(201).json({
      client,
      invoice,
      // Shown once — never re-shown or recoverable after this response.
      credentials: { code: normalizedCode, email: adminEmail.toLowerCase(), tempPassword },
    });
  } catch (error) {
    console.error('Create client error:', error);
    res.status(500).json({ error: 'Failed to create client' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const client = await Client.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const confirmCode = String(req.body.code || '').trim().toLowerCase();
    if (confirmCode !== client.code) {
      return res.status(400).json({ error: 'Client code confirmation does not match' });
    }

    // Defensive: only ever drop a database that actually matches the
    // provisioning naming convention, never whatever raw string happens to
    // be sitting in the client row.
    if (!client.db_name || !client.db_name.startsWith(TENANT_DB_PREFIX) || !/^[a-z0-9_]+$/.test(client.db_name)) {
      return res.status(500).json({ error: 'Refusing to delete: unexpected database name on this client' });
    }

    // Close the pooled tenant connection first so it isn't holding the
    // database open when we try to drop it below.
    evictTenantConnection(client.db_name);

    // Dropped using the tenant's own credentials, not the platform
    // connection's — on hosts where every database has its own dedicated
    // user (e.g. Hostinger shared hosting), the platform user has no
    // privileges on a tenant's database at all. A database-scoped
    // "ALL PRIVILEGES" grant does include DROP DATABASE for that specific
    // database (confirmed — unlike CREATE DATABASE, which needs a broader
    // server-level privilege scoped users don't have), so this works even
    // on hosts where CREATE DATABASE never would.
    const dropConn = await mysql2.createConnection({
      host: connectionHost(),
      port: parseInt(process.env.DB_PORT || '3306', 10),
      user: client.db_user || process.env.DB_USER,
      password: client.db_password || process.env.DB_PASSWORD || '',
    });
    try {
      await dropConn.query(`DROP DATABASE IF EXISTS \`${client.db_name}\``);
    } finally {
      await dropConn.end();
    }

    await DbUsageSnapshot.destroy({ where: { client_id: client.id } });
    await Invoice.destroy({ where: { client_id: client.id } });
    await client.destroy();

    res.json({ message: `"${client.name}" and its database have been permanently deleted` });
  } catch (error) {
    console.error('Delete client error:', error);
    res.status(500).json({ error: 'Failed to delete client' });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const { status } = req.body;
    if (!['active', 'suspended'].includes(status)) {
      return res.status(400).json({ error: "status must be 'active' or 'suspended'" });
    }

    const client = await Client.findByPk(req.params.id);
    if (!client) return res.status(404).json({ error: 'Client not found' });

    client.status = status;
    client.suspended_at = status === 'suspended' ? new Date() : null;
    await client.save();

    res.json(client);
  } catch (error) {
    console.error('Update client status error:', error);
    res.status(500).json({ error: 'Failed to update client status' });
  }
});

module.exports = router;
