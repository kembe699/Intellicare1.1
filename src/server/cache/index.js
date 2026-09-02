/**
 * Shared in-memory TTL caches for hot per-request data.
 * Avoids repeated DB round-trips on every API call.
 */

const USER_AUTH_TTL   = 2 * 60 * 1000;  // 2 min  – role + is_active
const BRANCH_CTX_TTL  = 2 * 60 * 1000;  // 2 min  – user branch list

function makeTTLCache(ttl) {
  const store = new Map();
  return {
    get(key) {
      const entry = store.get(key);
      if (!entry) return null;
      if (Date.now() - entry.ts > ttl) { store.delete(key); return null; }
      return entry.data;
    },
    set(key, data) { store.set(key, { data, ts: Date.now() }); },
    del(key)       { store.delete(key); },
    clear()        { store.clear(); },
  };
}

const userAuthCache   = makeTTLCache(USER_AUTH_TTL);
const branchCtxCache  = makeTTLCache(BRANCH_CTX_TTL);

module.exports = { userAuthCache, branchCtxCache };
