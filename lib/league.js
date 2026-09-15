// League-wide math: standings, playoff odds, rest-of-season team strength, trades,
// usage trends and news matching. Pure functions; lib/leagueData.js feeds them.

import { solve, expected, round1 } from './math.js';

// ---- names -----------------------------------------------------------------

export function normalize(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[.'’`-]/g, '').replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim();
}

// Best player id for a free-text name. candidates: [{ id, name, team, pos }].
export function findPlayer(query, candidates) {
  const q = normalize(query);
  if (!q) return null;
  const exact = candidates.filter(c => normalize(c.name) === q);
  if (exact.length) return exact[0];
  const words = q.split(' ');
  const scored = candidates.map(c => {
    const n = normalize(c.name);
    const parts = n.split(' ');
    let s = 0;
    if (n.includes(q)) s = 3;
    else if (words.every(w => parts.some(p => p.startsWith(w)))) s = 2;
    else if (words.length === 1 && parts[parts.length - 1] === q) s = 2;
    return { c, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s);
  if (!scored.length) return null;
  // A bare last name shared by several players is ambiguous; prefer rostered or relevant ones first.
  return scored[0].c;
}

export function findTeam(query, teams) {
  const q = normalize(query);
  if (!q) return null;
  return teams.find(t => normalize(t.name) === q || normalize(t.owner) === q)
    || teams.find(t => normalize(t.name).includes(q) || normalize(t.owner).includes(q) || q.includes(normalize(t.name)))
    || null;
}

// ---- standings --------------------------------------------------------------

// tiebreak: optional id → number (playoff odds) for teams level on wins and points.
export function standings(teams, tiebreak = () => 0) {
  return [...teams].sort((a, b) => (b.wins + b.ties / 2) - (a.wins + a.ties / 2) || b.pf - a.pf || tiebreak(b.id) - tiebreak(a.id));
}

// ---- rest of season ------------------------------------------------------------

// weeks: [{ week, weight }]. points: { week: { playerId: pts } }. info: id → { pos }.
export function seasonValue(slots, ids, info, weeks, points) {
  let total = 0;
  for (const { week, weight } of weeks) {
    const pw = points[week] || {};
    const players = ids.map(id => ({ id, pos: info(id).pos, value: pw[id] || 0 }));
    total += weight * solve(slots, players).total;
  }
  return round1(total);
}

export function rawValue(ids, weeks, points) {
  let total = 0;
  for (const id of ids) for (const { week, weight } of weeks) total += weight * (points[week]?.[id] || 0);
  return round1(total);
}

// ---- playoff odds ----------------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand) {
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// Lineup mean and variance for a set of players: [{ proj, actual, pos, state, left }].
export function lineupDistribution(players) {
  return players.map(expected).reduce((a, b) => ({ mean: a.mean + b.mean, variance: a.variance + b.variance }), { mean: 0, variance: 0 });
}

// teams: [{ id, wins, losses, ties, pf }]. games: [{ week, a, b }] still to decide.
// dist(week, teamId) → { mean, variance }. Returns id → { playoffs, bye, wins }.
export function simulateSeason({ teams, games, dist, playoffTeams = 6, byes = 2, sims = 4000, seed = 7 }) {
  const rand = rng(seed);
  const tally = Object.fromEntries(teams.map(t => [t.id, { playoffs: 0, bye: 0, wins: 0 }]));
  const cache = new Map();
  const d = (w, id) => {
    const k = `${w}:${id}`;
    if (!cache.has(k)) cache.set(k, dist(w, id));
    return cache.get(k);
  };
  for (let s = 0; s < sims; s++) {
    const rec = Object.fromEntries(teams.map(t => [t.id, { w: t.wins + t.ties / 2, pf: t.pf }]));
    for (const g of games) {
      const da = d(g.week, g.a), db = d(g.week, g.b);
      const sa = da.mean + Math.sqrt(da.variance) * gaussian(rand);
      const sb = db.mean + Math.sqrt(db.variance) * gaussian(rand);
      rec[g.a].pf += sa; rec[g.b].pf += sb;
      if (sa > sb) rec[g.a].w += 1; else if (sb > sa) rec[g.b].w += 1; else { rec[g.a].w += 0.5; rec[g.b].w += 0.5; }
    }
    const order = teams.map(t => t.id).sort((x, y) => rec[y].w - rec[x].w || rec[y].pf - rec[x].pf);
    order.forEach((id, i) => {
      tally[id].wins += rec[id].w;
      if (i < playoffTeams) tally[id].playoffs++;
      if (i < byes) tally[id].bye++;
    });
  }
  return Object.fromEntries(Object.entries(tally).map(([id, t]) => [id, {
    playoffs: Math.round((t.playoffs / sims) * 1000) / 1000,
    bye: Math.round((t.bye / sims) * 1000) / 1000,
    wins: round1(t.wins / sims),
  }]));
}

// ---- trades --------------------------------------------------------------------

// Would this trade make both teams better for the rest of the season?
// Returns the change in each side's best-lineup value and a fairness read on raw value.
export function tradeImpact({ slots, info, weeks, points, mine, theirs, give, get }) {
  const mineAfter = mine.filter(id => !give.includes(id)).concat(get);
  const theirsAfter = theirs.filter(id => !get.includes(id)).concat(give);
  const forMe = round1(seasonValue(slots, mineAfter, info, weeks, points) - seasonValue(slots, mine, info, weeks, points));
  const forThem = round1(seasonValue(slots, theirsAfter, info, weeks, points) - seasonValue(slots, theirs, info, weeks, points));
  const givenRaw = rawValue(give, weeks, points);
  const gotRaw = rawValue(get, weeks, points);
  const ratio = givenRaw > 0 ? gotRaw / givenRaw : Infinity;
  const fairness = ratio <= 1.1 ? 'fair' : ratio <= 1.3 ? 'a stretch' : 'unlikely';
  return { forMe, forThem, givenRaw, gotRaw, fairness };
}

// Search one-for-one, two-for-one and one-for-two trades with every other team.
// Keeps trades that help her by at least `minGain` without hurting them, and that do
// not ask for much more raw value than she gives (the offers people actually accept).
export function findTrades({ slots, info, weeks, points, myId, rosters, perTeam = 2, limit = 6, minGain = 3, pool = 8 }) {
  const top = ids => [...ids].map(id => ({ id, v: rawValue([id], weeks, points) })).filter(x => x.v > 0)
    .sort((a, b) => b.v - a.v).slice(0, pool).map(x => x.id);
  const pairs = ids => ids.flatMap((a, i) => ids.slice(i + 1).map(b => [a, b]));
  const mine = rosters[myId];
  const myBase = seasonValue(slots, mine, info, weeks, points);
  const myTop = top(mine);
  const found = [];

  for (const [teamId, theirs] of Object.entries(rosters)) {
    if (String(teamId) === String(myId)) continue;
    const theirBase = seasonValue(slots, theirs, info, weeks, points);
    const theirTop = top(theirs);
    const shapes = [
      ...myTop.flatMap(g => theirTop.map(r => [[g], [r]])),
      ...pairs(myTop).flatMap(g => theirTop.map(r => [g, [r]])),
      ...myTop.flatMap(g => pairs(theirTop).map(r => [[g], r])),
    ];
    const teamFound = [];
    for (const [give, get] of shapes) {
      const mineAfter = mine.filter(id => !give.includes(id)).concat(get);
      const forMe = round1(seasonValue(slots, mineAfter, info, weeks, points) - myBase);
      if (forMe < minGain) continue;
      const theirsAfter = theirs.filter(id => !get.includes(id)).concat(give);
      const forThem = round1(seasonValue(slots, theirsAfter, info, weeks, points) - theirBase);
      if (forThem < 0) continue;
      const givenRaw = rawValue(give, weeks, points), gotRaw = rawValue(get, weeks, points);
      if (gotRaw > givenRaw * 1.3) continue;
      teamFound.push({ teamId: Number(teamId), give, get, forMe, forThem, fairness: gotRaw <= givenRaw * 1.1 ? 'fair' : 'a stretch' });
    }
    teamFound.sort((a, b) => b.forMe + Math.min(b.forThem, 5) - (a.forMe + Math.min(a.forThem, 5)));
    found.push(...teamFound.slice(0, perTeam));
  }
  // Variety: no single player of hers anchors more than two ideas.
  const uses = new Map();
  return found.sort((a, b) => b.forMe + Math.min(b.forThem, 5) - (a.forMe + Math.min(a.forThem, 5)))
    .filter(t => {
      if (t.give.some(id => (uses.get(id) || 0) >= 2)) return false;
      t.give.forEach(id => uses.set(id, (uses.get(id) || 0) + 1));
      return true;
    })
    .slice(0, limit);
}

// ---- usage ---------------------------------------------------------------------

// weekly: [{ week, pts, snaps, teamSnaps, targets, carries }] oldest first.
export function usageTrend(weekly) {
  const played = weekly.filter(w => w.snaps > 0 || w.pts);
  if (!played.length) return null;
  const avg = (list, f) => (list.length ? list.reduce((s, w) => s + f(w), 0) / list.length : 0);
  const opps = w => w.targets + w.carries;
  const share = w => (w.teamSnaps ? w.snaps / w.teamSnaps : 0);
  const recent = played.slice(-2), earlier = played.slice(0, -2);
  const out = {
    games: played.length,
    ptsPerGame: round1(avg(played, w => w.pts)),
    opportunitiesPerGame: round1(avg(played, opps)),
    snapShare: Math.round(avg(played, share) * 100) / 100,
    direction: null,
  };
  if (earlier.length) {
    const change = avg(recent, opps) - avg(earlier, opps);
    const shareChange = avg(recent, share) - avg(earlier, share);
    out.direction = change >= 2 || shareChange >= 0.1 ? 'up' : change <= -2 || shareChange <= -0.1 ? 'down' : 'steady';
    out.recentOpportunities = round1(avg(recent, opps));
  }
  return out;
}

// ---- news ----------------------------------------------------------------------

// Attach player ids to headlines. RotoWire titles are "Name: blurb"; RotoBaller titles start
// with the name. Only names that match exactly one player are trusted.
export function matchNews(items, players) {
  const byName = new Map();
  for (const p of players) {
    const n = normalize(p.name);
    if (!byName.has(n)) byName.set(n, []);
    byName.get(n).push(p.id);
  }
  const lookup = name => {
    const ids = byName.get(normalize(name));
    return ids && ids.length === 1 ? ids[0] : null;
  };
  return items.map(item => {
    let id = null;
    const colon = item.title.indexOf(':');
    if (colon > 0) id = lookup(item.title.slice(0, colon));
    if (!id) {
      const words = item.title.split(/\s+/);
      for (let k = Math.min(4, words.length); k >= 2 && !id; k--) id = lookup(words.slice(0, k).join(' '));
    }
    return { ...item, playerId: id };
  }).filter(i => i.playerId);
}
