// AsyncLocalStorage-based tenant context — the MySQL equivalent of davinscs's
// Postgres search_path trick. Set once per request (see
// middleware/auth.js's authenticateToken), then every route file's existing
// `require('../models')` import transparently resolves to THIS request's
// tenant connection instead of one static database, with zero changes needed
// in the ~50 route files that only use raw sequelize.query()/Model.findAll()
// style calls (see models/index.js for the proxy that reads this).
//
// Outside a request (migrations at boot, the standalone provisioning script,
// tests) getCurrent() returns undefined and callers fall back to the app's
// original single default database — unchanged behavior for all non-request
// code paths.
const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function run(tenantConnection, callback) {
  return storage.run(tenantConnection, callback);
}

function getCurrent() {
  return storage.getStore();
}

module.exports = { run, getCurrent };
