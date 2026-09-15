# Contributing

Thanks for helping. Small, focused pull requests with tests are the easiest to review.

## Setup

```bash
npm install
npm test            # every test, no network or keys needed
npm run setup       # optional: your own league in .env.local
npm run dev         # local preview at http://localhost:3000 (no access gate)
```

Before opening a pull request: `npm test` and `npm run scan` must pass. Never include real
league IDs, usernames, team names, cookies or keys in code, tests, fixtures or screenshots. Use
made-up names in fixtures.

## Code style

- Plain ES modules for Node 20+ and the browser. No build step, no framework, no TypeScript.
- Pure logic (math, alerts, waivers, league, briefing) takes data in and returns data out, with
  tests in `test/`. Network code stays in `lib/http.js`, `lib/nfl.js` and `lib/platforms/`.
- Comments explain why, not what. Match the surrounding code.
- Everything shown on the page goes through `esc()` or `textContent`.

## Adding a platform

1. Create `lib/platforms/<name>.js` exporting `create<Name>()` that returns the methods and shapes
   documented at the top of `lib/source.js`: `league`, `teams`, `matchups`, `players`,
   `projections`, `weekStats`, `drops`, `trending`, `externalIds`.
2. Keep response parsing in pure exported functions and test them with made-up fixtures
   (see `test/espn.test.js`).
3. Register it in `lib/source.js`, add its settings to `lib/config.js`, `.env.example`,
   `scripts/setup.mjs` and `docs/PLATFORMS.md`.
4. Projections must be in the league's own scoring (points per player per week). Player `team`
   values use standard NFL abbreviations (`WAS`, `JAX`, `LAR`, ...) so byes and kickoffs line up.

Ideas that would help: Yahoo, NFL Fantasy and CBS adapters; ESPN usage stats and transactions;
a trade search that includes three-team deals.
