import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { claimStatus, nextClaimsRun, inTimeFor } from '../lib/waivers.js';

const SUN_NIGHT = new Date('2026-09-14T03:00:00.000Z'); // Sun 8pm PDT
const FRI = new Date('2026-09-18T19:00:00.000Z'); // Fri noon PDT

test('claims run early Wednesday Pacific', () => {
  assert.equal(nextClaimsRun(SUN_NIGHT).toISOString(), '2026-09-16T10:00:00.000Z');
  assert.equal(nextClaimsRun(new Date('2026-09-16T11:00:00.000Z')).toISOString(), '2026-09-23T10:00:00.000Z');
});

test('untouched players whose game has not started are free now', () => {
  assert.deepEqual(claimStatus({ now: FRI }), { free: true, until: null, reason: null });
});

test('once his game starts he waits for the Wednesday run', () => {
  const s = claimStatus({ now: SUN_NIGHT, gameStarted: true });
  assert.equal(s.free, false);
  assert.equal(s.until, '2026-09-16T10:00:00.000Z');
  assert.equal(s.reason, 'game started');
});

test('a fresh drop sits on waivers for two days, and can still make a later game', () => {
  const droppedAt = new Date('2026-09-18T18:00:00.000Z').getTime(); // Fri 11am
  const s = claimStatus({ now: FRI, droppedAt });
  assert.equal(s.until, '2026-09-20T18:00:00.000Z');
  assert.equal(inTimeFor(s, '2026-09-21T00:15:00.000Z'), true); // Sunday night game
  assert.equal(inTimeFor(s, '2026-09-20T17:00:00.000Z'), false); // Sunday 10am game
});
