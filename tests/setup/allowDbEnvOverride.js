/**
 * config/database.js deliberately calls dotenv.config({ override: true })
 * so the committed src/server/.env always wins over a hosting panel's
 * injected env vars in production — correct for that purpose, but it also
 * silently defeats a shell-level DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/
 * DB_SCHEMA override for anyone who wants to point an integration run at a
 * different, already-provisioned Postgres without editing the gitignored,
 * credential-bearing src/server/.env. Same technique as
 * src/server/_preview-bootstrap.js.
 *
 * Patches BOTH physical copies of the dotenv package — src/server has its
 * own independent node_modules/dotenv install, separate from the repo
 * root's, exactly the same dual-install shape already documented for
 * @anthropic-ai/sdk in jest.config.cjs. config/database.js resolves the
 * server's own copy (Node walks up from the requiring file's directory),
 * so patching only the root copy silently does nothing — confirmed live:
 * the root-only version of this patch loaded (logged) but
 * config/database.js still connected with the un-overridden credentials.
 *
 * This is a true no-op for a normal test run: it only changes dotenv's
 * override behavior, and does nothing unless the invoking shell has
 * already set conflicting DB_* env vars before jest starts — which never
 * happens in CI or a plain `npm run test:integration` against the
 * configured tenant_test database.
 */
function patch(dotenvPath) {
  const dotenv = require(dotenvPath);
  const originalConfig = dotenv.config.bind(dotenv);
  dotenv.config = (opts) => originalConfig({ ...opts, override: false });
}

patch('dotenv');
try {
  patch('../../src/server/node_modules/dotenv');
} catch (e) {
  // Only present when src/server has its own separate install — harmless
  // if the two ever get deduped into one.
}
