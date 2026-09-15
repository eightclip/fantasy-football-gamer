# Architecture

No framework and no build step: a static page, Vercel Functions, and Routing Middleware.

```
browser ──► middleware.js (access gate, lockout, headers)
              │
              ├─ public/            page, service worker, manifest
              ├─ /api/week          lib/week.js        this week: lineup, odds, injuries, pickups
              ├─ /api/league        lib/leagueData.js  standings, playoff odds, trades, news, usage
              ├─ /api/advice        lib/advice.js      one-sentence summary (rules, optional AI rewording)
              ├─ /api/connect       connector link, "copy my week" snapshot
              ├─ /api/push          save a phone, send a test
              ├─ /mcp/<secret> ──►  /api/mcp          read-only MCP tools (lib/briefing.js)
              └─ /api/cron/watch    lib/alerts.js     decide and send alerts (Bearer CRON_SECRET)

lib/source.js ──► lib/platforms/sleeper.js | lib/platforms/espn.js
lib/nfl.js        schedule, byes, kickoffs, ESPN injuries, nflverse reports and ids, news feeds
lib/math.js       scoring, lineup solver, win probability, pickups, bye gaps
lib/league.js     standings, season simulation, trade search, usage trends, news matching
lib/waivers.js    free now or on waivers, and until when
lib/store.js      private Blob store (subscriptions, alert state, news archive, lockout)
```

## Data flow

1. The page loads and asks `/api/week`. The server builds the week from cached sources and returns
   one small JSON payload. The page renders the lead ("what to do") from it.
2. `/api/league` and `/api/advice` load afterwards so the page never waits on them.
3. Every 15 minutes the scheduled check builds the week, runs `decide()` in `lib/alerts.js`, sends
   web push to saved phones, archives news, and warms the league cache.

## Principles

- **Math is code, not AI.** Lineups, odds, pickups and trades are deterministic and tested. The
  optional model only rewords a sentence the rules already wrote, and anything that drops a name
  or number from that sentence is thrown away.
- **Plan against the best the opponent can do**, bench included.
- **Say when data is missing.** Each feed failure sets a flag the page and AI answers report.
- **Never act on the league.** Everything is read-only.

## Caching

`lib/http.js` caches in memory and in Vercel's Runtime Cache. Lifetimes: player dictionary 24 h,
projections 15 min (6 h for far-future weeks), rosters 2 min, matchups and game status 1 min,
injury notes 30 min, practice reports 3 h, news 10 min.

## Models of uncertainty

Win probability treats each player's score as normal around the projection, with spread by
position (receivers and defenses swing more than quarterbacks). Games in progress count as half
played. Playoff odds simulate the rest of the season 4,000 times from each team's best projected
lineup each week. These are good for comparing options, not exact.
