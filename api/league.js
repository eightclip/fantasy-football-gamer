// GET /api/league: the league-wide sections of the page (standings and playoff odds, trade ideas,
// news on your players, usage trends). Separate from /api/week so the page never waits on it.

import { leagueContext } from '../lib/leagueData.js';

const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  try {
    const c = await leagueContext();
    return Response.json({
      week: c.week, projectionsOk: c.projectionsOk, playoffStart: c.playoffStart, lastRegular: c.lastRegular,
      standings: c.standings, trades: c.trades, tradesOpen: c.tradesOpen, deadline: c.deadline,
      trends: c.trends, news: c.news, generatedAt: c.generatedAt,
    }, { headers: HEADERS });
  } catch (err) {
    console.error('league:', err);
    return Response.json({ error: err.message }, { status: 502, headers: HEADERS });
  }
}
