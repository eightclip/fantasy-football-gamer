#!/usr/bin/env node
// Creates .env.local for your league: asks a few questions (or reads them from the environment
// with --yes), checks the league and team exist, and generates every secret locally.
//
//   npm run setup                         interactive
//   PLATFORM=sleeper LEAGUE_ID=... SLEEPER_USERNAME=... ACCESS_PIN=... npm run setup -- --yes
//
// Nothing secret is printed. .env.local is git-ignored and written with owner-only permissions.

import crypto from 'node:crypto';
import fs from 'node:fs';
import readline from 'node:readline/promises';
import webpush from 'web-push';
import { ENV_FILE, readEnvFile, writeEnvFile } from './env.mjs';

const args = new Set(process.argv.slice(2));
const nonInteractive = args.has('--yes');
const force = args.has('--force');
const existing = readEnvFile();

if (Object.keys(existing).length && !force && !nonInteractive) {
  console.log('.env.local already exists. Re-run with --force to replace it (existing secrets are kept).');
  process.exit(1);
}

const rl = nonInteractive ? null : readline.createInterface({ input: process.stdin, output: process.stdout });
async function ask(name, question, { fallback = '', required = true, validate } = {}) {
  let value = process.env[name] ?? existing[name] ?? '';
  for (;;) {
    if (!value && rl) value = (await rl.question(`${question}${fallback ? ` [${fallback}]` : ''}: `)).trim() || fallback;
    if (!value && !rl) value = fallback;
    const problem = !value && required ? `${name} is required.` : value && validate ? validate(value) : null;
    if (!problem) return value;
    console.log(`  ${problem}`);
    if (!rl) process.exit(1);
    value = '';
  }
}

const weakPin = pin => {
  if (pin.length < 8) return 'Use at least 8 characters. A passphrase of a few words is easiest to type and hardest to guess.';
  if (/^(.)\1+$/.test(pin) || /^(..)\1+$/.test(pin) || /^(...)\1+$/.test(pin)) return 'That repeats a pattern, which is among the first things guessed.';
  if ('0123456789012345678909876543210'.includes(pin)) return 'That is a sequence, which is among the first things guessed.';
  return null;
};

const secret = () => crypto.randomBytes(32).toString('base64url');

console.log('Fantasy Football Gamer setup. Press Enter to accept a [default].\n');
const values = {};
values.PLATFORM = (await ask('PLATFORM', 'Platform (sleeper or espn)', { fallback: 'sleeper', validate: v => (['sleeper', 'espn'].includes(v.toLowerCase()) ? null : 'Type sleeper or espn.') })).toLowerCase();
values.LEAGUE_ID = await ask('LEAGUE_ID', 'League ID (the number in your league URL)', { validate: v => (/^\d{3,25}$/.test(v) ? null : 'League IDs are digits only.') });

if (values.PLATFORM === 'sleeper') {
  values.SLEEPER_USERNAME = await ask('SLEEPER_USERNAME', 'Your Sleeper username (not your team name)');
  const user = await fetch(`https://api.sleeper.app/v1/user/${encodeURIComponent(values.SLEEPER_USERNAME)}`).then(r => r.json()).catch(() => null);
  if (!user?.user_id) { console.log(`  Sleeper has no user named "${values.SLEEPER_USERNAME}".`); process.exit(1); }
  const [league, rosters, users] = await Promise.all(['', '/rosters', '/users'].map(p => fetch(`https://api.sleeper.app/v1/league/${values.LEAGUE_ID}${p}`).then(r => r.json()).catch(() => null)));
  if (!league?.name) { console.log('  Sleeper has no league with that ID.'); process.exit(1); }
  const mine = rosters?.find(r => r.owner_id === user.user_id);
  if (!mine) { console.log(`  "${values.SLEEPER_USERNAME}" has no team in ${league.name}.`); process.exit(1); }
  const team = users?.find(u => u.user_id === user.user_id);
  console.log(`  Found your team in ${league.name}: ${team?.metadata?.team_name || team?.display_name}.`);
} else {
  values.ESPN_TEAM_ID = await ask('ESPN_TEAM_ID', 'Your ESPN team ID (teamId in your team page URL)', { validate: v => (/^\d{1,3}$/.test(v) ? null : 'Team IDs are small numbers.') });
  const priv = rl ? (await rl.question('Is the league private? (y/N): ')).trim().toLowerCase().startsWith('y') : Boolean(process.env.ESPN_S2);
  if (priv) {
    values.ESPN_S2 = await ask('ESPN_S2', 'espn_s2 cookie (see docs/PLATFORMS.md)');
    values.ESPN_SWID = await ask('ESPN_SWID', 'SWID cookie, including the braces');
  }
}

values.MANAGER_NAME = await ask('MANAGER_NAME', 'First name used in alerts and AI answers', { required: false });
values.TIMEZONE = await ask('TIMEZONE', 'Time zone', { fallback: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York',
  validate: v => { try { new Intl.DateTimeFormat('en-US', { timeZone: v }); return null; } catch { return 'Use an IANA zone like America/Chicago.'; } } });
values.SITE_URL = await ask('SITE_URL', 'Site URL once deployed (optional, e.g. https://my-team.vercel.app)', { required: false,
  validate: v => (/^https:\/\/[^\s/]+$/.test(v.replace(/\/$/, '')) ? null : 'Use the https://host form with no path.') });
values.ACCESS_PIN = await ask('ACCESS_PIN', 'Access PIN or passphrase for the site', { validate: weakPin });
values.ANTHROPIC_API_KEY = await ask('ANTHROPIC_API_KEY', 'Anthropic API key for AI-worded summaries (optional, Enter to skip)', { required: false,
  validate: v => (v.startsWith('sk-ant-') ? null : 'Anthropic keys start with sk-ant-.') });
rl?.close();

// Secrets: keep any that already exist so deployed links and phone subscriptions keep working.
values.GATE_SECRET = existing.GATE_SECRET || secret();
values.CRON_SECRET = existing.CRON_SECRET || secret();
values.MCP_SECRET = existing.MCP_SECRET || secret();
if (existing.VAPID_PUBLIC_KEY && existing.VAPID_PRIVATE_KEY) {
  values.VAPID_PUBLIC_KEY = existing.VAPID_PUBLIC_KEY;
  values.VAPID_PRIVATE_KEY = existing.VAPID_PRIVATE_KEY;
} else {
  const keys = webpush.generateVAPIDKeys();
  values.VAPID_PUBLIC_KEY = keys.publicKey;
  values.VAPID_PRIVATE_KEY = keys.privateKey;
}
if (existing.BLOB_READ_WRITE_TOKEN) values.BLOB_READ_WRITE_TOKEN = existing.BLOB_READ_WRITE_TOKEN;

writeEnvFile(values);
console.log(`\nWrote ${new URL(ENV_FILE).pathname} (owner-only permissions, git-ignored).`);
console.log('Generated: GATE_SECRET, CRON_SECRET, MCP_SECRET, VAPID keys. Values are not shown.');
console.log('\nNext: npm run check, then follow docs/DEPLOY.md (vercel link, blob store, npm run push-env, deploy).');
if (fs.existsSync(new URL('../.git', import.meta.url))) console.log('Reminder: never commit .env.local. `npm run scan` checks before you push.');
