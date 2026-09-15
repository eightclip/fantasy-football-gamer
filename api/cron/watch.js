// Runs every 15 minutes (vercel.json). Builds the week, decides what is worth a ping,
// sends it, and remembers what went out. ?dry=1&at=<ISO> previews without sending.

import { buildWeek } from '../../lib/week.js';
import { decide } from '../../lib/alerts.js';
import { readJson, writeJson, SUBS, STATE } from '../../lib/store.js';
import { configured, pushAll } from '../../lib/push.js';
import { archiveNews, leagueContext } from '../../lib/leagueData.js';

export async function GET(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const url = new URL(request.url);
  const dry = url.searchParams.has('dry');
  const now = dry && url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();

  const [week, state, subs] = await Promise.all([
    buildWeek(now, { advice: false }), readJson(STATE, {}), readJson(SUBS, []),
    dry ? null : archiveNews().catch(err => console.error('watch: news archive failed:', err.message)),
    // Keeps rest-of-season projections cached so the league sections and Claude answer fast.
    dry ? null : leagueContext(now).catch(err => console.error('watch: league warm-up failed:', err.message)),
  ]);
  const { messages, state: next } = decide(now, week, state);

  if (dry) return Response.json({ now, devices: subs.length, messages, decisions: week.decisions, gamePlayers: week.gamePlayers });

  let delivered = 0;
  const gone = new Set();
  if (configured() && subs.length) {
    for (const m of messages) {
      const r = await pushAll(subs, m);
      delivered += r.delivered;
      r.gone.forEach(e => gone.add(e));
    }
  }
  if (gone.size) await writeJson(SUBS, subs.filter(s => !gone.has(s.endpoint)));

  next.log = [...messages.map(m => ({ ...m, at: now.toISOString(), devices: subs.length })), ...(state.log || [])].slice(0, 40);
  next.lastRun = now.toISOString();
  await writeJson(STATE, next);
  if (messages.length) console.log('watch: sent', messages.map(m => m.key).join(', '));
  return Response.json({ sent: messages.length, delivered, devices: subs.length });
}
