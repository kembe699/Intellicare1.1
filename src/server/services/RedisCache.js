/**
 * RedisCache — Upstash Redis REST API client with in-memory fallback.
 *
 * Uses Node 18+ built-in fetch (no extra dependencies).
 * Falls back to a local TTL Map when Redis is not configured or unreachable.
 *
 * Environment variables:
 *   REDIS_ENABLED=true
 *   REDIS_URL=https://....upstash.io
 *   REDIS_TOKEN=...
 */

class RedisCache {
  constructor() {
    this.enabled = process.env.REDIS_ENABLED === 'true';
    this.redisUrl = (process.env.REDIS_URL || '').replace(/\/$/, '');
    this.redisToken = process.env.REDIS_TOKEN || '';
    this.fallback = new Map();

    if (this.enabled && this.redisUrl && this.redisToken) {
      console.log('✅ RedisCache: Upstash Redis enabled');
    } else {
      this.enabled = false;
      console.log('⚠️  RedisCache: using in-memory fallback (set REDIS_ENABLED + REDIS_URL + REDIS_TOKEN to enable Redis)');
    }
  }

  // ── Internal: Upstash REST fetch ──────────────────────────────────────────
  async _fetch(path, method = 'GET', body = null) {
    const url = `${this.redisUrl}${path}`;
    const opts = {
      method,
      headers: {
        Authorization: `Bearer ${this.redisToken}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(2500),
    };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    return res.json();
  }

  // ── In-memory fallback helpers ────────────────────────────────────────────
  _fbGet(key) {
    const entry = this.fallback.get(key);
    if (!entry) return null;
    if (Date.now() > entry.exp) { this.fallback.delete(key); return null; }
    return entry.data;
  }

  _fbSet(key, data, ttlSeconds) {
    this.fallback.set(key, { data, exp: Date.now() + ttlSeconds * 1000 });
    // Evict expired entries periodically to avoid unbounded growth
    if (this.fallback.size > 2000) {
      const now = Date.now();
      for (const [k, v] of this.fallback) {
        if (now > v.exp) this.fallback.delete(k);
      }
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async get(key) {
    if (!this.enabled) return this._fbGet(key);
    try {
      const json = await this._fetch(`/get/${encodeURIComponent(key)}`);
      if (json.result == null) return null;
      return JSON.parse(json.result);
    } catch {
      return this._fbGet(key);
    }
  }

  async set(key, value, ttlSeconds = 300) {
    if (!this.enabled) { this._fbSet(key, value, ttlSeconds); return; }
    try {
      const encoded = encodeURIComponent(JSON.stringify(value));
      await this._fetch(`/set/${encodeURIComponent(key)}/${encoded}?EX=${ttlSeconds}`);
    } catch {
      this._fbSet(key, value, ttlSeconds);
    }
  }

  async del(key) {
    if (!this.enabled) { this.fallback.delete(key); return; }
    try {
      await this._fetch(`/del/${encodeURIComponent(key)}`);
    } catch {
      this.fallback.delete(key);
    }
  }

  async delPattern(pattern) {
    if (!this.enabled) {
      for (const k of this.fallback.keys()) {
        if (k.includes(pattern)) this.fallback.delete(k);
      }
      return;
    }
    try {
      // KEYS takes a glob, not a prefix. Callers pass a bare prefix (matching
      // the in-memory fallback above, which does a substring test), so without
      // a trailing wildcard this asked Redis for one exact key that never
      // exists and silently deleted nothing — invalidation worked only while
      // Redis was disabled. Wrapped so a caller's own '*' is not doubled.
      const glob = pattern.includes('*') ? pattern : `*${pattern}*`;
      const json = await this._fetch(`/keys/${encodeURIComponent(glob)}`);
      const keys = json.result || [];
      await Promise.all(keys.map(k => this.del(k)));
    } catch { /* ignore */ }
  }

  async flush() {
    this.fallback.clear();
    if (!this.enabled) return;
    try { await this._fetch('/flushdb', 'POST'); } catch { /* ignore */ }
  }
}

module.exports = new RedisCache();
