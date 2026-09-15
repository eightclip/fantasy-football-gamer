# Fantasy Football Gamer

A private coach for your fantasy football team. It checks your league all week and tells you,
in plain words, exactly what to change: who to start, who to bench, who to pick up and drop,
and when each move locks. It runs on your own free Vercel account, behind your own PIN.

Works with **Sleeper** (full support) and **ESPN** (beta). Built so other platforms can be added.

> **Setting it up with an AI assistant?** Give it this repository's URL and ask
> *"What can we do with this, and how do I set it up for my league?"* The assistant should read
> [AGENTS.md](AGENTS.md), which walks it through every step, question and key.

## What it does

- **Tells you what to do, first.** The page leads with "2 changes to make" or "Nothing to change",
  as numbered steps with the lineup spot and lock time for each move.
- **Best lineup.** Uses your league's scoring, respects players whose games have started, and fills
  flex spots correctly.
- **Win odds.** Live chance of beating this week's opponent, planned against the best lineup they
  could field (bench included). Suggests a riskier or safer lineup when that raises your odds.
- **Injuries.** Combines your platform's tag, ESPN's injury notes and the NFL's official practice
  reports. Players who missed practice count for less.
- **Waivers.** Pickups ranked by how much they improve your team over the next two weeks and this
  week's matchup, with the cheapest drop, whether the player is free now or on waivers, and
  players worth grabbing before your opponent does.
- **Trades.** Finds 1-for-1, 2-for-1 and 1-for-2 trades that help both teams (the ones that get
  accepted), weighting the playoff weeks. Evaluates any trade you ask about.
- **The whole league.** Standings with simulated playoff and bye odds, any team's lineup,
  player cards with week-by-week usage, and player news.
- **Alerts on your phone.** Game-day reminders whenever your players are playing, a last call
  before a lock if something still needs fixing, injury downgrades, and waiver claims. Quiet
  when there is nothing to do.
- **Ask your AI.** A read-only MCP connector for Claude or ChatGPT ("How am I doing?",
  "Should I trade X for Y?"), plus a "Copy my week" snapshot for any chat app.
- **Private by default.** PIN lock with lockout, signed cookies, strict security headers, private
  storage, and no data leaves your deployment except to the services listed below.

## Quick start

You need Node.js 20+, a free [Vercel](https://vercel.com) account, and your league ID.

```bash
git clone https://github.com/eightclip/fantasy-football-gamer.git
cd fantasy-football-gamer
npm install
npm run setup     # asks about your league, generates every secret into .env.local
npm run check     # confirms your league, team, projections and news all load
```

Then deploy: [docs/DEPLOY.md](docs/DEPLOY.md) (about 10 minutes, mostly copy and paste).

## Costs

| Piece | Cost |
|---|---|
| Vercel Hobby plan (site, storage, functions) | Free for personal use |
| Alerts every 15 minutes | Free with the included GitHub Actions workflow, or built in on Vercel Pro |
| Sleeper, ESPN, nflverse, news feeds | Free, no keys |
| AI-worded summary line (optional, Anthropic API) | Pennies a season |

## Configuration

Everything is set with environment variables; nothing about your league is written into the
code. `npm run setup` fills them in. The full list with explanations is in
[.env.example](.env.example).

| Variable | What |
|---|---|
| `PLATFORM`, `LEAGUE_ID` | `sleeper` or `espn`, and the number from your league URL |
| `SLEEPER_USERNAME` or `ESPN_TEAM_ID` | Which team is yours |
| `ESPN_S2`, `ESPN_SWID` | Private ESPN leagues only |
| `ACCESS_PIN` | What you type to open the site |
| `TIMEZONE`, `MANAGER_NAME`, `SITE_URL` | How the site tells time and talks to you |
| `GATE_SECRET`, `CRON_SECRET`, `MCP_SECRET`, `VAPID_*` | Generated secrets |
| `BLOB_READ_WRITE_TOKEN` | Private storage, added by Vercel |
| `ANTHROPIC_API_KEY` | Optional |

## How it works

A static page and a handful of Vercel Functions. The page asks `/api/week` for one small
payload; the server fetches, caches and does all the math. A scheduled check (`/api/cron/watch`)
decides whether anything is worth an alert. Platform differences live in `lib/platforms/`.
Details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Data sources: your league platform's API, the NFL schedule via Sleeper's public endpoints, ESPN's
public injury and kickoff data, [nflverse](https://github.com/nflverse/nflverse-data) practice
reports and player ids, and RotoWire and RotoBaller headline feeds.

## Security

Read [SECURITY.md](SECURITY.md) for the full model. In short: every page and API sits behind the
PIN gate (10 wrong tries locks sign-in for 15 minutes), secrets only ever live in `.env.local`
and Vercel's encrypted environment variables, the AI connector is read-only behind a long random
link, and CI fails if anything that looks like a secret is committed.

## Honest limits

- Projections, win odds and trade values are estimates, not guarantees.
- Sleeper's projection and stats feeds and ESPN's fantasy API are unofficial and can change.
  When a feed is down, the site says so instead of showing wrong numbers.
- Nothing here can make changes in your league. You make every move in your fantasy app.
- ESPN support is beta: usage stats, drops and trending adds are not read yet.
- Not affiliated with Sleeper, ESPN, the NFL or any data provider. For personal use.

## Contributing

Issues and pull requests are welcome, especially new platform adapters (Yahoo, NFL Fantasy,
CBS). See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
