// Fetching and caching shared by every data source. Server-side only.

import { getCache } from '@vercel/functions';

const UA = { 'User-Agent': 'fantasy-football-gamer (+https://github.com/eightclip/fantasy-football-gamer)' };

const memory = new Map();
let runtime = null;
try { runtime = getCache({ namespace: 'ffg-v1' }); } catch { /* local dev falls back to memory */ }

// Memory first, then Vercel's Runtime Cache, then the network.
export async function cached(key, ttlSeconds, load) {
  const hit = memory.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  if (runtime) {
    try {
      const value = await runtime.get(key);
      if (value != null) {
        memory.set(key, { value, until: Date.now() + Math.min(ttlSeconds, 60) * 1000 });
        return value;
      }
    } catch { /* fall through to a fresh fetch */ }
  }
  const value = await load();
  memory.set(key, { value, until: Date.now() + ttlSeconds * 1000 });
  if (runtime) runtime.set(key, value, { ttl: ttlSeconds }).catch(() => {});
  return value;
}

export async function get(url, headers = {}) {
  const res = await fetch(url.replace(/^http:/, 'https:'), { headers: { ...UA, ...headers }, signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`${new URL(url).host} returned ${res.status}`);
  return res;
}
export const json = async (url, headers) => (await get(url, headers)).json();
export const text = async (url, headers) => (await get(url, headers)).text();

// Minimal CSV reader: quoted fields, doubled quotes. Returns objects keyed by header.
export function csv(body) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...rest] = rows;
  return rest.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

export async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}
