// Everything the page shows for this week, in one small payload: matchup and win odds, the best
// lineup and the moves to get there, injuries, pickups with waiver timing, blocks, bye gaps.
// Platform-neutral: it reads lib/source.js, never Sleeper or ESPN directly.

import { source } from './source.js';
import * as nfl from './nfl.js';
import { config } from './config.js';
import {
  solve, availability, severity, winProbability, lineupForWinning,
  findPickups, byeHoles, eligible, round1,
} from './math.js';
import { writeAdvice, ruleAdvice } from './advice.js';
import { claimStatus, inTimeFor, nextClaimsRun } from './waivers.js';

const local = (date, opts) => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, ...opts }).format(date);
const dayOf = date => local(date, { weekday: 'short' });
const LONG_TERM = /^(ir|injured reserve|pup|sus)/i;

export async function buildWeek(now = new Date(), { advice = true } = {}) {
  const src = source();
  const [state, lg, teams, pl] = await Promise.all([nfl.nflState(), src.league(), src.teams(), src.players()]);
  const { week, season } = state;
  const warn = what => err => { console.error(`week: ${what} failed:`, err?.message || err); return null; };
  const gamesNow = await nfl.games(season, week).catch(warn('schedule'));
  const gameList = Object.values(gamesNow || {});
  const weekDone = gameList.length > 0 && gameList.every(g => g.state === 'post');
  const planWeek = weekDone ? week + 1 : week;

  const [gamesPlan, projNow, projNext, byes, trend, muNow, muPlan, ids, practice, kicks, espnTeams, kicksNow, dropsNow, dropsPrev] = await Promise.all([
    weekDone ? nfl.games(season, planWeek).catch(warn('schedule next')) : gamesNow,
    src.projections(planWeek).catch(warn('projections')),
    src.projections(planWeek + 1).catch(warn('projections next')),
    nfl.byeWeeks(season).catch(warn('schedule')),
    src.trending().catch(() => ({})),
    src.matchups(week).catch(() => []),
    weekDone ? src.matchups(planWeek).catch(() => []) : null,
    src.externalIds().catch(warn('id map')),
    nfl.practiceReports(season).catch(warn('practice reports')),
    nfl.kickoffs(season, planWeek).catch(warn('kickoffs')),
    nfl.espnTeams(season).catch(warn('ESPN teams')),
    weekDone ? nfl.kickoffs(season, week).catch(warn('kickoffs this week')) : null,
    src.drops(week).catch(() => ({})),
    src.drops(Math.max(1, week - 1)).catch(() => ({})),
  ]);

  const slots = lg.slots;
  const mine = teams.find(t => t.isMine);
  if (!mine) throw new Error('None of the teams in this league is yours. Check SLEEPER_USERNAME or ESPN_TEAM_ID.');
  const rosterIds = mine.players;

  const info = id => pl[id] || { name: `Player ${id}`, pos: '?', team: null, injury: null, depth: null };

  // ---- injuries --------------------------------------------------------
  // Three sources, worst news wins: the platform's tag, ESPN's latest note, the official report.
  const espnNotes = {};
  if (ids && espnTeams) {
    const byTeam = {};
    for (const id of rosterIds) {
      const team = espnTeams[info(id).team];
      const espn = ids[id]?.espn;
      if (team && espn) (byTeam[team] ||= []).push([id, espn]);
    }
    await Promise.all(Object.entries(byTeam).map(async ([team, pairs]) => {
      const found = await nfl.espnInjuries(team, pairs.map(p => p[1])).catch(warn(`ESPN injuries for team ${team}`));
      for (const [id, espn] of pairs) if (found?.[espn]) espnNotes[id] = found[espn];
    }));
  }

  const injuryCache = new Map();
  const injuryOf = id => {
    if (injuryCache.has(id)) return injuryCache.get(id);
    const platformTag = projNow?.injury?.[id]?.status ?? info(id).injury;
    const note = espnNotes[id];
    const espnTag = note?.date && now - new Date(note.date) < 10 * 86400e3 ? note.status : null;
    const gsis = ids?.[id]?.gsis;
    const report = gsis && practice?.[gsis]?.week === planWeek ? practice[gsis] : null;
    const status = [platformTag, espnTag, report?.report]
      .reduce((worst, s) => (severity(s) > severity(worst) ? s : worst), null);
    const out = {
      status: severity(status) > 0 ? status : null,
      practice: report?.practice || null,
      body: projNow?.injury?.[id]?.body || report?.injury || null,
      comment: note?.comment || null,
      updated: note?.date || null,
    };
    injuryCache.set(id, out);
    return out;
  };

  const valueIn = (proj, id, { thisWeek = true } = {}) => {
    const pts = proj?.points?.[id];
    if (!pts) return 0;
    const inj = injuryOf(id);
    const factor = thisWeek ? availability(inj.status, inj.practice) : (LONG_TERM.test(inj.status || '') ? 0 : 1);
    return round1(pts * factor);
  };
  const onBye = (wk, team) => !!byes?.[wk]?.includes(team);

  const gameIn = (games, wk) => id => {
    const team = info(id).team;
    if (!team) return { state: 'none', left: 0 };
    if (games?.[team]) return games[team];
    return onBye(wk, team) ? { state: 'bye', left: 0 } : { state: 'pre', left: 1 };
  };
  const gamePlan = gameIn(gamesPlan, planWeek);
  const locked = id => ['in', 'post'].includes(gamePlan(id).state);
  const kickoffOf = id => kicks?.[info(id).team] || null;
  const kickoffDay = id => (kickoffOf(id) ? dayOf(new Date(kickoffOf(id))) : gamePlan(id).day || null);

  const teamName = team => team?.name || 'Your opponent';
  const record = t => `${t?.wins || 0}-${t?.losses || 0}${t?.ties ? `-${t.ties}` : ''}`;

  // ---- lineup ----------------------------------------------------------
  const starters = mine.starters || [];
  const isReal = id => id && id !== '0';

  const fixed = new Map();
  starters.forEach((id, i) => { if (isReal(id) && locked(id)) fixed.set(i, id); });
  const pool = rosterIds
    .filter(id => !locked(id) || [...fixed.values()].includes(id))
    .map(id => ({ id, pos: info(id).pos, value: valueIn(projNow, id) }));

  const optimal = solve(slots, pool, fixed);
  const currentTotal = round1(starters.filter(isReal).reduce((s, id) => s + valueIn(projNow, id), 0));
  const bestSet = new Set(optimal.lineup.filter(Boolean));
  const nowSet = new Set(starters.filter(isReal));

  const row = id => {
    const p = info(id);
    const inj = injuryOf(id);
    return {
      id, name: p.name, pos: p.pos, team: p.team, pts: valueIn(projNow, id),
      injury: inj.status, practice: inj.practice,
      locked: locked(id), bye: gamePlan(id).state === 'bye', kickoff: kickoffOf(id),
    };
  };

  const worth = projNow ? round1(optimal.total - currentTotal) : 0;
  const swaps = {
    start: worth > 0 ? [...bestSet].filter(id => !nowSet.has(id)).map(row).sort((a, b) => b.pts - a.pts) : [],
    sit: worth > 0 ? [...nowSet].filter(id => !bestSet.has(id)).map(row).sort((a, b) => b.pts - a.pts) : [],
    worth: Math.max(0, worth),
  };

  const lineup = slots.map((slot, i) => {
    const id = optimal.lineup[i];
    return { slot, ...(id ? row(id) : { id: null, name: null, pts: 0 }), starting: id ? nowSet.has(id) : false };
  });
  const bench = rosterIds.filter(id => !bestSet.has(id)).map(row).sort((a, b) => b.pts - a.pts);

  // ---- flags -----------------------------------------------------------
  const liveStarters = starters.filter(isReal);
  const flags = {
    injuredStarters: liveStarters.filter(id => severity(injuryOf(id).status) > 0)
      .map(id => ({ name: info(id).name, status: injuryOf(id).status, practice: injuryOf(id).practice, locked: locked(id) })),
    byeStarters: liveStarters.filter(id => gamePlan(id).state === 'bye').map(id => info(id).name),
    emptySlots: starters.filter(id => !isReal(id)).length + Math.max(0, slots.length - starters.length)
      + liveStarters.filter(id => gamePlan(id).state === 'none').length,
    thursdayPlayers: liveStarters.filter(id => !locked(id) && kickoffDay(id) === 'Thu').map(id => info(id).name),
    mondayPlayers: liveStarters.filter(id => !locked(id) && kickoffDay(id) === 'Mon').map(id => info(id).name),
  };

  // ---- matchup ---------------------------------------------------------
  const oppOf = list => {
    const me = list?.find(m => m.teamId === mine.id);
    const them = me && list.find(m => m.matchupId === me.matchupId && m.teamId !== me.teamId);
    return { me, them, roster: them && teams.find(t => t.id === them.teamId) };
  };

  const sidePlayer = (id, points, proj, games, wk) => {
    const g = gameIn(games, wk)(id);
    return { proj: valueIn(proj, id), actual: points?.[id] || 0, pos: info(id).pos, state: g.state === 'none' ? 'bye' : g.state, left: g.left };
  };
  const side = (list, points, proj, games, wk) => list.filter(isReal).map(id => sidePlayer(id, points, proj, games, wk));

  // The opponent at their best: whoever on their whole roster, bench included, would
  // score most. Plan against that, not against a lineup they might still fix.
  const opponentLineups = (oppRoster, entry, games, wk) => {
    const starters = ((entry?.starters?.length ? entry.starters : oppRoster?.starters) || []).map(String);
    const g = gameIn(games, wk);
    const isLocked = id => ['in', 'post'].includes(g(id).state);
    const oppFixed = new Map();
    starters.forEach((id, i) => { if (isReal(id) && isLocked(id)) oppFixed.set(i, id); });
    const oppPool = (oppRoster?.players || [])
      .filter(id => !isLocked(id) || [...oppFixed.values()].includes(id))
      .map(id => ({ id, pos: info(id).pos, value: valueIn(projNow, id) }));
    const best = solve(slots, oppPool, oppFixed);
    const setTotal = starters.filter(isReal).reduce((sum, id) => sum + valueIn(projNow, id), 0);
    const bestSetIds = new Set(best.lineup.filter(Boolean));
    const gain = round1(best.total - setTotal);
    return {
      starters, fixed: oppFixed, pool: oppPool, best,
      bench: gain >= 1 ? {
        gain,
        start: [...bestSetIds].filter(id => !starters.includes(id)).map(id => info(id).name),
        sit: starters.filter(id => isReal(id) && !bestSetIds.has(id)).map(id => info(id).name),
      } : null,
    };
  };

  let matchup = null;
  let oddsPlay = null;
  let plan = null; // the matchup pickups and blocks are judged against
  const cur = oppOf(muNow);
  if (cur.me && cur.them) {
    const status = weekDone ? 'final'
      : gameList.some(g => g.state !== 'pre') ? 'live' : 'upcoming';
    matchup = {
      week, status,
      opponent: teamName(cur.roster),
      opponentRecord: record(cur.roster),
      you: round1(cur.me.points || 0),
      them: round1(cur.them.points || 0),
    };
    if (!weekDone && projNow) {
      const opp = opponentLineups(cur.roster, cur.them, gamesNow, week);
      const pts = cur.me.playerPoints;
      const theirsSet = side(opp.starters, cur.them.playerPoints, projNow, gamesNow, week);
      const theirsBest = side(opp.best.lineup, cur.them.playerPoints, projNow, gamesNow, week);
      const asSet = winProbability(side(cur.me.starters || [], pts, projNow, gamesNow, week), theirsSet);
      const best = winProbability(side(optimal.lineup, pts, projNow, gamesNow, week), theirsSet);
      const bestVsBest = winProbability(side(optimal.lineup, pts, projNow, gamesNow, week), theirsBest);
      Object.assign(matchup, {
        winProbability: asSet.probability, winProbabilityWithSwaps: best.probability,
        youProjected: asSet.mine, themProjected: asSet.theirs,
        opponentBench: opp.bench,
        winProbabilityIfTheyFix: opp.bench ? bestVsBest.probability : null,
      });
      plan = { opp, theirsBest, points: pts, oppPoints: cur.them.playerPoints, games: gamesNow, wk: week, base: bestVsBest.probability, opponent: matchup.opponent };

      // The most points is not always the best chance to win. Surface it when it matters.
      const candidates = pool.map(p => ({ ...p, ...sidePlayer(p.id, pts, projNow, gamesNow, week) }));
      const win = lineupForWinning(slots, candidates, fixed, theirsBest, optimal.lineup);
      if (win.probability - bestVsBest.probability >= 0.02) {
        const winSet = new Set(win.lineup.filter(Boolean));
        const points = win.lineup.filter(Boolean).reduce((sum, id) => sum + valueIn(projNow, id), 0);
        oddsPlay = {
          probability: win.probability,
          from: bestVsBest.probability,
          pointsCost: round1(optimal.total - points),
          start: [...winSet].filter(id => !bestSet.has(id)).map(row),
          sit: [...bestSet].filter(id => !winSet.has(id)).map(row),
          underdog: bestVsBest.probability < 0.5,
        };
      }
    }
  }

  let nextMatchup = null;
  const nxt = weekDone ? oppOf(muPlan) : {};
  if (nxt.me && nxt.them && projNow) {
    const opp = opponentLineups(nxt.roster, nxt.them, gamesPlan, planWeek);
    const mineSide = side(optimal.lineup, {}, projNow, gamesPlan, planWeek);
    const theirsBest = side(opp.best.lineup, {}, projNow, gamesPlan, planWeek);
    const odds = winProbability(mineSide, side(opp.starters, {}, projNow, gamesPlan, planWeek));
    const vsBest = winProbability(mineSide, theirsBest);
    nextMatchup = {
      week: planWeek, opponent: teamName(nxt.roster), opponentRecord: record(nxt.roster),
      winProbability: odds.probability, youProjected: odds.mine, themProjected: odds.theirs,
      opponentBench: opp.bench, winProbabilityIfTheyFix: opp.bench ? vsBest.probability : null,
    };
    plan = { opp, theirsBest, points: {}, oppPoints: {}, games: gamesPlan, wk: planWeek, base: vsBest.probability, opponent: nextMatchup.opponent };
  }

  // ---- the wire --------------------------------------------------------
  const taken = new Set(teams.flatMap(t => t.players));
  const nextValue = id => (projNext ? valueIn(projNext, id, { thisWeek: false }) : valueIn(projNow, id));
  const thisWeek = id => (locked(id) ? 0 : valueIn(projNow, id));

  const available = Object.keys(projNow?.points || {})
    .filter(id => !taken.has(id) && pl[id]?.team)
    .map(id => ({ id, pos: info(id).pos, now: thisWeek(id), next: nextValue(id) }));

  const worstOpen = pos => {
    const open = slots.map((slot, i) => ({ slot, id: optimal.lineup[i], i }))
      .filter(s => !fixed.has(s.i) && eligible(s.slot, pos));
    return open.length ? Math.min(...open.map(s => (s.id ? valueIn(projNow, s.id) : 0))) : Infinity;
  };

  const freeAgents = [...available].sort((a, b) => b.now - a.now).slice(0, 12).map(fa => ({
    ...row(fa.id), pts: fa.now, next: fa.next, trending: trend[fa.id] || 0,
    beatsWorstStarter: fa.now > worstOpen(fa.pos),
  }));

  const lockedStarters = new Set(fixed.values());
  const pickupRoster = rosterIds.map(id => ({
    id, pos: info(id).pos, next: nextValue(id),
    now: lockedStarters.has(id) ? valueIn(projNow, id) : thisWeek(id),
  }));
  const shortlist = [...available].sort((a, b) => (b.now + b.next) - (a.now + a.next)).slice(0, 150);
  const lockedIds = new Set(rosterIds.filter(locked));

  // When could she actually get him? Free now, or stuck on waivers until the claims run.
  const claimsRun = nextClaimsRun(now);
  const lastClaimsRun = new Date(claimsRun.getTime() - 7 * 86400e3);
  const kickNow = weekDone ? kicksNow : kicks;
  const droppedAt = id => Math.max(dropsNow?.[id] || 0, dropsPrev?.[id] || 0) || null;
  const claimOf = id => {
    const k = kickNow?.[info(id).team];
    const gameStarted = Boolean(k) && new Date(k) <= now && new Date(k) > lastClaimsRun;
    return claimStatus({ now, droppedAt: droppedAt(id), gameStarted, clearDays: lg.waiverClearDays ?? 2 });
  };

  // Her win chance this matchup if she swaps `add` in for `drop`.
  const winWith = (add, drop) => {
    if (!plan) return null;
    const trial = pool.filter(p => p.id !== drop).concat({ id: add, pos: info(add).pos, value: valueIn(projNow, add) });
    const lineupIds = solve(slots, trial, fixed).lineup;
    return winProbability(side(lineupIds, plan.points, projNow, plan.games, plan.wk), plan.theirsBest).probability;
  };

  const pickups = (projNow ? findPickups(slots, pickupRoster, shortlist, { fixed, locked: lockedIds, limit: 8 }) : [])
    .map(p => {
      const claim = claimOf(p.add);
      const helpsThisWeek = Boolean(plan) && !locked(p.add) && inTimeFor(claim, kickoffOf(p.add));
      const odds = helpsThisWeek ? winWith(p.add, p.drop) : null;
      return {
        ...row(p.add), dropId: p.drop, dropName: info(p.drop).name, gain: p.gain,
        trending: trend[p.add] || 0, claim, helpsThisWeek,
        winGain: odds != null ? Math.round((odds - plan.base) * 1000) / 1000 : null,
      };
    })
    // Whatever moves this week's matchup most goes first, then two-week points.
    .sort((a, b) => ((b.winGain || 0) - (a.winGain || 0)) * 100 || b.gain - a.gain)
    .slice(0, 6);

  // Blocks: a free player her opponent would start over someone they have, who costs her
  // almost nothing to carry. Taking him first protects her odds.
  const blocks = [];
  if (plan && projNow) {
    const twoWeeks = players => solve(slots, players.map(p => ({ ...p, value: p.now })), fixed).total
      + solve(slots, players.map(p => ({ ...p, value: p.next }))).total;
    const baseTwo = twoWeeks(pickupRoster);
    const cheapest = pickupRoster.filter(p => !lockedIds.has(p.id) && !bestSet.has(p.id))
      .sort((a, b) => (a.now + a.next) - (b.now + b.next))[0];
    const myLineupSide = side(optimal.lineup, plan.points, projNow, plan.games, plan.wk);
    const candidates = [...available].filter(fa => !locked(fa.id)).sort((a, b) => b.now - a.now).slice(0, 60);
    for (const fa of cheapest ? candidates : []) {
      const claim = claimOf(fa.id);
      if (!inTimeFor(claim, kickoffOf(fa.id))) continue;
      const oppWith = solve(slots, plan.opp.pool.concat({ id: fa.id, pos: fa.pos, value: valueIn(projNow, fa.id) }), plan.opp.fixed);
      const oppGain = round1(oppWith.total - plan.opp.best.total);
      if (oppGain < 3) continue;
      const herChange = round1(twoWeeks(pickupRoster.filter(p => p.id !== cheapest.id).concat(fa)) - baseTwo);
      if (herChange < -1.5) continue;
      const theirsWith = side(oppWith.lineup, plan.oppPoints, projNow, plan.games, plan.wk);
      const protects = plan.base - winProbability(myLineupSide, theirsWith).probability;
      if (protects < 0.02) continue;
      blocks.push({
        ...row(fa.id), claim, oppGain, herChange, dropId: cheapest.id, dropName: info(cheapest.id).name,
        protects: Math.round(protects * 1000) / 1000, opponent: plan.opponent,
      });
    }
    blocks.sort((a, b) => b.protects - a.protects).splice(2);
  }

  // If her running back goes down, his backup is the pickup. Get there first.
  const handcuffs = [...bestSet]
    .filter(id => info(id).pos === 'RB' && info(id).depth === 1 && info(id).team)
    .flatMap(id => Object.entries(pl)
      .filter(([bid, b]) => b.team === info(id).team && b.pos === 'RB' && b.depth === 2 && !taken.has(bid))
      .map(([bid, b]) => ({ starter: info(id).name, backup: b.name, backupId: bid, team: b.team })));

  const lookAhead = byes ? new Map(
    [planWeek, planWeek + 1, planWeek + 2].map(wk => [wk, new Set(byes[wk] || [])])) : new Map();
  const byeGaps = byeHoles(slots, rosterIds.map(id => ({ id, pos: info(id).pos, team: info(id).team })), lookAhead)
    .map(h => ({ week: h.week, empty: h.empty, onBye: h.onBye.map(id => info(id).name) }));

  // ---- injury report and open decisions ----------------------------------
  const injuryReport = rosterIds
    .map(id => ({ ...row(id), ...injuryOf(id), starting: bestSet.has(id) || nowSet.has(id) }))
    .filter(p => p.status || (p.practice && p.practice !== 'Full'))
    .sort((a, b) => (b.starting - a.starting) || (severity(b.status) - severity(a.status)));

  const firstKickoff = list => list.map(kickoffOf).filter(Boolean).sort()[0] || null;
  const names = list => list.map(p => p.name).join(' and ');
  const decisions = [];
  for (const id of liveStarters) {
    if (locked(id)) continue;
    const inj = injuryOf(id);
    const sev = severity(inj.status);
    if (sev >= 2 || (sev === 1 && inj.practice === 'DNP')) {
      const sub = !bestSet.has(id) && swaps.start[0];
      decisions.push({
        kind: 'injury', ids: [id], lockAt: kickoffOf(id),
        headline: `${info(id).name} is ${inj.status}${sev === 1 ? ' and missed practice' : ''}`,
        text: sub ? `Start ${sub.name} instead.` : 'Still your best option, but check again before kickoff.',
      });
    }
  }
  for (const id of liveStarters.filter(id => gamePlan(id).state === 'bye')) {
    decisions.push({
      kind: 'bye', ids: [id], lockAt: firstKickoff(swaps.start.map(p => p.id)),
      headline: `${info(id).name} is on bye and still starting`,
      text: swaps.start[0] ? `Start ${swaps.start[0].name} instead.` : 'Swap anyone in. A bye scores zero.',
    });
  }
  if (flags.emptySlots > 0) {
    decisions.push({
      kind: 'empty', ids: [], lockAt: firstKickoff(bench.filter(p => !p.locked).map(p => p.id)),
      headline: 'You have an empty lineup slot', text: 'Zero is the only score you cannot come back from.',
    });
  }
  if (swaps.worth >= 1) {
    decisions.push({
      kind: 'swap', ids: [...swaps.start, ...swaps.sit].map(p => p.id),
      lockAt: firstKickoff([...swaps.start, ...swaps.sit].map(p => p.id)),
      headline: `Start ${names(swaps.start)} over ${names(swaps.sit)}`,
      text: `Worth about ${swaps.worth.toFixed(1)} points.`,
    });
  }
  if (oddsPlay) {
    decisions.push({
      kind: 'odds', ids: [...oddsPlay.start, ...oddsPlay.sit].map(p => p.id),
      lockAt: firstKickoff([...oddsPlay.start, ...oddsPlay.sit].map(p => p.id)),
      headline: `Start ${names(oddsPlay.start)} over ${names(oddsPlay.sit)}`,
      text: `Raises your chance of winning from ${Math.round(oddsPlay.from * 100)}% to ${Math.round(oddsPlay.probability * 100)}%.`,
    });
  }

  // Everyone whose game still matters to her this week, for game-day reminders.
  const gamePlayers = [...new Set([...liveStarters, ...bestSet])]
    .filter(id => !locked(id) && kickoffOf(id))
    .map(id => ({ id, name: info(id).name, kickoff: kickoffOf(id), starting: nowSet.has(id) }));

  const payload = {
    league: lg.name,
    siteName: config.siteName,
    platform: src.name,
    platformName: src.name === 'espn' ? 'ESPN Fantasy' : 'Sleeper',
    appUrl: src.name === 'espn'
      ? `https://fantasy.espn.com/football/team?leagueId=${encodeURIComponent(config.leagueId)}&teamId=${encodeURIComponent(config.espnTeamId)}`
      : 'https://sleeper.com/',
    week: planWeek,
    scoresWeek: week,
    inSeason: ['regular', 'post'].includes(state.seasonType),
    dayKey: dayOf(now),
    record: record(mine),
    opponent: matchup?.opponent ?? nextMatchup?.opponent ?? null,
    projectionsOk: !!projNow,
    liveOk: !!gamesNow,
    injuriesOk: !!(ids && espnTeams),
    matchup,
    nextMatchup,
    oddsPlay,
    optimal: lineup,
    totals: { best: round1(optimal.total), current: currentTotal, onTheTable: swaps.worth },
    swaps,
    bench,
    injuryReport,
    decisions,
    gamePlayers,
    freeAgents,
    pickups,
    blocks,
    waiverPosition: mine.waiverPosition ?? null,
    teams: teams.length,
    claimsRun: claimsRun.toISOString(),
    handcuffs,
    byeGaps,
    flags,
    generatedAt: now.toISOString(),
  };
  payload.advice = advice ? await writeAdvice(payload) : { ...ruleAdvice(payload), by: 'rules' };
  return payload;
}
