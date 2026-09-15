// When can you actually get a player who is on nobody's roster?
//
// Sleeper, rolling waivers: a player dropped stays on waivers for `waiver_clear_days`.
// Once his team's game kicks off, he is on waivers until the weekly claims run.
// Otherwise he is a free agent she can add instantly.
// Claims finish on WAIVER_DAY at WAIVER_HOUR in the league's time zone (default Wednesday 3am),
// a safe estimate for most Sleeper and ESPN leagues. Set both to match your league.

import { localAt, localParts } from './alerts.js';
import { config } from './config.js';

const DAY = 86400e3;

export function nextClaimsRun(now) {
  let ymd = localParts(now).ymd;
  for (let i = 0; i < 8; i++) {
    const at = localAt(ymd, config.waiverHour);
    if (localParts(at).weekday === config.waiverDay && at > now) return at;
    const d = new Date(`${ymd}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    ymd = d.toISOString().slice(0, 10);
  }
  return new Date(now.getTime() + 7 * DAY);
}

// droppedAt: ms of his latest drop or null. gameStarted: his game this week has kicked off.
export function claimStatus({ now, droppedAt = null, gameStarted = false, clearDays = 2 }) {
  const until = [];
  if (droppedAt && droppedAt + clearDays * DAY > now.getTime()) until.push(new Date(droppedAt + clearDays * DAY));
  if (gameStarted) until.push(nextClaimsRun(now));
  if (!until.length) return { free: true, until: null, reason: null };
  const latest = new Date(Math.max(...until.map(Number)));
  return { free: false, until: latest.toISOString(), reason: gameStarted ? 'game started' : 'recently dropped' };
}

// Can he be in her lineup for a game kicking off at `kickoff`?
export const inTimeFor = (status, kickoff) =>
  Boolean(kickoff) && (status.free || new Date(status.until) < new Date(kickoff));
