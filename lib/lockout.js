// Stops PIN guessing: after MAX_FAILURES wrong PINs in WINDOW_MS, nobody can try again until
// the window passes. A phone that is already signed in keeps working; only new sign-ins wait.

export const WINDOW_MS = 15 * 60e3;
export const MAX_FAILURES = 10;

// failures: timestamps (ms) of recent wrong PINs.
export function lockState(failures, now) {
  const recent = (Array.isArray(failures) ? failures : []).filter(t => typeof t === 'number' && now - t < WINDOW_MS).sort((a, b) => a - b);
  const locked = recent.length >= MAX_FAILURES;
  return { locked, recent, retryAt: locked ? recent[recent.length - MAX_FAILURES] + WINDOW_MS : null };
}
