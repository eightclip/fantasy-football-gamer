// Picks the fantasy platform from PLATFORM and hands the rest of the app one shared shape:
//
// league()          { name, slots: ['QB','RB',...], playoffTeams, playoffStart, tradeDeadline, waiverClearDays }
// teams()           [{ id, name, owner, isMine, wins, losses, ties, pf, pa, players: [id], starters: [id|'0' per slot], waiverPosition }]
// matchups(week)    [{ teamId, matchupId, points, starters: [id], playerPoints: { id: pts } }]
// players()         { id: { name, pos, team, injury, depth } }
// projections(week) { points: { id: projected league points }, injury: { id: { status, body } } }
// weekStats(week, final) { id: { pts, snaps, teamSnaps, targets, carries, receptions } }
// drops(week)       { id: droppedAt ms }
// trending()        { id: adds in the last 48h }
// externalIds()     { id: { espn, gsis } } for injury reports
//
// To add a platform, write lib/platforms/<name>.js returning these methods (see CONTRIBUTING.md).

import { config } from './config.js';
import { createSleeper } from './platforms/sleeper.js';
import { createEspn } from './platforms/espn.js';

let current = null;
export function source() {
  if (!current) current = config.platform === 'espn' ? createEspn() : createSleeper();
  return current;
}
