// What the page needs to connect your own AI chat to your league. Behind the access gate.
//   GET              { mcpUrl }  the Claude / ChatGPT connector link
//   GET ?snapshot=1  plain text of the whole week, to paste into any chat with no setup

import { buildWeek } from '../lib/week.js';
import { config, zoneLabel } from '../lib/config.js';
import * as brief from '../lib/briefing.js';

const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET(request) {
  if (new URL(request.url).searchParams.has('snapshot')) {
    try {
      const w = await buildWeek(new Date(), { advice: false });
      const stamp = `${new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, dateStyle: 'full', timeStyle: 'short' }).format(new Date())} ${zoneLabel()}`;
      const text = [
        `This is my fantasy football situation in my league, as of ${stamp}. Answer my questions using only this, keep it short, and tell me exactly what to change in my fantasy app.`,
        '', '## How I am doing', brief.howAmIDoing(w),
        '', '## What to change', brief.whatToChange(w),
        '', '## Lineup', brief.lineup(w),
        '', '## Injuries', brief.injuries(w),
        '', '## Pickups', brief.pickups(w),
      ].join('\n');
      return new Response(text, { headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } });
    } catch (err) {
      console.error('snapshot:', err);
      return new Response('Could not load the league right now.', { status: 502, headers: HEADERS });
    }
  }
  const secret = process.env.MCP_SECRET;
  const origin = config.siteUrl || new URL(request.url).origin;
  return Response.json({ mcpUrl: secret ? `${origin}/mcp/${secret}` : null }, { headers: HEADERS });
}
