// Builds the league-wide picture from live data: every team, standings with playoff odds,
// trade ideas, usage trends, news. Used by /api/league, the MCP tools and the cron (news archive).

import { source } from './source.js';
import * as nfl from './nfl.js';
import { availability, solve, expected, round1 } from './math.js';
import {
  standings, simulateSeason, lineupDistribution, findTrades, tradeImpact, seasonValue, rawValue,
  usageTrend, matchNews, findPlayer, findTeam,
} from './league.js';
import { readJson, writeJson } from './store.js';
import { mapLimit } from './http.js';

const NEWS = 'news/items.json';
const memo = new Map();

// Merge fresh headlines into the archive so the 5-item feeds add up to days of news.
export async function archiveNews() {
  const [fresh, saved] = await Promise.all([nfl.newsFeeds(), readJson(NEWS, []).catch(() => [])]);
  const key = i => i.link || `${i.source}:${i.title}`;
  const seen = new Set(saved.map(key));
  const cutoff = Date.now() - 10 * 86400e3;
  const merged = [...fresh.filter(i => !seen.has(key(i))), ...saved]
    .filter(i => !i.published || new Date(i.published) > cutoff)
    .sort((a, b) => String(b.published).localeCompare(String(a.published)))
    .slice(0, 600);
  if (merged.length !== saved.length || fresh.some(i => !seen.has(key(i)))) await writeJson(NEWS, merged);
  return merged;
}

export async function leagueContext(now = new Date()) {
  const src = source();
  const [state, lg, teamsRaw, pl] = await Promise.all([nfl.nflState(), src.league(), src.teams(), src.players()]);
  const { week, season } = state;
  const key = `${week}:${Math.floor(now.getTime() / 300e3)}:${teamsRaw.map(t => t.players.length).join(',')}`;
  if (memo.has(key)) return memo.get(key);
  const built = build({ now, src, lg, teamsRaw, pl, week, season });
  memo.clear();
  memo.set(key, built);
  built.catch(() => memo.delete(key));
  return built;
}

async function build({ now, src, lg, teamsRaw, pl, week, season }) {
  const slots = lg.slots;
  const playoffStart = lg.playoffStart || 15;
  const lastRegular = playoffStart - 1;
  const lastWeek = playoffStart + 2;
  const info = id => pl[id] || { name: `Player ${id}`, pos: '?', team: null, injury: null };

  const gamesNow = await nfl.games(season, week).catch(() => null);
  const weekDone = Object.values(gamesNow || {}).length > 0 && Object.values(gamesNow).every(g => g.state === 'post');

  // ---- teams ---------------------------------------------------------------
  // Copies: standings may add a final week's result below.
  const teams = teamsRaw.map(t => ({ ...t, players: [...t.players] }));
  const me = teams.find(t => t.isMine);
  if (!me) throw new Error('None of the teams in this league is yours. Check SLEEPER_USERNAME or ESPN_TEAM_ID.');
  const ownerOf = id => teams.find(t => t.players.includes(id)) || null;

  // ---- projections for every week left --------------------------------------
  const firstFuture = week + 1;
  const futureWeeks = [];
  for (let w = firstFuture; w <= lastWeek; w++) futureWeeks.push(w);
  const [projNowRaw, futurePoints] = await Promise.all([
    src.projections(week).catch(() => null),
    mapLimit(futureWeeks, 4, w => src.projections(w).then(p => p.points).catch(() => ({}))),
  ]);
  const points = Object.fromEntries(futureWeeks.map((w, i) => [w, futurePoints[i] || {}]));
  const projNow = projNowRaw?.points || {};
  const projectionsOk = Boolean(projNowRaw) && Object.values(points).some(p => Object.keys(p).length);

  // ---- standings and playoff odds -----------------------------------------------
  const recorded = Math.max(0, ...teams.map(t => t.wins + t.losses + t.ties));
  const matchNow = await src.matchups(week).catch(() => []);
  const games = [];
  const current = {};

  if (recorded < week) {
    const pairs = {};
    for (const m of matchNow) (pairs[m.matchupId] ||= []).push(m);
    for (const pair of Object.values(pairs).filter(p => p.length === 2)) {
      if (weekDone) {
        // Final but not yet in the records: count it.
        const [a, b] = pair;
        const ta = teams.find(t => t.id === a.teamId), tb = teams.find(t => t.id === b.teamId);
        ta.pf += a.points || 0; tb.pf += b.points || 0;
        if ((a.points || 0) > (b.points || 0)) ta.wins++; else if ((b.points || 0) > (a.points || 0)) tb.wins++; else { ta.ties++; tb.ties++; }
      } else {
        for (const m of pair) {
          current[m.teamId] = lineupDistribution((m.starters || []).filter(id => id && id !== '0').map(id => {
            const g = gamesNow?.[info(id).team] || { state: 'pre', left: 1 };
            return {
              proj: (projNow[id] || 0) * availability(info(id).injury), actual: m.playerPoints?.[id] || 0,
              pos: info(id).pos, state: g.state, left: g.left,
            };
          }));
        }
        games.push({ week, a: pair[0].teamId, b: pair[1].teamId });
      }
    }
  }
  const scheduleWeeks = [];
  for (let w = week + 1; w <= lastRegular; w++) scheduleWeeks.push(w);
  // Future pairings come from each week's matchups, which leagues set at the start of the season.
  const schedule = await mapLimit(scheduleWeeks, 4, w => src.matchups(w).then(rows => {
    const byMatch = {};
    for (const m of rows) if (m.matchupId != null) (byMatch[m.matchupId] ||= []).push(m.teamId);
    return Object.values(byMatch).filter(p => p.length === 2);
  }).catch(() => []));
  scheduleWeeks.forEach((w, i) => schedule[i].forEach(([a, b]) => games.push({ week: w, a, b })));

  const teamWeek = (w, team) => {
    const pw = points[w] || {};
    const players = team.players.map(id => ({ id, pos: info(id).pos, value: (pw[id] || 0) * (w === week + 1 ? availability(info(id).injury) : 1) }));
    const { lineup, total } = solve(slots, players);
    const variance = lineup.filter(Boolean).reduce((v, id) => v + expected({ proj: pw[id] || 0, pos: info(id).pos }).variance, 0);
    return { mean: total, variance };
  };
  const odds = projectionsOk
    ? simulateSeason({
      teams, games, playoffTeams: lg.playoffTeams || 6, byes: (lg.playoffTeams || 6) === 6 ? 2 : 0,
      dist: (w, id) => (w === week && current[id] ? current[id] : teamWeek(w, teams.find(t => t.id === id))),
    })
    : {};

  const table = standings(teams, id => odds[id]?.playoffs || 0).map((t, i) => ({
    rank: i + 1, id: t.id, name: t.name, owner: t.owner, isMine: t.isMine,
    record: `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ''}`, pf: round1(t.pf), pa: round1(t.pa),
    playoffs: odds[t.id]?.playoffs ?? null, bye: odds[t.id]?.bye ?? null, projectedWins: odds[t.id]?.wins ?? null,
  }));

  // ---- trades ----------------------------------------------------------------------
  const tradeWeeks = futureWeeks.map(w => ({ week: w, weight: w >= playoffStart ? 1.5 : 1 }));
  const playoffWeeks = tradeWeeks.filter(w => w.week >= playoffStart).map(w => ({ ...w, weight: 1 }));
  const deadline = lg.tradeDeadline || null;
  const tradesOpen = !deadline || week <= deadline;
  const rosters = Object.fromEntries(teams.map(t => [t.id, t.players]));
  const describe = ids => ids.map(id => ({ id, name: info(id).name, pos: info(id).pos, team: info(id).team }));
  const trades = tradesOpen && projectionsOk
    ? findTrades({ slots, info, weeks: tradeWeeks, points, myId: me.id, rosters, pool: 7, perTeam: 3 }).map(t => {
      const partner = teams.find(x => x.id === t.teamId);
      const playoffs = tradeImpact({ slots, info, weeks: playoffWeeks, points, mine: me.players, theirs: partner.players, give: t.give, get: t.get });
      return { ...t, partner: partner.name, give: describe(t.give), get: describe(t.get), playoffGainForMe: playoffs.forMe };
    })
    : [];

  function evaluateTrade(giveNames, getNames) {
    const leaguePlayers = teams.flatMap(t => t.players.map(id => ({ id, name: info(id).name, pos: info(id).pos, team: info(id).team })));
    const mine = leaguePlayers.filter(p => me.players.includes(p.id));
    const others = leaguePlayers.filter(p => !me.players.includes(p.id));
    const give = giveNames.map(n => findPlayer(n, mine));
    const get = getNames.map(n => findPlayer(n, others));
    const missing = [...giveNames.filter((n, i) => !give[i]).map(n => `${n} (not on your team)`), ...getNames.filter((n, i) => !get[i]).map(n => `${n} (not on another team in the league)`)];
    if (missing.length) return { error: `Could not find: ${missing.join(', ')}.` };
    const partners = [...new Set(get.map(p => ownerOf(p.id)?.id))];
    if (partners.length !== 1) return { error: 'The players to get are on different teams. A trade is with one team at a time.' };
    const partner = teams.find(t => t.id === partners[0]);
    const args = { slots, info, points, mine: me.players, theirs: partner.players, give: give.map(p => p.id), get: get.map(p => p.id) };
    const seasonImpact = tradeImpact({ ...args, weeks: tradeWeeks });
    const playoffs = tradeImpact({ ...args, weeks: playoffWeeks });
    const verdict = seasonImpact.forMe <= 0 ? 'Bad for you. Your best lineups get worse.'
      : seasonImpact.forThem < 0 && seasonImpact.fairness !== 'fair' ? 'Good for you, but they would be giving up more than they get. Expect a no.'
        : seasonImpact.forThem < 0 ? 'Good for you. It makes their lineup a bit worse, so they may say no.'
          : 'Good for both teams. The kind of offer that gets accepted.';
    return {
      partner: partner.name, give: describe(give.map(p => p.id)), get: describe(get.map(p => p.id)),
      forMe: seasonImpact.forMe, forThem: seasonImpact.forThem, playoffGainForMe: playoffs.forMe, fairness: seasonImpact.fairness,
      tradesOpen, deadline, verdict,
    };
  }

  // ---- usage and news ----------------------------------------------------------------
  const completed = weekDone ? week : week - 1;
  const statWeeks = [];
  for (let w = 1; w <= completed; w++) statWeeks.push(w);
  const [statsByWeek, liveStats] = await Promise.all([
    mapLimit(statWeeks, 4, w => src.weekStats(w, true).catch(() => ({}))),
    weekDone ? Promise.resolve(null) : src.weekStats(week, false).catch(() => null),
  ]);
  const weeklyFor = id => statWeeks.map((w, i) => ({ week: w, ...(statsByWeek[i][id] || { pts: 0, snaps: 0, teamSnaps: 0, targets: 0, carries: 0, receptions: 0 }) }));
  const trends = me.players.map(id => ({ ...describe([id])[0], trend: usageTrend(weeklyFor(id)) })).filter(p => p.trend);

  const archived = await readJson(NEWS, []).catch(() => []);
  const live = await nfl.newsFeeds().catch(() => []);
  const seen = new Set();
  const allPlayers = Object.entries(pl).map(([id, p]) => ({ id, name: p.name }));
  const news = matchNews([...live, ...archived].filter(i => {
    const k = i.link || i.title;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }), allPlayers).sort((a, b) => String(b.published).localeCompare(String(a.published)));
  const newsFor = ids => news.filter(n => ids.includes(n.playerId)).map(n => ({ ...n, player: info(n.playerId).name }));

  // ---- per team and per player views -----------------------------------------------------
  function teamView(query) {
    const team = query ? findTeam(query, teams) : null;
    if (query && !team) return { error: `No team matching "${query}". Teams: ${teams.map(t => t.name).join(', ')}.` };
    const t = team || me;
    const row = table.find(r => r.id === t.id);
    const nextWeek = week + (weekDone ? 1 : 0);
    const pw = nextWeek === week ? projNow : points[nextWeek] || {};
    const players = t.players.map(id => ({ id, pos: info(id).pos, value: round1((pw[id] || 0) * availability(info(id).injury)) }));
    const { lineup, total } = solve(slots, players);
    const starters = new Set(lineup.filter(Boolean));
    return {
      ...row,
      week: nextWeek,
      projectedTotal: round1(total),
      restOfSeason: seasonValue(slots, t.players, info, tradeWeeks, points),
      lineup: slots.map((slot, i) => (lineup[i] ? { slot, ...describe([lineup[i]])[0], pts: players.find(p => p.id === lineup[i]).value, injury: info(lineup[i]).injury } : { slot, name: null })),
      bench: t.players.filter(id => !starters.has(id)).map(id => ({ ...describe([id])[0], pts: players.find(p => p.id === id).value, injury: info(id).injury })),
    };
  }

  function playerView(query) {
    const everyone = Object.entries(pl).map(([id, p]) => ({ id, name: p.name, pos: p.pos, team: p.team }));
    const rostered = everyone.filter(p => ownerOf(p.id));
    const p = findPlayer(query, rostered) || findPlayer(query, everyone.filter(x => x.team));
    if (!p) return { error: `No NFL player matching "${query}".` };
    const owner = ownerOf(p.id);
    const weekly = weeklyFor(p.id);
    const byeWeek = futureWeeks.find(w => !points[w]?.[p.id] && Object.keys(points[w] || {}).length) || null;
    return {
      ...describe([p.id])[0],
      injury: info(p.id).injury,
      owner: owner ? owner.name : 'Free agent',
      onMyTeam: Boolean(owner?.isMine),
      thisWeek: { projected: round1(projNow[p.id] || 0), soFar: liveStats?.[p.id]?.pts ?? null },
      restOfSeasonProjected: rawValue([p.id], futureWeeks.map(w => ({ week: w, weight: 1 })), points),
      nextNoGameWeek: byeWeek,
      weekly,
      trend: usageTrend(weekly),
      news: newsFor([p.id]).slice(0, 4),
    };
  }

  return {
    league: lg.name, week, weekDone, lastRegular, playoffStart, projectionsOk,
    standings: table, trades, tradesOpen, deadline, trends,
    news: { mine: newsFor(me.players).slice(0, 12), league: news.slice(0, 20).map(n => ({ ...n, player: info(n.playerId).name, owner: ownerOf(n.playerId)?.name || 'Free agent' })) },
    teamView, playerView, evaluateTrade,
    generatedAt: now.toISOString(),
  };
}
