// Runs AccountingService.syncBillRevenueToGL on one bill in the preview tenant and
// prints its result as JSON. Used by t26 to check the sync posts nothing on a bill
// whose books are already right.
//   node tests/batch1/sync_bill.cjs <billId> [--dry-run]
const path = require('path');
const SERVER = path.resolve(__dirname, '../../src/server');
Object.assign(process.env, {
  DB_HOST: 'localhost', DB_PORT: '5435', DB_NAME: 'intellicare_preview', DB_USER: 'preview', DB_PASSWORD: 'preview_pass',
  DEFAULT_SCHEMA: 'tenant_preview', TENANT_TEMPLATE_SCHEMA: 'tenant_preview',
});
const dotenv = require(path.join(SERVER, 'node_modules/dotenv'));
const originalConfig = dotenv.config.bind(dotenv);
dotenv.config = (opts) => originalConfig({ ...opts, override: false });

(async () => {
  const [billId] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const dryRun = process.argv.includes('--dry-run');
  const tenantContext = require(path.join(SERVER, 'tenantContext'));
  const { getTenantConnection } = require(path.join(SERVER, 'tenantDb'));
  const connection = await getTenantConnection('tenant_preview');
  const result = await tenantContext.run(connection, () =>
    require(path.join(SERVER, 'services/AccountingService')).syncBillRevenueToGL(billId, 'test', { dryRun }));
  process.stdout.write(`\n@@RESULT ${JSON.stringify(result)}\n`);
  process.exit(0);
})().catch((e) => { process.stdout.write(`\n@@ERROR ${e.message}\n`); process.exit(1); });
