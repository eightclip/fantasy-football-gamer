// PIN gate for every request. Nothing in public/ is served until this says so.
//
// Env vars (Production):
//   ACCESS_PIN   the PIN to open the site. Changing it signs every device out.
//   GATE_SECRET  long random string, the HMAC key for the cookie.
// If either is missing the site fails closed.

import { next, rewrite } from '@vercel/functions';
import { readJson, writeJson } from './lib/store.js';
import { lockState } from './lib/lockout.js';

// Node runtime so the lockout can read and write the private Blob store.
export const config = { runtime: 'nodejs' };

const FAILURES = 'gate/failures.json';

const COOKIE = 'ffg_gate';
const YEAR = 60 * 60 * 24 * 365;
const WRONG_PIN_DELAY_MS = 1500;
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "connect-src 'self'; manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";
const PUBLIC = new Set(['/robots.txt', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png', '/apple-touch-icon.png']);

export default async function middleware(request) {
  const url = new URL(request.url);
  const pin = process.env.ACCESS_PIN;
  const secret = process.env.GATE_SECRET;

  // Home-screen install files: fetched without cookies, and they reveal nothing.
  if (PUBLIC.has(url.pathname)) return next();

  // Claude connector: the secret link is the key. Anything else under /mcp is a plain 404.
  if (url.pathname === '/mcp' || url.pathname.startsWith('/mcp/')) {
    const mcp = process.env.MCP_SECRET;
    const given = url.pathname.slice('/mcp/'.length);
    if (!mcp || !same(given, mcp)) return new Response('Not found', { status: 404 });
    return rewrite(new URL('/api/mcp', request.url));
  }

  // Vercel Cron sends the shared secret; nothing else gets into /api/cron.
  if (url.pathname.startsWith('/api/cron/')) {
    const cron = process.env.CRON_SECRET;
    return cron && same(request.headers.get('authorization') || '', `Bearer ${cron}`)
      ? next() : new Response('Unauthorized', { status: 401 });
  }

  if (!pin || !secret) {
    const missing = ['ACCESS_PIN', 'GATE_SECRET'].filter(name => !process.env[name]);
    return page('Locked', `<p class="err">This site is not set up yet. Missing environment variables: ${missing.join(', ')}. See AGENTS.md.</p>`, 503);
  }

  if (url.pathname === '/lock') {
    return new Response(null, {
      status: 303,
      headers: { Location: '/', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
    });
  }

  const good = await sign(secret, pin);

  if (url.pathname === '/unlock' && request.method === 'POST') {
    const failures = await readJson(FAILURES, []).catch(() => []);
    const lock = lockState(failures, Date.now());
    if (lock.locked) {
      const at = new Intl.DateTimeFormat('en-US', { timeZone: process.env.TIMEZONE || 'America/New_York', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(lock.retryAt));
      return gate(`Too many wrong tries. Try again after ${at}.`, 429);
    }
    const form = await request.formData().catch(() => null);
    const tried = String(form?.get('pin') ?? '').trim().slice(0, 64);
    if (tried && same(await sign(secret, tried), good)) {
      return new Response(null, {
        status: 303,
        headers: {
          Location: '/',
          'Set-Cookie': `${COOKIE}=${good}; Path=/; Max-Age=${YEAR}; HttpOnly; Secure; SameSite=Lax`,
        },
      });
    }
    await writeJson(FAILURES, [...lock.recent, Date.now()]).catch(err => console.error('gate: could not record failure:', err.message));
    await new Promise(r => setTimeout(r, WRONG_PIN_DELAY_MS));
    return gate('That PIN did not work.', 401);
  }

  if (same(readCookie(request, COOKIE), good)) return next();

  return gate('', 401);
}

async function sign(secret, value) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode('ffg-gate:' + value));
  return btoa(String.fromCharCode(...new Uint8Array(mac)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Constant-time string compare, so response timing leaks nothing about the cookie.
function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

function gate(error, status) {
  return page(process.env.SITE_NAME || 'Fantasy Football Gamer', `
    <form method="post" action="/unlock">
      <label for="pin">PIN</label>
      <input id="pin" name="pin" type="password" inputmode="numeric"
             autocomplete="current-password" autofocus required>
      <button type="submit">Open</button>
      ${error ? `<p class="err" role="alert">${error}</p>` : ''}
    </form>`, status);
}

function page(title, body, status) {
  return new Response(`<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${title}</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0F1412; color: #EEF2EC; font: 16px/1.5 system-ui, sans-serif; }
  body::before { content: ''; position: fixed; top: -180px; left: 50%; width: 620px; height: 460px;
    transform: translateX(-50%); pointer-events: none;
    background: radial-gradient(ellipse at center, rgba(143,209,79,.18) 0%, rgba(143,209,79,0) 70%); }
  form { width: min(280px, calc(100vw - 44px)); display: grid; gap: 10px; position: relative; }
  label { font-size: 13px; color: #95A39A; }
  input { font: inherit; font-size: 22px; letter-spacing: .2em; padding: 12px 14px;
    background: #18201C; color: #EEF2EC; border: 1px solid #26312B; border-radius: 3px; }
  input:focus-visible, button:focus-visible { outline: 2px solid #8FD14F; outline-offset: 2px; }
  button { font: inherit; font-weight: 700; padding: 12px; border: 0; border-radius: 3px;
    background: #8FD14F; color: #0F1412; cursor: pointer; }
  .err { color: #FF7A59; font-size: 14px; margin: 0; }
</style>
${body}`, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Content-Security-Policy': CSP,
      'X-Frame-Options': 'DENY',
      'Strict-Transport-Security': 'max-age=63072000',
    },
  });
}
