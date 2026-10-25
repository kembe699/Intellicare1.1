// Shared helpers for the client-demo seed / cleanup scripts.
// Everything goes through the app's own HTTP API, logged in as demo users.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const API = (process.env.DEMO_API || 'https://intellicare.nilehc.tech/api').replace(/\/$/, '');
export const CODE = process.env.DEMO_CODE || 'demo';
export const TAG = 'DEMO DATA';
export const BRANCH_ID = Number(process.env.DEMO_BRANCH_ID || 2); // Gudele — where CIC, shifts and the attendance site live
export const CLINIC_ID = 1;

// ── state (ids of what was created), so a re-run skips finished steps ──
const STATE_FILE = path.join(HERE, '.demo-state.json');
export const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
export const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
export const done = (key) => !!state.done?.[key];
export const mark = (key) => { state.done = { ...(state.done || {}), [key]: new Date().toISOString() }; save(); };

// ── sessions ──
const tokens = new Map();
export async function login(email, password) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: CODE, email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.token) throw new Error(`login ${email}: ${res.status} ${body.error || ''}`);
  tokens.set(email, body.token);
  return body;
}

/** api(as, method, path, body) — `as` is a logged-in email. Throws with the server's error on failure.
 *  `branch: null` sends no branch header (an admin then sees every branch). */
export async function api(as, method, p, body, { allow = [], branch = BRANCH_ID } = {}) {
  const token = tokens.get(as);
  if (!token) throw new Error(`not logged in as ${as}`);
  const res = await fetch(`${API}${p}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(branch == null ? {} : { 'x-branch-id': String(branch) }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  if (!res.ok && !allow.includes(res.status)) {
    const err = new Error(`${method} ${p} → ${res.status}: ${json.error || json.message || text.slice(0, 300)}`);
    err.status = res.status; err.body = json;
    throw err;
  }
  return { status: res.status, ok: res.ok, body: json };
}

export const log = (...a) => console.log(...a);
export const step = (name) => console.log(`\n══ ${name} ══`);
export const today = () => {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
export const plusDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
