import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSettings, parseProTeams, parseTeams, parseMatchups, parsePlayers } from '../lib/platforms/espn.js';

// Shapes follow ESPN's fantasy API (lm-api-reads.fantasy.espn.com). Values are made up.
const settingsBody = {
  settings: {
    name: 'Example ESPN League',
    rosterSettings: { lineupSlotCounts: { 0: 1, 2: 2, 4: 2, 6: 1, 23: 1, 16: 1, 17: 1, 20: 7, 21: 1 } },
    scheduleSettings: { matchupPeriodCount: 14, playoffTeamCount: 4 },
    acquisitionSettings: { waiverHours: 48 },
  },
};

test('settings become slots in lineup order and playoff settings', () => {
  const s = parseSettings(settingsBody);
  assert.deepEqual(s.slots, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'K', 'DEF']);
  assert.equal(s.playoffTeams, 4);
  assert.equal(s.playoffStart, 15);
  assert.equal(s.waiverClearDays, 2);
});

test('pro teams map to standard abbreviations', () => {
  const t = parseProTeams({ settings: { proTeams: [{ id: 28, abbrev: 'Wsh' }, { id: 12, abbrev: 'KC' }] } });
  assert.deepEqual(t, { 28: 'WAS', 12: 'KC' });
});

const slots = parseSettings(settingsBody).slots;

test('teams carry record, roster and starters in slot order', () => {
  const body = {
    members: [{ id: '{OWNER-1}', displayName: 'alex' }],
    teams: [{
      id: 3, name: 'Team Taco', owners: ['{OWNER-1}'], waiverRank: 5,
      record: { overall: { wins: 2, losses: 1, ties: 0, pointsFor: 355.5, pointsAgainst: 301.2 } },
      roster: { entries: [
        { playerId: 101, lineupSlotId: 0 }, { playerId: 201, lineupSlotId: 2 }, { playerId: 202, lineupSlotId: 23 },
        { playerId: 203, lineupSlotId: 2 }, { playerId: 301, lineupSlotId: 20 }, { playerId: -16012, lineupSlotId: 16 },
      ] },
    }],
  };
  const [team] = parseTeams(body, slots, 3);
  assert.equal(team.isMine, true);
  assert.equal(team.owner, 'alex');
  assert.equal(team.pf, 355.5);
  assert.equal(team.waiverPosition, 5);
  assert.deepEqual(team.players, ['101', '201', '202', '203', '301', '-16012']);
  assert.deepEqual(team.starters, ['101', '201', '203', '0', '0', '0', '202', '0', '-16012']);
});

test('matchups pair teams and keep live player points', () => {
  const body = {
    schedule: [
      { id: 9, matchupPeriodId: 2,
        home: { teamId: 3, totalPoints: 88.5, rosterForCurrentScoringPeriod: { entries: [{ playerId: 101, lineupSlotId: 0, playerPoolEntry: { appliedStatTotal: 21.3 } }] } },
        away: { teamId: 4, totalPointsLive: 92.1, totalPoints: 0 } },
      { id: 1, matchupPeriodId: 1, home: { teamId: 1 }, away: { teamId: 2 } },
    ],
  };
  const rows = parseMatchups(body, 2, slots);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { teamId: 3, matchupId: 9, points: 88.5, starters: ['101', '0', '0', '0', '0', '0', '0', '0', '0'], playerPoints: { 101: 21.3 } });
  assert.equal(rows[1].points, 92.1);
});

test('players split projected and actual weekly points', () => {
  const body = { players: [
    { player: { id: 101, fullName: 'Example Quarterback', defaultPositionId: 1, proTeamId: 12, injuryStatus: 'QUESTIONABLE', stats: [
      { scoringPeriodId: 2, statSourceId: 1, statSplitTypeId: 1, appliedTotal: 19.87 },
      { scoringPeriodId: 1, statSourceId: 0, statSplitTypeId: 1, appliedTotal: 24.2 },
      { scoringPeriodId: 0, statSourceId: 1, statSplitTypeId: 0, appliedTotal: 310 },
    ] } },
    { player: { id: -16012, fullName: 'Chiefs D/ST', defaultPositionId: 16, proTeamId: 12, stats: [] } },
    { player: { id: 999, fullName: 'Punter', defaultPositionId: 8 } },
  ] };
  const { players, projected, actual } = parsePlayers(body, { 12: 'KC' });
  assert.deepEqual(players['101'], { name: 'Example Quarterback', pos: 'QB', team: 'KC', injury: 'Questionable', depth: null });
  assert.equal(players['-16012'].name, 'Chiefs');
  assert.equal(players['999'], undefined);
  assert.deepEqual(projected, { 2: { 101: 19.9 } });
  assert.deepEqual(actual, { 1: { 101: 24.2 } });
});
