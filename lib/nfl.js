// NFL-wide data that does not depend on which fantasy platform you play on:
// the calendar, game status, kickoff times, injury reports, player id maps, news.

import { cached, json, text, csv, mapLimit } from './http.js';
import { config } from './config.js';

const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/football/leagues/nfl';
const ESPN_TO_STANDARD = { WSH: 'WAS', JAC: 'JAX' };
export const standardTeam = abbr => (abbr ? ESPN_TO_STANDARD[abbr.toUpperCase()] || abbr.toUpperCase() : null);

// Current NFL week and season. Sleeper's state endpoint is public and platform-neutral.
export const nflState = () => cached('nfl-state', 600, async () => {
  const s = await json('https://api.sleeper.app/v1/state/nfl');
  return { week: Math.max(1, Number(s.week) || 1), season: Number(config.season || s.season), seasonType: s.season_type };
});

// One row per game with a status. Refreshed every minute so locks show up quickly.
const schedule = season => cached(`schedule:${season}`, 60, () => json(`https://api.sleeper.com/schedule/nfl/regular/${season}`));

// { week: [team, ...] } of teams with no game that week.
export async function byeWeeks(season) {
  const games = await schedule(season);
  const teams = new Set(games.flatMap(g => [g.home, g.away]));
  const playing = {};
  for (const g of games) (playing[g.week] ||= new Set()).add(g.home).add(g.away);
  return Object.fromEntries(Object.entries(playing).map(([w, set]) => [w, [...teams].filter(t => !set.has(t))]));
}

// { team: { state: 'pre'|'in'|'post', left, day } } for one week. No game clock is available,
// so a game in progress counts as half played.
export async function games(season, week) {
  const byTeam = {};
  for (const g of (await schedule(season)).filter(g => g.week === Number(week))) {
    if (g.status === 'canceled' || g.status === 'postponed') continue;
    const state = g.status === 'pre_game' ? 'pre' : g.status === 'complete' ? 'post' : 'in';
    const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${g.date}T12:00:00Z`));
    const entry = { state, left: state === 'pre' ? 1 : state === 'in' ? 0.5 : 0, day };
    byTeam[g.home] = entry;
    byTeam[g.away] = entry;
  }
  return byTeam;
}

// Team code → ESPN team id.
export const espnTeams = season => cached(`espn-teams:${season}`, 30 * 86400, async () => {
  const list = await json(`${ESPN_CORE}/seasons/${season}/teams?limit=40`);
  const teams = await mapLimit(list.items, 8, item => json(item.$ref));
  return Object.fromEntries(teams.map(t => [standardTeam(t.abbreviation), t.id]));
});

// { team: kickoff ISO } for one week.
export const kickoffs = (season, week) => cached(`kickoffs:${season}:${week}`, 3 * 3600, async () => {
  const [ids, list] = await Promise.all([espnTeams(season), json(`${ESPN_CORE}/seasons/${season}/types/2/weeks/${week}/events?limit=50`)]);
  const byId = Object.fromEntries(Object.entries(ids).map(([abbr, id]) => [id, abbr]));
  const events = await mapLimit(list.items, 8, item => json(item.$ref));
  const out = {};
  for (const e of events) {
    for (const c of e.competitions?.[0]?.competitors || []) {
      const team = byId[c.id];
      if (team) out[team] = new Date(e.date).toISOString();
    }
  }
  return out;
});

// Latest ESPN injury note per requested athlete on one team: { athleteId: { status, comment, date } }.
export async function espnInjuries(teamId, athleteIds) {
  const refs = await cached(`espn-inj:${teamId}`, 1800, async () => {
    const list = await json(`${ESPN_CORE}/teams/${teamId}/injuries?limit=200`);
    const latest = {};
    for (const { $ref } of list.items || []) {
      const m = $ref.match(/athletes\/(\d+)\/injuries\/(\d+)/);
      if (m && (!latest[m[1]] || +m[2] > +latest[m[1]].id)) latest[m[1]] = { id: m[2], ref: $ref };
    }
    return latest;
  });
  const wanted = athleteIds.map(String).filter(a => refs[a]);
  const details = await mapLimit(wanted, 6, a => cached(`espn-inj-item:${refs[a].id}`, 6 * 3600, async () => {
    const d = await json(refs[a].ref);
    return { status: d.status || null, comment: d.shortComment || null, date: d.date || null };
  }));
  return Object.fromEntries(wanted.map((a, i) => [a, details[i]]));
}

// Official practice and game-status reports from nflverse: gsis_id → latest row this season.
export const practiceReports = season => cached(`practice:${season}`, 10800, async () => {
  const rows = csv(await text(`https://github.com/nflverse/nflverse-data/releases/download/injuries/injuries_${season}.csv`));
  const out = {};
  for (const r of rows) {
    if (r.season_type !== 'REG' || !r.gsis_id) continue;
    const week = Number(r.week);
    if (out[r.gsis_id] && out[r.gsis_id].week > week) continue;
    const practice = /did not/i.test(r.practice_status) ? 'DNP' : /limited/i.test(r.practice_status) ? 'Limited' : /full/i.test(r.practice_status) ? 'Full' : null;
    out[r.gsis_id] = { week, report: r.report_status || null, practice, injury: r.report_primary_injury || r.practice_primary_injury || null };
  }
  return out;
});

// Cross-platform player ids from nflverse's roster file, keyed both ways.
export const idMaps = season => cached(`ids:${season}`, 86400, async () => {
  const rows = csv(await text(`https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_${season}.csv`));
  const bySleeper = {}, byEspn = {};
  for (const r of rows) {
    const ids = { espn: r.espn_id && r.espn_id !== 'NA' ? r.espn_id : null, gsis: r.gsis_id || null };
    if (r.sleeper_id && r.sleeper_id !== 'NA') bySleeper[r.sleeper_id] = ids;
    if (ids.espn) byEspn[ids.espn] = ids;
  }
  return { bySleeper, byEspn };
});

// Player news headlines. Short items with a link back; no article bodies.
function rssItems(xml, source) {
  const decode = t => (t || '').replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#8217;|&#8216;/g, "'").replace(/&#8220;|&#8221;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const tag = name => decode((it.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1]);
    const published = tag('pubDate');
    const link = tag('link');
    return {
      source, title: tag('title'), summary: tag('description').slice(0, 400),
      link: /^https:\/\/[^\s"'<>]+$/.test(link) ? link : null, // https only: feeds are third-party
      published: published && !isNaN(new Date(published)) ? new Date(published).toISOString() : null,
    };
  }).filter(i => i.title);
}
export { rssItems as parseRss };

export const newsFeeds = () => cached('news-feeds', 600, async () => {
  const feeds = [
    ['RotoWire', 'https://www.rotowire.com/rss/news.php?sport=NFL'],
    ['RotoBaller', 'https://www.rotoballer.com/player-news/feed?sport=nfl'],
  ];
  const results = await Promise.all(feeds.map(([source, url]) =>
    text(url).then(xml => rssItems(xml, source)).catch(err => { console.error(`news ${source}:`, err.message); return []; })));
  return results.flat();
});
