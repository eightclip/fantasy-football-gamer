// Turns the numbers into one headline and one sentence. Rules pick what to say;
// Haiku only rewords it. With no API key, or any failure, the rule text ships as-is.

import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { getCache } from '@vercel/functions';
import { createHash } from 'node:crypto';
import { config } from './config.js';

const pts = n => `${n.toFixed(1)} point${n === 1 ? '' : 's'}`;
const pct = p => `${Math.round(p * 100)}%`;
const names = list => list.map(p => p.name).join(' and ');
const capital = t => t.charAt(0).toUpperCase() + t.slice(1);

const local = (date, opts) => new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, ...opts }).format(date);
function when(iso, now) {
  const d = new Date(iso);
  const time = local(d, { hour: 'numeric', minute: '2-digit' }).replace(':00', '').replace(/\s/g, '').toLowerCase();
  const sameDay = local(d, { dateStyle: 'short' }) === local(now, { dateStyle: 'short' });
  return `${time} ${sameDay ? 'today' : local(d, { weekday: 'long' })}`;
}

// One headline and one plain sentence that sums up what the page says to do.
// `keep` lists every name and number the sentence must still contain after rewording.
export function ruleAdvice(week) {
  const { decisions = [], pickups = [], matchup, nextMatchup, swaps, dayKey } = week;
  const now = new Date(week.generatedAt || Date.now());
  const keep = [];
  const hold = (...xs) => { keep.push(...xs.filter(Boolean)); };

  const injury = decisions.find(d => d.kind === 'injury');
  const swapDecision = decisions.find(d => d.kind === 'swap');
  const pick = pickups[0];
  const waiverDay = dayKey === 'Tue' || dayKey === 'Wed';

  if (pick && waiverDay) {
    hold(pick.name, pick.dropName, pts(pick.gain));
    return {
      headline: `Pick up ${pick.name}, drop ${pick.dropName}`,
      body: `Claim ${pick.name} and drop ${pick.dropName} ${dayKey === 'Tue' ? 'today' : 'now'}, worth about ${pts(pick.gain)} over the next two weeks.`,
      keep,
    };
  }

  if (swaps?.start?.length && swaps.worth > 0.05) {
    const lockAt = [...swaps.start, ...swaps.sit].filter(p => !p.locked && p.kickoff).map(p => p.kickoff).sort()[0];
    const why = injury && swaps.sit.some(p => injury.ids.includes(p.id)) ? `${injury.headline}, so ` : '';
    const up = matchup?.winProbability != null && matchup.winProbabilityWithSwaps > matchup.winProbability + 0.005;
    const gain = up
      ? `, and your chance of winning goes from ${pct(matchup.winProbability)} to ${pct(matchup.winProbabilityWithSwaps)}`
      : `, worth about ${pts(swaps.worth)}`;
    hold(...swaps.start.map(p => p.name), ...swaps.sit.map(p => p.name));
    if (up) hold(pct(matchup.winProbability), pct(matchup.winProbabilityWithSwaps)); else hold(pts(swaps.worth));
    return {
      headline: swapDecision?.headline || injury?.headline || `Start ${names(swaps.start)}`,
      body: capital(`${why}start ${names(swaps.start)} and bench ${names(swaps.sit)}${lockAt ? ` before ${when(lockAt, now)}` : ' now'}${gain}.`),
      keep,
    };
  }

  const first = decisions[0];
  if (first && first.kind !== 'odds') {
    hold(...(first.headline.match(/^[A-Z][\w.'-]+(?: [A-Z][\w.'-]+)+/) || []));
    const lock = first.lockAt ? ` Check again before ${when(first.lockAt, now)}.` : '';
    return { headline: first.headline, body: `${first.headline}. ${first.text}${lock}`, keep };
  }

  if (pick && pick.gain >= 3) {
    hold(pick.name, pick.dropName, pts(pick.gain));
    return {
      headline: `Pick up ${pick.name}, drop ${pick.dropName}`,
      body: `Pick up ${pick.name} and drop ${pick.dropName}, worth about ${pts(pick.gain)} over the next two weeks.`,
      keep,
    };
  }

  if (matchup?.status === 'final') {
    const result = matchup.you > matchup.them ? 'beat' : matchup.you < matchup.them ? 'lost to' : 'tied';
    hold(matchup.opponent, matchup.you.toFixed(1), matchup.them.toFixed(1));
    const next = nextMatchup ? `, and you are ${pct(nextMatchup.winProbability)} to beat ${nextMatchup.opponent} next week` : '';
    if (nextMatchup) hold(pct(nextMatchup.winProbability), nextMatchup.opponent);
    return {
      headline: matchup.you > matchup.them ? `You beat ${matchup.opponent}` : 'Nothing to change',
      body: `You ${result} ${matchup.opponent} ${matchup.you.toFixed(1)} to ${matchup.them.toFixed(1)}${next}.`,
      keep,
    };
  }

  if (matchup?.winProbability != null) {
    hold(pct(matchup.winProbability), matchup.opponent);
    return {
      headline: 'Your lineup is already right',
      body: `Your lineup is set and you are ${pct(matchup.winProbability)} to beat ${matchup.opponent} this week.`,
      keep,
    };
  }
  return { headline: 'Your lineup is already right', body: 'Your lineup is set. Nothing on your bench or the wire beats who you have starting.', keep };
}

const Advice = z.object({ sentence: z.string() });

export async function writeAdvice(week) {
  const { keep, ...fallback } = ruleAdvice(week);
  const rules = { ...fallback, by: 'rules' };
  if (!config.anthropicKey || config.adviceOff) return rules;

  // Only the rule's own sentence goes in. Given more (pickups, odds, injuries), the model
  // starts adding actions of its own, which is exactly what it must not do.
  const facts = { sentence: fallback.body, mustKeep: keep };
  const key = 'advice:v2:' + createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 32);

  let cache = null;
  try { cache = getCache({ namespace: 'ffg-v1' }); } catch { /* local dev */ }
  try {
    const hit = cache && await cache.get(key);
    if (hit) return hit;
  } catch { /* regenerate */ }

  try {
    const client = new Anthropic({ apiKey: config.anthropicKey, timeout: 6000, maxRetries: 1 });
    const response = await client.messages.parse({
      model: config.adviceModel,
      max_tokens: 300,
      system: `You reword one-line fantasy football instructions for ${config.managerName || 'a fantasy manager'}, who does not want analysis. ` +
        'The decision is already made; you only make the sentence sound like a friend saying it. ' +
        'Never add, remove or change an action, a player, a number or a percentage.',
      messages: [{
        role: 'user',
        content: `Sentence: ${facts.sentence}\nMust contain, exactly as written: ${JSON.stringify(keep)}\n\n` +
          'Reword the sentence for them. One sentence, under 30 words, plain and warm. ' +
          'Keep any time like "10am Sunday". No jargon, no hedging, no em dashes, no greeting, no exclamation marks.',
      }],
      output_config: { format: zodOutputFormat(Advice) },
    });
    const out = response.parsed_output?.sentence?.trim();
    // Anything missing a name or number from the rules is thrown away, not shown.
    if (!out || out.length > 240 || /\u2014/.test(out) || !keep.every(k => out.includes(k))) return rules;
    const advice = { headline: fallback.headline, body: out, by: config.adviceModel };
    if (cache) cache.set(key, advice, { ttl: 6 * 3600 }).catch(() => {});
    return advice;
  } catch (err) {
    if (err instanceof Anthropic.APIError) console.error('advice: Anthropic', err.status, err.message);
    else console.error('advice:', err?.message || err);
    return { ...fallback, by: 'rules' };
  }
}
