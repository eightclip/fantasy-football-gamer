#!/usr/bin/env node
// Copies .env.local into your linked Vercel project's Production environment.
// Values go straight to the Vercel CLI as arguments and are never printed.
//
//   npm run push-env              add variables that are not in Vercel yet
//   npm run push-env -- --force   overwrite existing ones too
//   npm run push-env -- --dry-run list what would be sent (names only)

import { spawnSync } from 'node:child_process';
import { readEnvFile } from './env.mjs';

const args = new Set(process.argv.slice(2));
const values = readEnvFile();
const PUBLIC = new Set(['PLATFORM', 'LEAGUE_ID', 'SLEEPER_USERNAME', 'ESPN_TEAM_ID', 'MANAGER_NAME', 'TIMEZONE', 'SITE_URL', 'SITE_NAME', 'VAPID_PUBLIC_KEY', 'WAIVER_DAY', 'WAIVER_HOUR', 'ADVICE', 'ADVICE_MODEL', 'SEASON']);
const SKIP = new Set(['BLOB_READ_WRITE_TOKEN']); // added by `vercel blob create-store`

const names = Object.keys(values).filter(k => !SKIP.has(k) && !k.startsWith('VERCEL_'));
if (!names.length) { console.log('No .env.local found. Run npm run setup first.'); process.exit(1); }

for (const name of names) {
  const kind = PUBLIC.has(name) ? 'plain' : 'sensitive';
  if (args.has('--dry-run')) { console.log(`${name} (${kind})`); continue; }
  const cli = ['vercel', 'env', 'add', name, 'production', '--value', values[name], '--yes'];
  if (kind === 'sensitive') cli.push('--sensitive');
  if (args.has('--force')) cli.push('--force');
  const r = spawnSync('npx', cli, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  const out = `${r.stdout}${r.stderr}`;
  const ok = r.status === 0 && /added|updated|overwrit/i.test(out);
  const exists = /already exists/i.test(out);
  console.log(`${ok ? 'set    ' : exists ? 'exists ' : 'FAILED '} ${name}${exists ? ' (use --force to overwrite)' : ''}`);
}
if (!args.has('--dry-run')) console.log('\nRedeploy for new values to take effect: npx vercel deploy --prod');
