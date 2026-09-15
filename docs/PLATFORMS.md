# Platforms

## Sleeper (full support)

| Setting | Where to find it |
|---|---|
| `LEAGUE_ID` | Open your league in a browser: `https://sleeper.com/leagues/<LEAGUE_ID>/...` |
| `SLEEPER_USERNAME` | Your profile username (not your team name or display name) |

Sleeper's API is public and needs no key. The app also uses Sleeper's public projection and
stats feeds, which are unofficial and could change.

Everything is supported: league scoring, lineups, projections for every remaining week, weekly
usage (snaps, targets, carries), waiver drops, trending adds, standings, trades and alerts.

## ESPN (beta)

| Setting | Where to find it |
|---|---|
| `LEAGUE_ID` | `leagueId=` in `https://fantasy.espn.com/football/league?leagueId=...` |
| `ESPN_TEAM_ID` | `teamId=` on your team page |
| `ESPN_S2`, `ESPN_SWID` | Private leagues only (below) |

ESPN projections and results come back already scored with your league's settings.

Not yet supported on ESPN: usage stats (trends show points only), waiver drops (so claim timing
only accounts for games that have started), trending adds, and the trade deadline week (trade
ideas stay on).

### Private ESPN leagues

ESPN only shows private leagues to logged-in members, so the app needs two cookies from your
browser. **They give access to your ESPN account: treat them like a password.**

1. Log in at fantasy.espn.com in a desktop browser.
2. Open developer tools (F12) → Application (Chrome) or Storage (Firefox) → Cookies →
   `https://fantasy.espn.com`.
3. Copy the value of `espn_s2` into `ESPN_S2`, and `SWID` (including the curly braces) into
   `ESPN_SWID`.

They last until you log out of ESPN in that browser. If the site later says ESPN refused the
league, repeat these steps.

## Adding another platform

See [CONTRIBUTING.md](../CONTRIBUTING.md#adding-a-platform). An adapter is one file in
`lib/platforms/` returning the shared shapes documented in `lib/source.js`.
