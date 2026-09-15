// Tiny .env reader/writer shared by the scripts. Values never get printed.

import fs from 'node:fs';

export const ENV_FILE = new URL('../.env.local', import.meta.url);

export function readEnvFile(file = ENV_FILE) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

export function writeEnvFile(values, file = ENV_FILE) {
  const quote = v => (/[\s#"'$`\\]/.test(v) ? JSON.stringify(v) : v);
  const body = Object.entries(values).filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${quote(String(v))}`).join('\n') + '\n';
  fs.writeFileSync(file, body, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}

export function loadIntoProcess(file = ENV_FILE) {
  for (const [k, v] of Object.entries(readEnvFile(file))) if (process.env[k] === undefined) process.env[k] = v;
}
