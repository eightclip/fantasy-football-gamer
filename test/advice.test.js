import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { ruleAdvice } from '../lib/advice.js';

const base = {
  generatedAt: '2026-09-20T14:00:00.000Z', // Sun 7am Pacific
  dayKey: 'Sun',
  decisions: [],
  pickups: [],
  swaps: { start: [], sit: [], worth: 0 },
  matchup: { status: 'upcoming', opponent: 'Team Taco', winProbability: 0.54, winProbabilityWithSwaps: 0.54 },
};

test('a swap names both players, the lock and the odds gain', () => {
  const a = ruleAdvice({
    ...base,
    swaps: {
      start: [{ id: 'a', name: 'Jordan Addison', kickoff: '2026-09-20T17:00:00.000Z' }],
      sit: [{ id: 'r', name: 'Rashee Rice', kickoff: '2026-09-22T00:15:00.000Z' }],
      worth: 3.1,
    },
    matchup: { ...base.matchup, winProbabilityWithSwaps: 0.63 },
  });
  assert.equal(a.body, 'Start Jordan Addison and bench Rashee Rice before 10am today, and your chance of winning goes from 54% to 63%.');
  assert.deepEqual(a.keep, ['Jordan Addison', 'Rashee Rice', '54%', '63%']);
});

test('an injury explains the swap', () => {
  const a = ruleAdvice({
    ...base,
    decisions: [{ kind: 'injury', ids: ['k'], headline: 'Alvin Kamara is Out', text: 'Start Tyler Allgeier instead.' }],
    swaps: {
      start: [{ id: 't', name: 'Tyler Allgeier', kickoff: '2026-09-20T17:00:00.000Z' }],
      sit: [{ id: 'k', name: 'Alvin Kamara', kickoff: '2026-09-20T17:00:00.000Z' }],
      worth: 9,
    },
  });
  assert.equal(a.body, 'Alvin Kamara is Out, so start Tyler Allgeier and bench Alvin Kamara before 10am today, worth about 9.0 points.');
});

test('tuesday leads with the waiver claim', () => {
  const a = ruleAdvice({ ...base, dayKey: 'Tue', pickups: [{ name: 'Devin Neal', dropName: 'J.K. Dobbins', gain: 4.2 }] });
  assert.equal(a.body, 'Claim Devin Neal and drop J.K. Dobbins today, worth about 4.2 points over the next two weeks.');
});

test('nothing to change says so with the odds', () => {
  const a = ruleAdvice(base);
  assert.equal(a.body, 'Your lineup is set and you are 54% to beat Team Taco this week.');
  assert.deepEqual(a.keep, ['54%', 'Team Taco']);
});
