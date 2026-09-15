import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { whatToChange, howAmIDoing, pickups } from '../lib/briefing.js';

const base = {
  league: 'Example League', week: 2, record: '1-0', dayKey: 'Sun',
  projectionsOk: true, liveOk: true, injuriesOk: true,
  optimal: [], swaps: { start: [], sit: [], worth: 0 }, decisions: [], pickups: [], blocks: [],
  gamePlayers: [], totals: { best: 120, current: 120 },
};

test('nothing to change says so plainly', () => {
  assert.equal(whatToChange(base), 'Nothing to change right now. The lineup already set is the best one.');
});

test('changes become numbered Sleeper steps with lock times and never touch locked players', () => {
  const w = {
    ...base,
    optimal: [
      { slot: 'WR', name: 'Jordan Addison', pos: 'WR', team: 'MIN', starting: false, locked: false, kickoff: '2026-09-20T17:00:00.000Z' },
      { slot: 'QB', name: 'Lamar Jackson', pos: 'QB', team: 'BAL', starting: false, locked: true },
      { slot: 'TE', name: null },
    ],
    swaps: { start: [], sit: [{ id: 'r', name: 'Rashee Rice', locked: false }], worth: 3.2 },
  };
  assert.equal(whatToChange(w), [
    'Do this in your fantasy app:',
    '1. Start Jordan Addison (WR, MIN) in the WR spot. Locks Sun 10am PT.',
    '2. Fill the empty TE spot. Nobody on the roster can play there; pick someone up.',
    '3. Move Rashee Rice to the bench.',
    'The lineup changes are worth about 3.2 projected points.',
  ].join('\n'));
});

test('status and pickups carry odds, claim timing and data warnings', () => {
  const w = {
    ...base, projectionsOk: false, waiverPosition: 3, teams: 8, claimsRun: '2026-09-23T10:00:00.000Z',
    matchup: { status: 'live', you: 80.2, them: 71, opponent: 'Team Taco', opponentRecord: '0-1', winProbability: 0.71, winProbabilityWithSwaps: 0.71, youProjected: 118, themProjected: 104 },
    pickups: [{ name: 'Devin Neal', pos: 'RB', team: 'NO', dropName: 'J.K. Dobbins', gain: 4.2, winGain: 0.03, claim: { free: false, until: '2026-09-23T10:00:00.000Z' } }],
  };
  const status = howAmIDoing(w);
  assert.match(status, /Live: Alex 80\.2, Team Taco \(0-1\) 71\.0\./);
  assert.match(status, /71% chance to win/);
  assert.match(status, /Data warning: projections are down/);
  assert.match(pickups(w), /Waiver priority: #3 of 8\. Claims run Wed 3am PT\./);
  assert.match(pickups(w), /Add Devin Neal \(RB, NO\), drop J\.K\. Dobbins: \+4\.2 pts, \+3 points of win chance this week; on waivers until Wed 3am PT\./);
});

import { standingsText, tradesText, tradeVerdictText, teamText } from '../lib/briefing.js';

const leagueFixture = {
  league: 'Example League', week: 3, weekDone: false, playoffStart: 15, projectionsOk: true,
  tradesOpen: true, deadline: 11,
  standings: [
    { rank: 1, name: 'Team Taco', record: '2-0', pf: 260.4, playoffs: 0.91, bye: 0.55, projectedWins: 9.1 },
    { rank: 2, name: 'alex', isMine: true, record: '1-1', pf: 240, playoffs: 0.74, bye: 0.21, projectedWins: 7.4 },
  ],
  trades: [{ partner: 'Team Nacho', give: [{ name: 'Saquon Barkley', pos: 'RB' }], get: [{ name: 'Drake London', pos: 'WR' }], forMe: 5.3, forThem: 6, playoffGainForMe: 6.8, fairness: 'fair' }],
};

test('standings name Alex and give odds', () => {
  const t = standingsText(leagueFixture);
  assert.match(t, /standings after week 2\./);
  assert.match(t, /2\. alex \(Alex\): 1-1, 240\.0 points for, 74% playoffs, 21% bye, about 7\.4 wins/);
});

test('trade ideas and verdicts read plainly', () => {
  assert.match(tradesText(leagueFixture), /1\. With Team Nacho: give Saquon Barkley \(RB\), get Drake London \(WR\)\. Alex's team \+5\.3 \(6\.8 in the playoff weeks\), them \+6\.0\. Value is fair\./);
  assert.equal(tradesText({ ...leagueFixture, tradesOpen: false }), 'The trade deadline (week 11) has passed.');
  assert.equal(tradeVerdictText({ error: 'Could not find: Bob.' }), 'Could not find: Bob.');
  assert.match(tradeVerdictText({ partner: 'Team Nacho', give: [{ name: 'A', pos: 'RB' }], get: [{ name: 'B', pos: 'WR' }], forMe: -2, forThem: 4, playoffGainForMe: -1, fairness: 'fair', verdict: 'Bad for you. Your best lineups get worse.', tradesOpen: true }),
    /Alex's team: -2\.0 projected lineup points[\s\S]*Bad for you/);
  assert.equal(teamText({ error: 'No team matching "x".' }), 'No team matching "x".');
});

test('pickup steps never drop the same player twice', () => {
  const w = {
    ...base, dayKey: 'Tue',
    pickups: [
      { name: 'Player A', pos: 'WR', team: 'WAS', dropName: 'Bench Guy', gain: 4, claim: { free: true } },
      { name: 'Player B', pos: 'DEF', team: 'TB', dropName: 'Bench Guy', gain: 3, claim: { free: true } },
    ],
  };
  const text = whatToChange(w);
  assert.match(text, /1\. Pick up Player A/);
  assert.doesNotMatch(text, /Player B/);
});
