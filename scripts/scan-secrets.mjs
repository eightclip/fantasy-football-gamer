#!/usr/bin/env node
// Fails if any tracked file looks like it contains a secret. Runs in CI and before you push.
// Optional: list personal strings you never want published (league IDs, usernames, names),
// one per line, in .scan-denylist (git-ignored) to check those too.

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const files = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean)
  .filter(f => !/^node_modules\/|package-lock\.json$|\.png$|\.ico$/.test(f));

const patterns = [
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI key', /sk-(proj-)?[A-Za-z0-9]{32,}/],
  ['Vercel Blob token', /vercel_blob_rw_[A-Za-z0-9_]{20,}/],
  ['Vercel token', /\b(vc[pkirs]|vercel)_[A-Za-z0-9]{24,}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{36,}\b/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ['Private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['ESPN cookie', /espn_s2=[A-Za-z0-9%]{40,}/],
  ['Assigned secret', /^\s*(ACCESS_PIN|GATE_SECRET|CRON_SECRET|MCP_SECRET|VAPID_PRIVATE_KEY|ANTHROPIC_API_KEY|ESPN_S2|ESPN_SWID|BLOB_READ_WRITE_TOKEN)\s*=\s*\S+/m],
];
const deny = fs.existsSync('.scan-denylist')
  ? fs.readFileSync('.scan-denylist', 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))
  : [];

let hits = 0;
for (const f of files) {
  if (f === '.env.example' || f === 'scripts/scan-secrets.mjs') continue;
  let body;
  try { body = fs.readFileSync(f, 'utf8'); } catch { continue; }
  for (const [label, re] of patterns) {
    if (re.test(body)) { console.log(`${f}: looks like ${label}`); hits++; }
  }
  for (const word of deny) {
    if (body.toLowerCase().includes(word.toLowerCase())) { console.log(`${f}: contains a denylisted string`); hits++; }
  }
}
if (fs.existsSync('.env.example')) {
  const example = fs.readFileSync('.env.example', 'utf8');
  if (/^[A-Z_]+=\S+/m.test(example.replace(/^(PLATFORM|TIMEZONE|WAIVER_DAY|WAIVER_HOUR|SITE_NAME|ADVICE_MODEL)=.*$/gm, ''))) {
    console.log('.env.example: has a value filled in; keep it to placeholders'); hits++;
  }
}
console.log(hits ? `\n${hits} possible secret(s) found. Nothing was changed.` : `Scanned ${files.length} files: no secrets found.`);
process.exit(hits ? 1 : 0);
