// GET /api/advice: the one-sentence summary, reworded by Haiku when a key is set.
// Separate from /api/week so the page never waits on the model.

import { buildWeek } from '../lib/week.js';

export async function GET() {
  try {
    const week = await buildWeek(new Date(), { advice: true });
    return Response.json({ advice: week.advice }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    console.error('advice route:', err);
    return Response.json({ advice: null }, { status: 502, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
