// ESPN adapter (beta). Reads an ESPN fantasy league through the same unofficial API the ESPN
// website uses. Public leagues need only LEAGUE_ID and ESPN_TEAM_ID; private leagues also need
// the ESPN_S2 and ESPN_SWID cookies from a logged-in browser (see docs/PLATFORMS.md).
//
// ESPN already scores projections and results with the league's own settings, so no scoring
// rules are needed here. Usage stats (snaps, targets) are not available, so usage trends show
// points only. Waiver drops and trending adds are not read yet.

import { cached, json } from '../http.js';
import { config } from '../config.js';
import { idMaps, nflState, standardTeam } from '../nfl.js';

const SLOT = { 0: 'QB', 2: 'RB', 3: 'WRRB_FLEX', 4: 'WR', 5: 'REC_FLEX', 6: 'TE', 7: 'SUPER_FLEX', 16: 'DEF', 17: 'K', 23: 'FLEX' };
const SLOT_ORDER = [0, 2, 4, 6, 23, 3, 5, 7, 17, 16];
const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
const INJURY = { QUESTIONABLE: 'Questionable', DOUBTFUL: 'Doubtful', OUT: 'Out', INJURY_RESERVE: 'IR', SUSPENSION: 'Sus', DAY_TO_DAY: 'Questionable' };
const BENCH = new Set([20, 21]);

// ---- pure parsers (tested with fixtures) ----------------------------------------------------

export function parseSettings(body) {
  const s = body?.settings || {};
  const counts = s.rosterSettings?.lineupSlotCounts || {};
  const slots = [];
  for (const id of SLOT_ORDER) for (let i = 0; i < (counts[id] || 0); i++) slots.push(SLOT[id]);
  const regular = s.scheduleSettings?.matchupPeriodCount || 14;
  return {
    name: s.name || 'ESPN league',
    slots,
    playoffTeams: s.scheduleSettings?.playoffTeamCount || 6,
    playoffStart: regular + 1,
    tradeDeadline: null, // ESPN gives a date, not a week; trades stay open in the app until then
    waiverClearDays: s.acquisitionSettings?.waiverHours ? Math.round(s.acquisitionSettings.waiverHours / 24) : 2,
  };
}

export function parseProTeams(body) {
  return Object.fromEntries((body?.settings?.proTeams || []).map(t => [t.id, standardTeam(t.abbrev)]));
}

const startersInSlotOrder = (entries, slots) => {
  const used = new Set();
  return slots.map(slot => {
    const e = entries.find(x => !used.has(x.playerId) && !BENCH.has(x.lineupSlotId) && SLOT[x.lineupSlotId] === slot);
    if (!e) return '0';
    used.add(e.playerId);
    return String(e.playerId);
  });
};

export function parseTeams(body, slots, myTeamId) {
  const members = body?.members || [];
  return (body?.teams || []).map(t => {
    const owner = members.find(m => m.id === t.owners?.[0] || m.id === t.primaryOwner);
    const rec = t.record?.overall || {};
    const entries = t.roster?.entries || [];
    return {
      id: t.id,
      name: t.name || `${t.location || ''} ${t.nickname || ''}`.trim() || t.abbrev || `Team ${t.id}`,
      owner: owner ? owner.displayName || `${owner.firstName || ''} ${owner.lastName || ''}`.trim() : '',
      isMine: Number(t.id) === Number(myTeamId),
      wins: rec.wins || 0, losses: rec.losses || 0, ties: rec.ties || 0,
      pf: rec.pointsFor || 0, pa: rec.pointsAgainst || 0,
      players: entries.map(e => String(e.playerId)),
      starters: startersInSlotOrder(entries, slots),
      waiverPosition: t.waiverRank ?? null,
    };
  });
}

export function parseMatchups(body, week, slots) {
  const out = [];
  for (const g of (body?.schedule || []).filter(x => x.matchupPeriodId === Number(week))) {
    for (const side of [g.home, g.away].filter(Boolean)) {
      const entries = side.rosterForCurrentScoringPeriod?.entries || [];
      out.push({
        teamId: side.teamId,
        matchupId: g.id,
        points: side.totalPointsLive ?? side.totalPoints ?? 0,
        starters: startersInSlotOrder(entries, slots),
        playerPoints: Object.fromEntries(entries.map(e => [String(e.playerId), e.playerPoolEntry?.appliedStatTotal || 0])),
      });
    }
  }
  return out;
}

// Players plus projected (statSourceId 1) and actual (statSourceId 0) weekly league points.
export function parsePlayers(body, proTeams) {
  const players = {}, projected = {}, actual = {};
  for (const entry of body?.players || []) {
    const p = entry.player || entry;
    const pos = POS[p.defaultPositionId];
    if (!pos) continue;
    const id = String(p.id);
    players[id] = {
      name: pos === 'DEF' ? p.fullName?.replace(/\s*D\/ST$/, '') : p.fullName,
      pos, team: proTeams[p.proTeamId] || null, injury: INJURY[p.injuryStatus] || null, depth: null,
    };
    for (const st of p.stats || []) {
      if (st.statSplitTypeId !== 1 || typeof st.appliedTotal !== 'number') continue;
      const bucket = st.statSourceId === 1 ? projected : st.statSourceId === 0 ? actual : null;
      if (bucket) (bucket[st.scoringPeriodId] ||= {})[id] = Math.round(st.appliedTotal * 10) / 10;
    }
  }
  return { players, projected, actual };
}

// ---- adapter --------------------------------------------------------------------------------

export function createEspn() {
  const L = config.leagueId;
  const headers = config.espnS2 && config.espnSwid ? { Cookie: `espn_s2=${config.espnS2}; SWID=${config.espnSwid}` } : {};
  const season = async () => (await nflState()).season;
  const base = async () => `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${await season()}/segments/0/leagues/${L}`;
  const read = async (query, extra = {}) => {
    try {
      return await json(`${await base()}?${query}`, { ...headers, ...extra });
    } catch (err) {
      if (/returned 40[13]/.test(err.message)) throw new Error('ESPN refused the league. For a private league set ESPN_S2 and ESPN_SWID (docs/PLATFORMS.md).');
      throw err;
    }
  };

  const settings = () => cached(`espn:settings:${L}`, 3600, async () => parseSettings(await read('view=mSettings')));
  const proTeams = () => cached('espn:proteams', 7 * 86400, async () =>
    parseProTeams(await json(`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${await season()}?view=proTeamSchedules_wl`)));
  const pool = () => cached(`espn:players:${L}`, 900, async () => {
    const filter = JSON.stringify({ players: { limit: 700, sortPercOwned: { sortPriority: 1, sortAsc: false } } });
    return parsePlayers(await read('view=kona_player_info', { 'X-Fantasy-Filter': filter }), await proTeams());
  });

  return {
    name: 'espn',
    league: settings,
    async teams() {
      const s = await settings();
      return cached(`espn:teams:${L}`, 120, async () => parseTeams(await read('view=mTeam&view=mRoster'), s.slots, config.espnTeamId));
    },
    async matchups(week) {
      const s = await settings();
      return cached(`espn:matchups:${L}:${week}`, 60, async () => parseMatchups(await read(`view=mMatchupScore&view=mScoreboard&scoringPeriodId=${week}`), week, s.slots));
    },
    players: async () => (await pool()).players,
    async projections(week) {
      const { projected, players } = await pool();
      const points = projected[week] || {};
      if (!Object.keys(points).length) throw new Error(`ESPN has no projections for week ${week}`);
      const injury = Object.fromEntries(Object.entries(players).map(([id, p]) => [id, { status: p.injury, body: null }]));
      return { points, injury };
    },
    async weekStats(week) {
      const { actual } = await pool();
      return Object.fromEntries(Object.entries(actual[week] || {}).map(([id, pts]) => [id, { pts, snaps: 0, teamSnaps: 0, targets: 0, carries: 0, receptions: 0 }]));
    },
    drops: async () => ({}),
    trending: async () => ({}),
    async externalIds() {
      const { byEspn } = await idMaps(await season());
      return new Proxy(byEspn, { get: (map, id) => map[id] || { espn: id, gsis: null } });
    },
  };
}
