// Decides which alerts to send right now. Pure: (now, week payload, saved state) in,
// (messages, new state) out. The cron route does the fetching and the sending.
//
// Game-day reminder: the day any of her players plays, at 8am Sunday / 9am other days,
//   or two hours before the first kickoff if that is earlier. Always sent when she has a
//   player in that day's games; leads with a decision when one is open.
// Last call: about an hour before a lock when a decision is still open.
// Injury change: one of her active players gets worse news. Never on good news.
// Waivers: Tuesday morning claims; a free agent worth adding now; a player to take before her opponent does.

import { severity } from './math.js';
import { config } from './config.js';

const zone = () => config.timezone;
const HOUR = 3600e3;
const MAX_PER_RUN = 3;
const MAX_INJURY_PER_DAY = 3;

// Wall-clock parts of an instant in the league's time zone.
export function localParts(date) {
  const o = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone(), year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'long',
  }).formatToParts(date).map(p => [p.type, p.value]));
  return { ymd: `${o.year}-${o.month}-${o.day}`, hour: +o.hour % 24, minute: +o.minute, weekday: o.weekday };
}

// The instant that is hour:minute local time on a given local date.
export function localAt(ymd, hour, minute = 0) {
  const pad = n => String(n).padStart(2, '0');
  const guess = new Date(`${ymd}T${pad(hour)}:${pad(minute)}:00Z`);
  const p = localParts(guess);
  const wall = Date.UTC(+p.ymd.slice(0, 4), +p.ymd.slice(5, 7) - 1, +p.ymd.slice(8, 10), p.hour, p.minute);
  return new Date(guess.getTime() + (guess.getTime() - wall));
}

const clock = date => new Intl.DateTimeFormat('en-US', { timeZone: zone(), hour: 'numeric', minute: '2-digit' })
  .format(date).replace(':00', '').replace(/\s/g, '').toLowerCase();

const previousDay = ymd => {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

const listNames = names => (names.length <= 2 ? names.join(' and ') : `${names.slice(0, 2).join(', ')} and ${names.length - 2} more`);

export function reminderTime(firstKickoff) {
  const { ymd, weekday } = localParts(firstKickoff);
  let at = localAt(ymd, weekday === 'Sunday' ? 8 : 9);
  const twoBefore = new Date(firstKickoff.getTime() - 2 * HOUR);
  if (twoBefore < at) at = twoBefore;
  if (localParts(at).ymd !== ymd || localParts(at).hour < 6) at = localAt(previousDay(ymd), 20);
  return at;
}

export function decide(now, week, state = {}) {
  const sent = { ...(state.sent || {}) };
  const prev = state.snapshot || null;
  const queue = [];
  const add = (priority, key, title, body) => {
    if (!sent[key] && !queue.some(m => m.key === key)) queue.push({ priority, key, title, body });
  };
  const today = localParts(now);
  const decisions = week.decisions || [];
  const rows = [...(week.optimal || []), ...(week.bench || [])].filter(r => r.id);
  const snapshot = Object.fromEntries(rows.map(r => [r.id, severity(r.injury)]));

  if (!week.inSeason) return { messages: [], state: { ...state, sent, snapshot } };

  // ---- injury changes --------------------------------------------------
  const quiet = today.hour < 7 || today.hour >= 22;
  let injuryToday = Object.entries(sent)
    .filter(([k, at]) => k.startsWith('inj:') && localParts(new Date(at)).ymd === today.ymd).length;
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  for (const gp of week.gamePlayers || []) {
    const r = byId[gp.id];
    const was = prev?.[gp.id];
    if (!r || prev == null || was == null) continue;
    const sev = severity(r.injury);
    if (sev <= was) continue;
    const kickoff = new Date(gp.kickoff);
    const soon = kickoff - now < 5 * HOUR;
    if (quiet && !soon) { snapshot[gp.id] = was; continue; } // hold until morning
    const matters = sev >= 2 || ['Friday', 'Saturday', 'Sunday'].includes(today.weekday) || localParts(kickoff).ymd === today.ymd;
    if (!matters || injuryToday >= MAX_INJURY_PER_DAY) continue;
    const d = decisions.find(x => x.ids.includes(gp.id));
    add(0, `inj:${gp.id}:${r.injury}`, `${gp.name} is now ${r.injury}`,
      d ? `${d.text} Locks at ${clock(kickoff)}.` : `He is in your lineup. Kickoff ${clock(kickoff)}.`);
    injuryToday++;
  }

  // ---- last call -------------------------------------------------------
  for (const d of decisions) {
    if (!d.lockAt) continue;
    const lock = new Date(d.lockAt);
    const until = lock - now;
    if (until > 75 * 60e3 || until < 20 * 60e3) continue;
    const dayKey = `day:${localParts(lock).ymd}`;
    if (sent[dayKey] && now - new Date(sent[dayKey]) < 45 * 60e3) continue;
    add(1, `last:${d.kind}:${d.ids.join(',')}:${d.lockAt}`, `Last call: ${d.headline}`, `${d.text} Locks at ${clock(lock)}.`);
  }

  // ---- game-day reminders ----------------------------------------------
  const days = {};
  for (const gp of week.gamePlayers || []) (days[localParts(new Date(gp.kickoff)).ymd] ||= []).push(gp);
  for (const [ymd, players] of Object.entries(days)) {
    const first = new Date(players.map(p => p.kickoff).sort()[0]);
    if (now < reminderTime(first) || now >= first) continue;
    const { weekday, hour } = localParts(first);
    const due = decisions.filter(d => !d.lockAt || localParts(new Date(d.lockAt)).ymd === ymd);
    if (due.length) {
      const lock = due[0].lockAt ? new Date(due[0].lockAt) : first;
      const more = due.length > 1 ? ` Plus ${due.length - 1} more on the page.` : '';
      add(2, `day:${ymd}`, due[0].headline, `${due[0].text} Locks at ${clock(lock)}.${more}`);
    } else {
      const names = [...players].sort((a, b) => b.starting - a.starting).map(p => p.name);
      const label = hour >= 16 && weekday !== 'Sunday' ? `${weekday} night` : weekday;
      add(2, `day:${ymd}`, `${label}: ${listNames(names)} ${names.length === 1 ? 'plays' : 'play'}`,
        `First kickoff ${clock(first)}. Your lineup is set.`);
    }
  }

  // ---- waivers, free agents, blocks ----------------------------------------
  const opponent = week.matchup?.status === 'final' ? week.nextMatchup?.opponent : week.matchup?.opponent;
  const why = p => (p.winGain >= 0.02 && opponent
    ? `Raises your chance against ${opponent} by ${Math.round(p.winGain * 100)} points.`
    : `Worth about ${p.gain.toFixed(1)} points over the next two weeks.`);

  const claim = (week.pickups || []).find(p => p.gain >= 2 && !p.claim?.free);
  if (today.weekday === 'Tuesday' && today.hour >= 9 && claim) {
    const line = week.waiverPosition ? ` You are #${week.waiverPosition} in line.` : '';
    add(3, `waivers:${week.week}`, `Waivers: claim ${claim.name}`,
      `Drop ${claim.dropName}. ${why(claim)} Claims run overnight.${line}`);
  }

  const free = (week.pickups || []).find(p => p.claim?.free && (p.gain >= 2 || p.winGain >= 0.03));
  if (free && today.hour >= 8 && today.hour < 21 && ['Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].includes(today.weekday)) {
    add(3, `free:${week.week}:${free.id}`, `Free right now: ${free.name}`,
      `Add him and drop ${free.dropName}. No waiting on waivers. ${why(free)}`);
  }

  const block = (week.blocks || []).find(b => b.claim?.free && b.protects >= 0.05);
  if (block && today.hour >= 8 && today.hour < 21) {
    add(4, `block:${week.week}:${block.id}`, `Grab ${block.name} before ${block.opponent} does`,
      `They would start him. Taking him first keeps your chance of winning ${Math.round(block.protects * 100)} points higher. Drop ${block.dropName}.`);
  }

  // ---- send the most important few, save the rest for the next run --------
  const messages = queue.sort((a, b) => a.priority - b.priority).slice(0, MAX_PER_RUN)
    .map(({ key, title, body }) => ({ key, title, body }));
  for (const m of messages) sent[m.key] = now.toISOString();
  for (const [k, at] of Object.entries(sent)) if (now - new Date(at) > 21 * 24 * HOUR) delete sent[k];

  return { messages, state: { ...state, sent, snapshot } };
}
