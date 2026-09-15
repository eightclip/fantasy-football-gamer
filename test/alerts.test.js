import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { decide, localAt, localParts, reminderTime } from '../lib/alerts.js';

// Week 2 of 2026: Thursday Sep 17, Sunday Sep 20, Monday Sep 21 (Pacific).
const THU_NIGHT = '2026-09-18T00:15:00.000Z'; // Thu 5:15pm PDT
const SUN_EARLY = '2026-09-20T17:00:00.000Z'; // Sun 10:00am PDT
const SUN_LATE = '2026-09-20T20:25:00.000Z'; // Sun 1:25pm PDT
const MON_NIGHT = '2026-09-22T00:15:00.000Z'; // Mon 5:15pm PDT
const SAT_GAME = '2026-09-19T17:30:00.000Z'; // Sat 10:30am PDT

const player = (id, name, kickoff, extra = {}) => ({ id, name, kickoff, injury: null, ...extra });

function baseWeek(overrides = {}) {
  const optimal = [
    player('rice', 'Rashee Rice', THU_NIGHT),
    player('bijan', 'Bijan Robinson', SUN_EARLY),
    player('saquon', 'Saquon Barkley', SUN_LATE),
    player('waddle', 'Jaylen Waddle', MON_NIGHT),
  ];
  return {
    week: 2,
    inSeason: true,
    optimal,
    bench: [player('addison', 'Jordan Addison', SUN_EARLY)],
    gamePlayers: optimal.map(p => ({ id: p.id, name: p.name, kickoff: p.kickoff, starting: true })),
    decisions: [],
    pickups: [],
    ...overrides,
  };
}

const at = iso => new Date(iso);

test('pacific time helpers round-trip', () => {
  const t = localAt('2026-09-20', 8);
  assert.equal(t.toISOString(), '2026-09-20T15:00:00.000Z');
  assert.deepEqual(localParts(t), { ymd: '2026-09-20', hour: 8, minute: 0, weekday: 'Sunday' });
  assert.equal(reminderTime(at(SUN_EARLY)).toISOString(), '2026-09-20T15:00:00.000Z'); // 8am Sunday
  assert.equal(reminderTime(at(THU_NIGHT)).toISOString(), '2026-09-17T16:00:00.000Z'); // 9am Thursday
  // A 6:30am London game: two hours before is too early, so remind the night before.
  assert.equal(reminderTime(at('2026-09-20T13:30:00.000Z')).toISOString(), '2026-09-20T03:00:00.000Z');
});

test('thursday reminder names her player even with nothing to decide', () => {
  const { messages } = decide(at('2026-09-17T16:15:00.000Z'), baseWeek(), { snapshot: {} });
  assert.equal(messages.length, 1);
  assert.equal(messages[0].title, 'Thursday night: Rashee Rice plays');
  assert.equal(messages[0].body, 'First kickoff 5:15pm. Your lineup is set.');
});

test('sunday morning reminder leads with the open decision', () => {
  const week = baseWeek({
    decisions: [{ kind: 'swap', ids: ['addison', 'bijan'], lockAt: SUN_EARLY, headline: 'Start Jordan Addison over Bijan Robinson', text: 'Worth about 3.0 points.' }],
  });
  const { messages } = decide(at('2026-09-20T15:05:00.000Z'), week, { snapshot: {} });
  assert.equal(messages[0].key, 'day:2026-09-20');
  assert.equal(messages[0].title, 'Start Jordan Addison over Bijan Robinson');
  assert.equal(messages[0].body, 'Worth about 3.0 points. Locks at 10am.');
});

test('monday and saturday games get their own reminders', () => {
  const mon = decide(at('2026-09-21T16:00:00.000Z'), baseWeek(), { snapshot: {} }).messages;
  assert.equal(mon[0].title, 'Monday night: Jaylen Waddle plays');
  const week = baseWeek();
  week.gamePlayers.push({ id: 'x', name: 'Saturday Guy', kickoff: SAT_GAME, starting: true });
  const sat = decide(at('2026-09-19T16:00:00.000Z'), week, { snapshot: {} }).messages;
  assert.equal(sat[0].title, 'Saturday: Saturday Guy plays');
});

test('each reminder sends once', () => {
  const first = decide(at('2026-09-17T16:15:00.000Z'), baseWeek(), { snapshot: {} });
  const again = decide(at('2026-09-17T16:30:00.000Z'), baseWeek(), first.state);
  assert.equal(again.messages.length, 0);
});

test('last call fires about an hour before a lock that is still open', () => {
  const decision = { kind: 'injury', ids: ['saquon'], lockAt: SUN_LATE, headline: 'Saquon Barkley is Doubtful', text: 'Start Jordan Addison instead.' };
  const state = { snapshot: {}, sent: { 'day:2026-09-20': '2026-09-20T15:00:00.000Z' } };
  const { messages } = decide(at('2026-09-20T19:30:00.000Z'), baseWeek({ decisions: [decision] }), state);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].title, 'Last call: Saquon Barkley is Doubtful');
  assert.equal(messages[0].body, 'Start Jordan Addison instead. Locks at 1:25pm.');
});

test('injury downgrades alert, upgrades and first runs do not', () => {
  const week = baseWeek();
  week.optimal[2] = { ...week.optimal[2], injury: 'Out' };
  const firstRun = decide(at('2026-09-19T17:00:00.000Z'), week, {});
  assert.equal(firstRun.messages.filter(m => m.key.startsWith('inj:')).length, 0);

  const worse = decide(at('2026-09-19T17:00:00.000Z'), week, { snapshot: { saquon: 1 } });
  const inj = worse.messages.find(m => m.key.startsWith('inj:'));
  assert.equal(inj.title, 'Saquon Barkley is now Out');

  const better = baseWeek();
  const { messages } = decide(at('2026-09-19T17:00:00.000Z'), better, { snapshot: { saquon: 3 } });
  assert.equal(messages.filter(m => m.key.startsWith('inj:')).length, 0);
});

test('overnight injury news waits for morning unless kickoff is close', () => {
  const week = baseWeek();
  week.optimal[3] = { ...week.optimal[3], injury: 'Doubtful' };
  const night = decide(at('2026-09-20T07:00:00.000Z'), week, { snapshot: { waddle: 0 } }); // Sun 12am
  assert.equal(night.messages.length, 0);
  assert.equal(night.state.snapshot.waddle, 0);
  const morning = decide(at('2026-09-20T15:00:00.000Z'), week, night.state);
  assert.ok(morning.messages.some(m => m.title === 'Jaylen Waddle is now Doubtful'));
});

test('tuesday waivers only when the claim is worth it', () => {
  const tue = at('2026-09-22T16:30:00.000Z');
  const onWaivers = { free: false, until: '2026-09-23T10:00:00.000Z' };
  const small = decide(tue, baseWeek({ pickups: [{ name: 'A', dropName: 'B', gain: 1.2, claim: onWaivers }] }), { snapshot: {} });
  assert.equal(small.messages.length, 0);
  const big = decide(tue, baseWeek({
    waiverPosition: 3,
    pickups: [{ id: 'neal', name: 'Devin Neal', dropName: 'J.K. Dobbins', gain: 6.4, claim: onWaivers }],
  }), { snapshot: {} });
  assert.equal(big.messages[0].title, 'Waivers: claim Devin Neal');
  assert.equal(big.messages[0].body, 'Drop J.K. Dobbins. Worth about 6.4 points over the next two weeks. Claims run overnight. You are #3 in line.');
});

test('a free agent worth adding now gets one heads-up', () => {
  const wed = at('2026-09-23T15:30:00.000Z'); // Wed 8:30am
  const week = baseWeek({
    matchup: { opponent: 'Team Taco' },
    pickups: [{ id: 'neal', name: 'Devin Neal', dropName: 'J.K. Dobbins', gain: 1.5, winGain: 0.06, claim: { free: true } }],
  });
  const first = decide(wed, week, { snapshot: {} });
  assert.equal(first.messages[0].title, 'Free right now: Devin Neal');
  assert.equal(first.messages[0].body, 'Add him and drop J.K. Dobbins. No waiting on waivers. Raises your chance against Team Taco by 6 points.');
  assert.equal(decide(wed, week, first.state).messages.length, 0);
});

test('blocks name the opponent and what it protects', () => {
  const fri = at('2026-09-18T19:00:00.000Z');
  const week = baseWeek({
    blocks: [{ id: 'k', name: 'Kyren Williams', opponent: 'Team Taco', protects: 0.07, dropName: 'J.K. Dobbins', claim: { free: true } }],
  });
  const { messages } = decide(fri, week, { snapshot: {} });
  assert.equal(messages[0].title, 'Grab Kyren Williams before Team Taco does');
});

test('nothing outside the season', () => {
  const { messages } = decide(at('2026-09-17T16:15:00.000Z'), baseWeek({ inSeason: false }), { snapshot: {} });
  assert.equal(messages.length, 0);
});
