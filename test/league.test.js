import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalize, findPlayer, findTeam, standings, seasonValue, simulateSeason, tradeImpact, findTrades, usageTrend, matchNews,
} from '../lib/league.js';

const players = [
  { id: 'bijan', name: 'Bijan Robinson', pos: 'RB', team: 'ATL' },
  { id: 'brian', name: 'Brian Robinson', pos: 'RB', team: 'ATL' },
  { id: 'kj', name: "Ja'Marr Chase", pos: 'WR', team: 'CIN' },
  { id: 'aj', name: 'Aaron Jones Sr.', pos: 'RB', team: 'MIN' },
];

test('names match loosely but not wrongly', () => {
  assert.equal(normalize("Ja'Marr Chase"), 'jamarr chase');
  assert.equal(normalize('Aaron Jones Sr.'), 'aaron jones');
  assert.equal(findPlayer('jamarr chase', players).id, 'kj');
  assert.equal(findPlayer('Bijan', players).id, 'bijan');
  assert.equal(findPlayer('aaron jones', players).id, 'aj');
  assert.equal(findPlayer('Patrick Mahomes', players), null);
  const teams = [{ id: 1, name: 'Team Taco', owner: 'mike' }, { id: 2, name: 'Team Burrito', owner: 'sam' }];
  assert.equal(findTeam('taco', teams).id, 1);
  assert.equal(findTeam('Sam', teams).id, 2);
});

test('standings sort by wins then points for', () => {
  const s = standings([{ id: 1, wins: 1, losses: 1, ties: 0, pf: 200 }, { id: 2, wins: 2, losses: 0, ties: 0, pf: 150 }, { id: 3, wins: 1, losses: 1, ties: 0, pf: 250 }]);
  assert.deepEqual(s.map(t => t.id), [2, 3, 1]);
});

const info = id => ({ qb1: { pos: 'QB' }, qb2: { pos: 'QB' }, rb1: { pos: 'RB' }, rb2: { pos: 'RB' }, rb3: { pos: 'RB' }, wr1: { pos: 'WR' }, wr2: { pos: 'WR' }, wr3: { pos: 'WR' } }[id] || { pos: '?' });
const weeks = [{ week: 2, weight: 1 }, { week: 15, weight: 1.5 }];
const pts = v => ({ 2: v, 15: v });
const points = {
  2: { qb1: 20, qb2: 18, rb1: 15, rb2: 6, rb3: 14, wr1: 8, wr2: 16, wr3: 15 },
  15: { qb1: 20, qb2: 18, rb1: 15, rb2: 6, rb3: 14, wr1: 8, wr2: 16, wr3: 15 },
};
const slots = ['QB', 'RB', 'WR'];

test('season value weights the playoff weeks', () => {
  assert.equal(seasonValue(slots, ['qb1', 'rb1', 'wr1'], info, weeks, points), (20 + 15 + 8) * 2.5);
  assert.deepEqual(pts(1), { 2: 1, 15: 1 });
});

test('a trade that fills both teams’ holes helps both sides', () => {
  // She has two good RBs and a weak WR; they have two good WRs and a weak RB.
  const mine = ['qb1', 'rb1', 'rb3', 'wr1'];
  const theirs = ['qb2', 'rb2', 'wr2', 'wr3'];
  const impact = tradeImpact({ slots, info, weeks, points, mine, theirs, give: ['rb3'], get: ['wr3'] });
  assert.equal(impact.forMe, (15 - 8) * 2.5);
  assert.equal(impact.forThem, (14 - 6) * 2.5);
  assert.equal(impact.fairness, 'fair');

  const found = findTrades({ slots, info, weeks, points, myId: 1, rosters: { 1: mine, 2: theirs } });
  assert.ok(found.length >= 1);
  // Her spare running back for one of their spare receivers, whichever pairing scores best.
  assert.ok(found[0].give.every(id => id.startsWith('rb')) && found[0].get.every(id => id.startsWith('wr')), JSON.stringify(found[0]));
  assert.ok(found.every(t => t.forThem >= 0 && t.forMe >= 3));
});

test('playoff odds favor the stronger team and are repeatable', () => {
  const teams = [1, 2, 3, 4].map(id => ({ id, wins: 0, losses: 0, ties: 0, pf: 0 }));
  const games = [];
  for (let w = 1; w <= 6; w++) games.push({ week: w, a: 1, b: 2 }, { week: w, a: 3, b: 4 });
  const dist = (w, id) => ({ mean: id === 1 ? 130 : 100, variance: 400 });
  const a = simulateSeason({ teams, games, dist, playoffTeams: 2, byes: 1, sims: 2000 });
  const b = simulateSeason({ teams, games, dist, playoffTeams: 2, byes: 1, sims: 2000 });
  assert.deepEqual(a, b);
  assert.ok(a[1].playoffs > 0.95, JSON.stringify(a));
  assert.ok(a[2].playoffs < 0.2, JSON.stringify(a));
  assert.ok(Math.abs(a[3].playoffs - a[4].playoffs) < 0.1);
});

test('usage trend compares recent opportunities with earlier weeks', () => {
  const wk = (week, targets, carries, snaps) => ({ week, pts: 10, snaps, teamSnaps: 60, targets, carries });
  assert.equal(usageTrend([wk(1, 3, 0, 20)]).direction, null);
  assert.equal(usageTrend([wk(1, 3, 0, 20), wk(2, 2, 0, 18), wk(3, 8, 0, 45), wk(4, 9, 0, 50)]).direction, 'up');
  assert.equal(usageTrend([wk(1, 9, 0, 50), wk(2, 8, 0, 48), wk(3, 3, 0, 20), wk(4, 2, 0, 18)]).direction, 'down');
});

test('news attaches to exactly one player or is dropped', () => {
  const items = [
    { title: "Ja'Marr Chase: Limited in practice" },
    { title: 'Aaron Jones Sr. Hits Paydirt Against Old Team' },
    { title: 'Robinson: Unclear which one' },
    { title: 'Lions sign a kicker' },
  ];
  assert.deepEqual(matchNews(items, players).map(i => i.playerId), ['kj', 'aj']);
});
