// Alerts for this phone. Behind the PIN gate like everything else.
//   GET     public key, device count, recent alerts
//   POST    { subscription } saves a phone; { test: true } sends a test alert
//   DELETE  { endpoint } forgets a phone

import { readJson, writeJson, SUBS, STATE } from '../lib/store.js';
import { configured, pushAll } from '../lib/push.js';

const HEADERS = { 'Cache-Control': 'private, no-store' };
const reply = (body, status = 200) => Response.json(body, { status, headers: HEADERS });

export async function GET() {
  const [subs, state] = await Promise.all([readJson(SUBS, []), readJson(STATE, {})]);
  return reply({
    publicKey: process.env.VAPID_PUBLIC_KEY || null,
    devices: subs.length,
    recent: (state.log || []).slice(0, 10),
  });
}

export async function POST(request) {
  if (!configured()) return reply({ error: 'Alerts are not configured on the server yet.' }, 503);
  const body = await request.json().catch(() => ({}));
  const subs = await readJson(SUBS, []);

  if (body.test) {
    const { delivered, gone } = await pushAll(subs, {
      key: 'test', title: 'Alerts are on', body: 'This is what a heads-up will look like. Nothing to do right now.',
    });
    if (gone.length) await writeJson(SUBS, subs.filter(s => !gone.includes(s.endpoint)));
    return reply({ delivered });
  }

  const sub = body.subscription;
  if (!sub?.endpoint || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth) {
    return reply({ error: 'That does not look like a push subscription.' }, 400);
  }
  const next = subs.filter(s => s.endpoint !== sub.endpoint)
    .concat({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, added: new Date().toISOString() })
    .slice(-10);
  await writeJson(SUBS, next);
  return reply({ devices: next.length });
}

export async function DELETE(request) {
  const { endpoint } = await request.json().catch(() => ({}));
  const subs = await readJson(SUBS, []);
  const next = subs.filter(s => s.endpoint !== endpoint);
  if (next.length !== subs.length) await writeJson(SUBS, next);
  return reply({ devices: next.length });
}
