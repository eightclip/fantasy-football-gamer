import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { lockState, WINDOW_MS, MAX_FAILURES } from '../lib/lockout.js';

test('locks after too many recent wrong PINs and unlocks when the window passes', () => {
  const now = 1_000_000_000;
  const few = Array.from({ length: MAX_FAILURES - 1 }, (_, i) => now - i * 1000);
  assert.equal(lockState(few, now).locked, false);
  const many = [...few, now - 50_000];
  const s = lockState(many, now);
  assert.equal(s.locked, true);
  assert.equal(s.retryAt, now - 50_000 + WINDOW_MS);
  assert.equal(lockState(many, now + WINDOW_MS).locked, false);
  assert.equal(lockState('garbage', now).locked, false);
});
