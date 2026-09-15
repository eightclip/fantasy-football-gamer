// GET /api/week: everything the page shows for this week. Behind the access gate.

import { buildWeek } from '../lib/week.js';

const HEADERS = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  try {
    return Response.json(await buildWeek(new Date(), { advice: false }), { headers: HEADERS });
  } catch (err) {
    console.error('week:', err);
    return Response.json({ error: err.message || 'Something broke building the week' }, { status: 502, headers: HEADERS });
  }
}
