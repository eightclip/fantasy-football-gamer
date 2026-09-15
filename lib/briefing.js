// Plain-text answers for the MCP tools, built from the same /api/week payload the page uses.
// Pure: payload in, text out. Written for a chat assistant to read back in its own words.

import { config, zoneLabel } from './config.js';

const me = () => config.managerName || 'You';
const mine = () => (config.managerName ? `${config.managerName}'s` : 'your');
const Mine = () => (config.managerName ? `${config.managerName}'s` : 'Your');
const pct = p => `${Math.round(p * 100)}%`;
const n1 = x => (Number(x) || 0).toFixed(1);
const when = iso => {
  if (!iso) return 'no game this week';
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, weekday: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit' })
    .format(d).replace(':00', '').replace(/\s/g, '').toLowerCase();
  return `${day} ${time} ${zoneLabel(d)}`;
};
const slotName = slot => ({ WRRB_FLEX: 'RB/WR flex', REC_FLEX: 'WR/TE flex', SUPER_FLEX: 'superflex' }[slot] || slot);
const lines = parts => parts.filter(Boolean).join('\n');

function health(w) {
  const down = [];
  if (!w.projectionsOk) down.push('projections are down, so point totals and lineup advice are not trustworthy');
  if (!w.liveOk) down.push('game status did not load, so it is unknown which players are locked');
  if (!w.injuriesOk) down.push('ESPN injury notes and practice reports did not load');
  return down.length ? `Data warning: ${down.join('; ')}.` : null;
}

export function howAmIDoing(w) {
  const m = w.matchup;
  const next = w.nextMatchup;
  const out = [`${w.league}, week ${w.week}. Record ${w.record}.`];
  if (m) {
    const state = { live: 'Live', final: 'Final', upcoming: 'Not started' }[m.status];
    out.push(`${state}: ${me()} ${n1(m.you)}, ${m.opponent} (${m.opponentRecord}) ${n1(m.them)}.`);
    if (m.winProbability != null) {
      out.push(`${pct(m.winProbability)} chance to win as the lineups are set. Projected finish ${n1(m.youProjected)} to ${n1(m.themProjected)}.`);
      if (m.winProbabilityWithSwaps > m.winProbability + 0.005) out.push(`Making the suggested changes raises that to ${pct(m.winProbabilityWithSwaps)}.`);
      if (m.opponentBench) out.push(`${m.opponent} has better players on their bench (${m.opponentBench.start.join(', ')}). If they start them, ${mine()} chance becomes ${pct(m.winProbabilityIfTheyFix)}.`);
    }
  }
  if (next) {
    out.push(`Next week: ${next.opponent} (${next.opponentRecord}), ${pct(next.winProbability)} chance to win as things stand.`);
  }
  const toPlay = (w.gamePlayers || []).filter(p => p.starting);
  if (toPlay.length) out.push(`Still to play: ${toPlay.map(p => `${p.name} (${when(p.kickoff)})`).join(', ')}.`);
  if (w.advice?.body) out.push(`Bottom line: ${w.advice.body}`);
  out.push(health(w));
  return lines(out);
}

export function whatToChange(w) {
  if (!w.projectionsOk) return lines(['Projections are down, so there is no reliable lineup advice right now.', 'Safe check in your fantasy app: make sure nobody Out or on bye is starting.']);
  const steps = [];
  for (const r of w.optimal || []) {
    if (!r.name) steps.push(`Fill the empty ${slotName(r.slot)} spot. Nobody on the roster can play there; pick someone up.`);
    else if (!r.starting && !r.locked) steps.push(`Start ${r.name} (${r.pos}, ${r.team}) in the ${slotName(r.slot)} spot. Locks ${when(r.kickoff)}.`);
  }
  const bench = (w.swaps?.sit || []).filter(p => !p.locked);
  if (bench.length) steps.push(`Move ${bench.map(p => p.name).join(' and ')} to the bench.`);
  // A hurt starter who is still the best option gets a heads-up, not a move.
  for (const d of (w.decisions || []).filter(d => d.kind === 'injury')) {
    if (!(w.swaps?.sit || []).some(p => d.ids.includes(p.id))) steps.push(`Watch: ${d.headline}. ${d.text}`);
  }
  const waiverDay = w.dayKey === 'Tue' || w.dayKey === 'Wed';
  const dropped = new Set();
  const doable = (w.pickups || []).filter(p => waiverDay || p.gain >= 3 || (p.claim?.free && p.winGain >= 0.03))
    .filter(p => !dropped.has(p.dropName) && dropped.add(p.dropName));
  for (const p of doable.slice(0, 2)) {
    const how = p.claim?.free ? 'free now, add instantly' : `on waivers, put in a claim (processes ${when(p.claim?.until)})`;
    steps.push(`Pick up ${p.name} (${p.pos}, ${p.team}) and drop ${p.dropName}: ${how}.`);
  }
  const out = [];
  if (steps.length) {
    out.push('Do this in your fantasy app:');
    steps.forEach((s, i) => out.push(`${i + 1}. ${s}`));
    if (w.swaps?.worth > 0.05) out.push(`The lineup changes are worth about ${n1(w.swaps.worth)} projected points.`);
  } else {
    out.push('Nothing to change right now. The lineup already set is the best one.');
  }
  if (w.oddsPlay) {
    const o = w.oddsPlay;
    out.push(`Optional: start ${o.start.map(p => p.name).join(' and ')} over ${o.sit.map(p => p.name).join(' and ')} to raise the chance of winning from ${pct(o.from)} to ${pct(o.probability)} (about ${n1(o.pointsCost)} fewer projected points).`);
  }
  out.push(health(w));
  return lines(out);
}

export function lineup(w) {
  const out = [`Best lineup for week ${w.week} (projected points):`];
  for (const r of w.optimal || []) {
    if (!r.name) { out.push(`${slotName(r.slot)}: empty`); continue; }
    const status = r.locked ? 'locked, game started' : r.starting ? 'already set' : 'needs to be put in';
    const hurt = r.injury ? `, ${r.injury}` : '';
    out.push(`${slotName(r.slot)}: ${r.name} (${r.pos}, ${r.team}) ${n1(r.pts)} pts, ${status}${hurt}`);
  }
  out.push(`Best possible ${n1(w.totals?.best)}, currently set ${n1(w.totals?.current)}.`);
  if (w.bench?.length) out.push(`Bench: ${w.bench.map(p => `${p.name} ${n1(p.pts)}`).join(', ')}.`);
  out.push(health(w));
  return lines(out);
}

export function injuries(w) {
  const report = w.injuryReport || [];
  if (!report.length) return lines([`No injuries or practice concerns on ${mine()} roster.`, health(w)]);
  return lines([
    `Injuries on ${mine()} roster (platform tag, ESPN and the official practice report, worst news first):`,
    ...report.map(p => {
      const bits = [p.status || 'no designation', p.practice && `practice: ${p.practice === 'DNP' ? 'did not practice' : p.practice}`, p.starting ? 'in the lineup' : 'on the bench'].filter(Boolean);
      return `- ${p.name} (${p.pos}, ${p.team}): ${bits.join(', ')}.${p.comment ? ` ESPN: ${p.comment}` : ''}`;
    }),
    health(w),
  ]);
}

export function pickups(w) {
  const out = [];
  if (w.waiverPosition) out.push(`Waiver priority: #${w.waiverPosition} of ${w.teams}. Claims run ${when(w.claimsRun)}.`);
  if (w.pickups?.length) {
    out.push('Worth picking up (two-week projected gain, with the least costly drop):');
    for (const p of w.pickups) {
      const how = p.claim?.free ? 'free now' : `on waivers until ${when(p.claim?.until)}`;
      const pp = Math.round((p.winGain || 0) * 100);
      const win = pp >= 1 ? `, +${pp} ${pp === 1 ? 'point' : 'points'} of win chance this week` : '';
      out.push(`- Add ${p.name} (${p.pos}, ${p.team}), drop ${p.dropName}: +${n1(p.gain)} pts${win}; ${how}.`);
    }
  } else {
    out.push('Nobody available improves the lineup right now.');
  }
  for (const b of w.blocks || []) {
    out.push(`Block: ${b.opponent} would start ${b.name} (${b.pos}), gaining about ${n1(b.oppGain)} points. Taking him first (drop ${b.dropName}) protects about ${Math.round(b.protects * 100)} points of win chance; ${b.claim?.free ? 'free now' : 'on waivers'}.`);
  }
  if (w.handcuffs?.length) out.push(`Free backups for ${mine()} running backs: ${w.handcuffs.map(h => `${h.backup} (behind ${h.starter})`).join(', ')}.`);
  for (const g of w.byeGaps || []) out.push(`Week ${g.week}: nobody to start at ${g.empty.join(', ')} because of byes (${g.onBye.join(', ')}).`);
  out.push(health(w));
  return lines(out);
}

// ---- league-wide answers (take the object from lib/leagueData.js) ---------------------

const ago = iso => {
  if (!iso) return '';
  const h = Math.round((Date.now() - new Date(iso)) / 3600e3);
  return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

export function standingsText(c) {
  const done = c.weekDone ? c.week : c.week - 1;
  const out = [`${c.league} standings ${done ? `after week ${done}` : 'before any week is final'}. The top 6 make the playoffs (week ${c.playoffStart}); the top 2 get a bye.`];
  for (const t of c.standings) {
    const odds = t.playoffs != null ? `, ${pct(t.playoffs)} playoffs, ${pct(t.bye)} bye, about ${t.projectedWins} wins` : '';
    out.push(`${t.rank}. ${t.name}${t.isMine ? ` (${me()})` : ''}: ${t.record}, ${n1(t.pf)} points for${odds}`);
  }
  out.push('Playoff odds simulate the rest of the regular season from each team\'s best projected lineup each week.');
  return lines(out);
}

export function teamText(v) {
  if (v.error) return v.error;
  const out = [
    `${v.name}${v.isMine ? ` (${me()})` : ''}: ${v.record}, rank ${v.rank}, ${n1(v.pf)} points for.`,
    v.playoffs != null ? `${pct(v.playoffs)} chance to make the playoffs.` : null,
    `Best lineup for week ${v.week}, projected ${n1(v.projectedTotal)}:`,
    ...v.lineup.map(r => (r.name ? `- ${slotName(r.slot)}: ${r.name} (${r.pos}, ${r.team}) ${n1(r.pts)}${r.injury ? `, ${r.injury}` : ''}` : `- ${slotName(r.slot)}: empty`)),
    `Bench: ${v.bench.map(p => `${p.name} (${p.pos}) ${n1(p.pts)}${p.injury ? `, ${p.injury}` : ''}`).join('; ') || 'none'}.`,
    `Rest-of-season strength: ${n1(v.restOfSeason)} projected lineup points (playoff weeks count 1.5x).`,
  ];
  return lines(out);
}

export function playerText(v) {
  if (v.error) return v.error;
  const out = [
    `${v.name} (${v.pos}, ${v.team || 'no team'})${v.injury ? `, ${v.injury}` : ''}. ${v.onMyTeam ? `On ${mine()} team.` : v.owner === 'Free agent' ? 'Free agent in this league.' : `On ${v.owner}.`}`,
    `This week: projected ${n1(v.thisWeek.projected)}${v.thisWeek.soFar != null ? `, ${n1(v.thisWeek.soFar)} so far` : ''}. Rest of season: ${n1(v.restOfSeasonProjected)} projected points.`,
    v.nextNoGameWeek ? `No projection (likely bye) in week ${v.nextNoGameWeek}.` : null,
  ];
  const played = v.weekly.filter(w => w.snaps || w.pts);
  if (played.length) {
    out.push('Week by week (league points, snap share, targets, carries):');
    for (const w of v.weekly) out.push(`- Week ${w.week}: ${n1(w.pts)} pts, ${w.teamSnaps ? Math.round((w.snaps / w.teamSnaps) * 100) : 0}% snaps, ${w.targets} targets, ${w.carries} carries`);
  } else {
    out.push('No completed games this season yet.');
  }
  if (v.trend) {
    const dir = { up: 'Role is growing.', down: 'Role is shrinking.', steady: 'Role is steady.' }[v.trend.direction] || 'Too early to call a trend.';
    out.push(`${n1(v.trend.ptsPerGame)} points and ${n1(v.trend.opportunitiesPerGame)} targets plus carries a game, ${Math.round(v.trend.snapShare * 100)}% of snaps. ${dir}`);
  }
  if (v.news.length) {
    out.push('Recent news:');
    for (const n of v.news) out.push(`- ${headline(n)} ${source(n)}${n.summary ? ` ${clip(n.summary.replace(/\[…\]|\[\.\.\.\]/g, '').trim())}` : ''} ${n.link}`);
  }
  return lines(out);
}

// "Name: blurb" or "Name does thing" headlines, without repeating the name we already lead with.
const headline = n => {
  const t = n.title;
  if (t.toLowerCase().startsWith(`${n.player.toLowerCase()}:`)) return t.slice(n.player.length + 1).trim();
  return t;
};
const source = n => `(${[n.source, ago(n.published)].filter(Boolean).join(', ')})`;
const clip = (t, max = 220) => (t && t.length > max ? `${t.slice(0, max).replace(/\s+\S*$/, '')}…` : t);

export function newsText(c, scope = 'mine') {
  const items = scope === 'league' ? c.news.league : c.news.mine;
  if (!items.length) {
    return scope === 'league' ? 'No recent player news.' : `No recent news on ${mine()} players. Try asking about the whole league.`;
  }
  return lines([
    scope === 'league' ? 'Latest player news around the NFL:' : `Latest news on ${mine()} players:`,
    ...items.slice(0, 10).map(n => `- ${n.player}${n.owner ? ` (${n.owner})` : ''}: ${headline(n)} ${source(n)}${n.summary ? ` ${clip(n.summary.replace(/\[…\]|\[\.\.\.\]/g, '').trim())}` : ''} ${n.link}`),
  ]);
}

export function tradesText(c) {
  if (!c.tradesOpen) return c.deadline ? `The trade deadline (week ${c.deadline}) has passed.` : 'The trade deadline has passed.';
  if (!c.projectionsOk) return 'Projections for the rest of the season are not available, so trades cannot be judged right now.';
  if (!c.trades.length) return 'No trade found that clearly helps without hurting the other team. That usually means the roster is balanced.';
  const names = list => list.map(p => `${p.name} (${p.pos})`).join(' and ');
  return lines([
    `Trade ideas that help ${mine()} team and should appeal to the other team${c.deadline ? ` (deadline: week ${c.deadline})` : ''}. Points are projected best-lineup points for the rest of the season, playoff weeks counted 1.5x.`,
    ...c.trades.map((t, i) => `${i + 1}. With ${t.partner}: give ${names(t.give)}, get ${names(t.get)}. ${Mine()} team +${n1(t.forMe)} (${n1(t.playoffGainForMe)} in the playoff weeks), them ${t.forThem >= 0 ? '+' : ''}${n1(t.forThem)}. Value is ${t.fairness}.`),
    'Offers are sent in your fantasy app. These are projections, so weigh them against news and gut feel.',
  ]);
}

export function tradeVerdictText(r) {
  if (r.error) return r.error;
  const names = list => list.map(p => `${p.name} (${p.pos})`).join(' and ');
  return lines([
    `Trade with ${r.partner}: give ${names(r.give)}, get ${names(r.get)}.`,
    `${Mine()} team: ${r.forMe >= 0 ? '+' : ''}${n1(r.forMe)} projected lineup points for the rest of the season, ${r.playoffGainForMe >= 0 ? '+' : ''}${n1(r.playoffGainForMe)} in the playoff weeks.`,
    `${r.partner}: ${r.forThem >= 0 ? '+' : ''}${n1(r.forThem)}. Value is ${r.fairness}.`,
    r.verdict,
    r.tradesOpen ? null : `Note: the trade deadline (week ${r.deadline}) has passed.`,
  ]);
}
