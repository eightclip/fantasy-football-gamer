import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { score, solve, winProbability, findPickups, byeHoles, availability, severity, lineupForWinning } from '../lib/math.js';

test('scoring reads the league rules, including defense buckets', () => {
  const rules = { rec: 1, rec_yd: 0.1, pts_allow_14_20: 1, sack: 1 };
  assert.equal(score({ rec: 5, rec_yd: 60, rush_yd: 30 }, rules), 11);
  assert.equal(score({ pts_allow_14_20: 1, sack: 2.5, pts_allow: 17 }, rules), 3.5);
});

test('FLEX solver beats naive array-order fill', () => {
  const slots = ['FLEX', 'RB', 'WR'];
  const players = [
    { id: 'rb1', pos: 'RB', value: 20 },
    { id: 'wr1', pos: 'WR', value: 15 },
    { id: 'wr2', pos: 'WR', value: 12 },
  ];
  // Naive: FLEX←rb1, RB←nobody, WR←wr1 = 35. Correct: RB←rb1, WR←wr1, FLEX←wr2 = 47.
  const { lineup, total } = solve(slots, players);
  assert.deepEqual(lineup, ['wr2', 'rb1', 'wr1']);
  assert.equal(total, 47);
});

test('locked starters stay put and cannot be reused', () => {
  const slots = ['RB', 'FLEX'];
  const players = [
    { id: 'played', pos: 'RB', value: 3 },
    { id: 'rb2', pos: 'RB', value: 10 },
    { id: 'wr', pos: 'WR', value: 8 },
  ];
  const { lineup } = solve(slots, players, new Map([[0, 'played']]));
  assert.deepEqual(lineup, ['played', 'rb2']);
});

test('injury tags and practice reports discount projections', () => {
  assert.equal(availability('Out'), 0);
  assert.equal(availability('Injured Reserve'), 0);
  assert.equal(availability('Doubtful'), 0.25);
  assert.equal(availability('Questionable', 'Full'), 0.95);
  assert.equal(availability('Questionable', 'DNP'), 0.5);
  assert.equal(availability('Active'), 1);
  assert.equal(availability(null, 'DNP'), 1);
  assert.deepEqual(['Active', 'Questionable', 'Doubtful', 'Out', 'IR'].map(severity), [0, 1, 2, 3, 3]);
});

test('the winning lineup takes a volatile flex when she is the underdog', () => {
  const slots = ['QB', 'FLEX'];
  const players = [
    { id: 'qb', pos: 'QB', value: 20, proj: 20, state: 'pre' },
    { id: 'steadyrb', pos: 'RB', value: 12, proj: 12, state: 'pre' },
    { id: 'boomwr', pos: 'WR', value: 11.8, proj: 11.8, state: 'pre' },
  ];
  const start = solve(slots, players).lineup;
  assert.deepEqual(start, ['qb', 'steadyrb']);
  const underdog = lineupForWinning(slots, players, new Map(), [{ state: 'post', actual: 45 }], start);
  assert.deepEqual(underdog.lineup, ['qb', 'boomwr']);
  const favored = lineupForWinning(slots, players, new Map(), [{ state: 'post', actual: 20 }], start);
  assert.deepEqual(favored.lineup, ['qb', 'steadyrb']);
});

test('win odds follow the projections and settle once games end', () => {
  const even = winProbability([{ proj: 100 }], [{ proj: 100 }]);
  assert.equal(even.probability, 0.5);
  const team = total => Array.from({ length: 9 }, () => ({ proj: total / 9 }));
  const ahead = winProbability(team(120), team(100));
  assert.ok(ahead.probability > 0.65 && ahead.probability < 0.8, String(ahead.probability));
  const final = winProbability([{ state: 'post', actual: 90 }], [{ state: 'post', actual: 91 }]);
  assert.equal(final.probability, 0);
  const live = winProbability([{ state: 'in', actual: 30, proj: 20, left: 0.5 }], [{ state: 'post', actual: 35 }]);
  assert.equal(live.mine, 40);
});

test('pickups swap in a free agent for the least useful player', () => {
  const slots = ['RB', 'WR'];
  const roster = [
    { id: 'rb', pos: 'RB', now: 12, next: 12 },
    { id: 'wr', pos: 'WR', now: 6, next: 6 },
    { id: 'benchrb', pos: 'RB', now: 2, next: 1 },
  ];
  const free = [
    { id: 'fawr', pos: 'WR', now: 10, next: 9 },
    { id: 'fak', pos: 'K', now: 9, next: 9 },
    { id: 'worse', pos: 'WR', now: 5, next: 5 },
  ];
  const picks = findPickups(slots, roster, free);
  assert.equal(picks.length, 1);
  assert.deepEqual(picks[0], { add: 'fawr', drop: 'benchrb', gain: 7 });
});

test('bye holes flag a slot nobody can fill', () => {
  const slots = ['QB', 'DEF'];
  const roster = [
    { id: 'qb', pos: 'QB', team: 'KC' },
    { id: 'd1', pos: 'DEF', team: 'SF' },
  ];
  const holes = byeHoles(slots, roster, new Map([[5, new Set(['SF'])], [6, new Set(['NYJ'])]]));
  assert.deepEqual(holes, [{ week: 5, empty: ['DEF'], onBye: ['d1'] }]);
});

test('pickups never drop a locked player or reshuffle a locked slot', () => {
  const slots = ['QB', 'WR'];
  const roster = [
    { id: 'qb', pos: 'QB', now: 18, next: 18 },
    { id: 'wr', pos: 'WR', now: 9, next: 9 },
    { id: 'benchwr', pos: 'WR', now: 0, next: 3 },
  ];
  const free = [{ id: 'faqb', pos: 'QB', now: 17, next: 16 }];
  // qb already played this week: he fills QB now and cannot be dropped.
  const picks = findPickups(slots, roster, free, {
    fixed: new Map([[0, 'qb']]), locked: new Set(['qb', 'benchwr']),
  });
  assert.deepEqual(picks, []);
});
