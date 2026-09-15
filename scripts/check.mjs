#!/usr/bin/env node
// Checks your configuration end to end without deploying: required variables, PIN strength,
// that your league and team are found, and that projections, injuries and news load.
// Prints names and results only, never secret values.

import { loadIntoProcess } from './env.mjs';

loadIntoProcess();
const { config, missingConfig } = await import('../lib/config.js');

let failed = false;
const line = (ok, text) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${text}`); if (!ok) failed = true; };
const warn = text => console.log(`warn  ${text}`);

const missing = missingConfig();
line(!missing.length, missing.length ? `Missing: ${missing.join(', ')}` : `League settings present (${config.platform})`);
for (const name of ['ACCESS_PIN', 'GATE_SECRET', 'CRON_SECRET', 'MCP_SECRET', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) {
  line(Boolean(process.env[name]), `${name} ${process.env[name] ? 'set' : 'missing'}`);
}
if (process.env.ACCESS_PIN && process.env.ACCESS_PIN.length < 8) warn('ACCESS_PIN is shorter than 8 characters. Longer is much harder to guess.');
if (!process.env.BLOB_READ_WRITE_TOKEN) warn('BLOB_READ_WRITE_TOKEN missing locally. Fine for this check; the deployed site needs a Blob store (docs/DEPLOY.md).');
if (!config.anthropicKey) warn('ANTHROPIC_API_KEY not set. Summaries use plain rule-written wording (works fine).');
if (!config.siteUrl) warn('SITE_URL not set. Set it after deploying so AI connector links use your domain.');
if (missing.length) process.exit(1);

try {
  const { buildWeek } = await import('../lib/week.js');
  const w = await buildWeek(new Date(), { advice: false });
  line(true, `Found your team in "${w.league}", week ${w.week}, record ${w.record}`);
  line(w.projectionsOk, `Projections ${w.projectionsOk ? 'loaded' : 'did not load'}`);
  line(w.liveOk, `Game schedule ${w.liveOk ? 'loaded' : 'did not load'}`);
  if (!w.injuriesOk) warn('ESPN injury notes or practice reports did not load (the rest still works).');
  line(true, `Best lineup built: ${w.optimal.filter(r => r.name).length} of ${w.optimal.length} spots, ${w.pickups.length} pickup ideas`);
  const { leagueContext } = await import('../lib/leagueData.js');
  const c = await leagueContext();
  line(c.standings.length > 0, `League view: ${c.standings.length} teams, ${c.trades.length} trade ideas, ${c.news.league.length} news items`);
} catch (err) {
  line(false, `Could not build your week: ${err.message}`);
}
process.exit(failed ? 1 : 0);
