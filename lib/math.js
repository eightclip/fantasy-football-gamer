// Scoring, lineup solving, win odds, pickups. Pure functions, no network.
// Deterministic on purpose: the model writes sentences, it never does this.

export const FLEX = {
  QB: ['QB'], RB: ['RB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
};
const SKIP = new Set(['BN', 'IR', 'TAXI']);

export const startingSlots = rosterPositions => rosterPositions.filter(s => !SKIP.has(s));
export const eligible = (slot, pos) => (FLEX[slot] || []).includes(pos);

// Σ stats[key] × scoring_settings[key]. Defense point-allowed buckets arrive as
// their own 0/1 stat keys in the projection feed, so they multiply like anything else.
export function score(stats, rules) {
  let total = 0;
  for (const k in stats) {
    const w = rules[k];
    if (typeof w === 'number' && typeof stats[k] === 'number') total += stats[k] * w;
  }
  return Math.round(total * 100) / 100;
}

// 0 healthy, 1 questionable, 2 doubtful, 3 not playing. Covers Sleeper and ESPN wording.
export function severity(status) {
  const s = (status || '').toLowerCase();
  if (!s || s === 'active' || s === 'healthy') return 0;
  if (s.startsWith('question')) return 1;
  if (s.startsWith('doubt')) return 2;
  return 3; // out, ir, injured reserve, pup, sus, na, dnr, cov
}

// How much of a projection to trust. Questionable usually plays, and practice
// tells you how usually: full practice almost always, a week of DNP about half the time.
export function availability(status, practice = null) {
  switch (severity(status)) {
    case 3: return 0;
    case 2: return 0.25;
    case 1: return practice === 'DNP' ? 0.5 : practice === 'Limited' ? 0.85 : practice === 'Full' ? 0.95 : 0.8;
    default: return 1;
  }
}
export const isHurt = status => severity(status) > 0;

// players: [{ id, pos, value }]. fixed: Map(slotIndex → id) for locked starters.
// Most restrictive slots fill first so FLEX gets the true leftover best.
export function solve(slots, players, fixed = new Map()) {
  const byId = new Map(players.map(p => [p.id, p]));
  const used = new Set(fixed.values());
  const lineup = slots.map((_, i) => fixed.get(i) ?? null);
  const order = slots
    .map((slot, i) => ({ slot, i, width: (FLEX[slot] || []).length }))
    .filter(({ i }) => !fixed.has(i))
    .sort((a, b) => a.width - b.width || a.i - b.i);

  for (const { slot, i } of order) {
    let best = null;
    for (const p of players) {
      if (used.has(p.id) || !eligible(slot, p.pos)) continue;
      if (!best || p.value > best.value) best = p;
    }
    if (best) { lineup[i] = best.id; used.add(best.id); }
  }
  const total = lineup.reduce((sum, id) => sum + (id ? byId.get(id)?.value || 0 : 0), 0);
  return { lineup, total: Math.round(total * 100) / 100 };
}

// ---- win odds ------------------------------------------------------------

// Rough spread of one player's weekly score around his projection. Receivers and
// defenses swing more than quarterbacks, which is what makes an upset lineup possible.
const SWING = { QB: 0.35, RB: 0.5, WR: 0.6, TE: 0.65, K: 0.5, DEF: 0.7 };
const spread = (proj, pos) => (proj > 0 ? 1.5 + proj * (SWING[pos] ?? 0.5) : 0);

// player: { proj, actual, pos, state: 'pre'|'in'|'post'|'bye', left: 0..1 share of game remaining }
export function expected(player) {
  const { proj = 0, actual = 0, pos, state = 'pre', left = 1 } = player;
  if (state === 'post' || state === 'bye') return { mean: actual, variance: 0 };
  const f = state === 'in' ? left : 1;
  const sd = spread(proj, pos) * Math.sqrt(f);
  return { mean: actual + proj * f, variance: sd * sd };
}

function chance(mine, theirs) {
  const sum = team => team.map(expected).reduce(
    (a, b) => ({ mean: a.mean + b.mean, variance: a.variance + b.variance }), { mean: 0, variance: 0 });
  const a = sum(mine), b = sum(theirs);
  const diff = a.mean - b.mean;
  const sd = Math.sqrt(a.variance + b.variance);
  const p = sd === 0 ? (diff > 0 ? 1 : diff < 0 ? 0 : 0.5) : normalCdf(diff / sd);
  return { p, mine: a.mean, theirs: b.mean };
}

export function winProbability(mine, theirs) {
  const { p, mine: m, theirs: t } = chance(mine, theirs);
  return { probability: Math.round(p * 1000) / 1000, mine: round1(m), theirs: round1(t) };
}

// Points are the proxy; winning is the goal. Starting from the points-best lineup,
// swap in whichever unlocked bench player raises her win chance most, until nothing does.
// players: [{ id, pos, value, proj, actual, state, left }]. theirs: opponent side for winProbability.
export function lineupForWinning(slots, players, fixed, theirs, start) {
  const byId = new Map(players.map(p => [p.id, p]));
  const odds = lineup => chance(lineup.filter(Boolean).map(id => byId.get(id)), theirs).p;
  let lineup = [...start];
  let best = odds(lineup);
  for (let round = 0; round < 12; round++) {
    let move = null;
    for (let i = 0; i < slots.length; i++) {
      if (fixed.has(i)) continue;
      for (const c of players) {
        if (lineup.includes(c.id) || c.state !== 'pre' || !eligible(slots[i], c.pos)) continue;
        const trial = lineup.map((id, j) => (j === i ? c.id : id));
        const p = odds(trial);
        if (p > best + 0.0005 && (!move || p > move.p)) move = { p, trial };
      }
    }
    if (!move) break;
    lineup = move.trial;
    best = move.p;
  }
  return { lineup, probability: Math.round(best * 1000) / 1000 };
}

function normalCdf(z) {
  // Abramowitz and Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t
    + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

export const round1 = n => Math.round(n * 10) / 10;

// ---- pickups -------------------------------------------------------------

// roster, freeAgents: [{ id, pos, now, next }] where now/next are this week's and
// next week's values. A pickup is worth it when the best lineups over both weeks
// get better after swapping the free agent in for her least useful player.
// fixed: this week's locked starters by slot. locked: ids whose game has started,
// which Sleeper will not let her drop.
export function findPickups(slots, roster, freeAgents, { limit = 6, minGain = 1, fixed = new Map(), locked = new Set() } = {}) {
  const lineups = players => [
    solve(slots, players.map(p => ({ id: p.id, pos: p.pos, value: p.now })), fixed),
    solve(slots, players.map(p => ({ id: p.id, pos: p.pos, value: p.next }))),
  ];
  const two = players => lineups(players).reduce((sum, l) => sum + l.total, 0);

  const base = two(roster);
  const inUse = new Set(lineups(roster).flatMap(l => l.lineup));
  const droppable = roster.filter(p => !locked.has(p.id));
  let drops = droppable.filter(p => !inUse.has(p.id));
  if (!drops.length) drops = droppable;
  drops = drops.sort((a, b) => (a.now + a.next) - (b.now + b.next)).slice(0, 3);

  // Never spend a claim on a kicker, unless she has no kicker worth starting.
  const kickerNeeded = !roster.some(p => p.pos === 'K' && p.now > 0);

  const picks = [];
  for (const fa of freeAgents) {
    if (fa.pos === 'K' && !kickerNeeded) continue;
    if (fa.now + fa.next <= 0) continue;
    let best = null;
    for (const d of drops) {
      const gain = two(roster.filter(p => p.id !== d.id).concat(fa)) - base;
      if (!best || gain > best.gain) best = { add: fa.id, drop: d.id, gain };
    }
    if (best && best.gain >= minGain) picks.push({ ...best, gain: round1(best.gain) });
  }
  return picks.sort((a, b) => b.gain - a.gain).slice(0, limit);
}

// Weeks ahead where some starting slot has nobody eligible off bye.
// byes: Map(week → Set(team)).
export function byeHoles(slots, roster, byes) {
  const holes = [];
  for (const [week, teams] of byes) {
    const players = roster.filter(p => p.team && !teams.has(p.team)).map(p => ({ id: p.id, pos: p.pos, value: 1 }));
    const { lineup } = solve(slots, players);
    const empty = slots.filter((_, i) => !lineup[i]);
    if (empty.length) {
      holes.push({ week, empty, onBye: roster.filter(p => teams.has(p.team)).map(p => p.id) });
    }
  }
  return holes;
}
