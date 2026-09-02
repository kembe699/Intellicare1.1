// Shim so this zip boots correctly whether the platform's configured
// startup file is "index.js" (root) or "./src/server/index.js" — both
// resolve to the same real entry point below.
module.exports = require('./src/server/index.js');
