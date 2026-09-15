# Instructions for AI assistants

You are helping someone run **Fantasy Football Gamer**, a private coach for their fantasy football
team that they deploy to their own Vercel account. This file tells you what to explain, what to
ask, which commands to run, and which rules to follow. Read it all before you start.

If the person only asked "what can we do with this?", start with **1. Explain** and ask whether
they want to set it up. Do not start running commands until they say yes.

## 1. Explain (short)

Tell them, in a few sentences:

- It checks their league all week and says exactly what to change (start, bench, pick up, drop,
  trade), with lock times, win odds and injury news.
- It sends phone alerts only when something needs doing, and they can ask Claude or ChatGPT about
  their team through a read-only connector.
- It runs free on their own Vercel account behind a PIN. Sleeper is fully supported; ESPN is beta.
- Setup takes about 15 minutes. They will need: Node.js 20+, a Vercel account, their league URL,
  and (optional) an Anthropic API key.

## 2. Ask for these, one short batch at a time

| Ask | How they find it | Becomes |
|---|---|---|
| Platform | Sleeper or ESPN | `PLATFORM` |
| League ID | Sleeper: the number in `sleeper.com/leagues/<id>`. ESPN: `leagueId=` in the league URL | `LEAGUE_ID` |
| Their team | Sleeper: their **username** (profile, not team name). ESPN: `teamId=` on their team page | `SLEEPER_USERNAME` / `ESPN_TEAM_ID` |
| ESPN only: is the league private? | If the league page needs a login to view | then `ESPN_S2`, `ESPN_SWID` (see docs/PLATFORMS.md) |
| First name (optional) | For alerts and AI answers | `MANAGER_NAME` |
| Time zone | e.g. America/Chicago | `TIMEZONE` |
| A PIN or passphrase, 8+ characters | They choose it; suggest a few words | `ACCESS_PIN` |
| Anthropic API key (optional) | console.anthropic.com → API keys | `ANTHROPIC_API_KEY` |
| Vercel plan | Hobby (free) or Pro | decides how alerts are scheduled (step 6) |

Do not ask them to paste secrets (PIN, API keys, ESPN cookies) into the chat if you can avoid it.
Prefer that they type them into the `npm run setup` prompts or the Vercel dashboard. If they do
paste one, use it only for the command that needs it and never repeat it back.

## 3. Install and configure

```bash
git clone https://github.com/eightclip/fantasy-football-gamer.git   # or their fork
cd fantasy-football-gamer
npm install
npm run setup
```

`npm run setup` asks the questions above, checks that the league and team exist, and generates
`GATE_SECRET`, `CRON_SECRET`, `MCP_SECRET` and the web push (`VAPID_*`) keys into `.env.local`.
If you cannot run interactive prompts, pass values through the environment:

```bash
PLATFORM=sleeper LEAGUE_ID=123456789 SLEEPER_USERNAME=theirname TIMEZONE=America/Chicago \
MANAGER_NAME=Sam ACCESS_PIN='several words here' npm run setup -- --yes
```

Then verify before deploying:

```bash
npm run check
```

Every line should say `ok`. `warn` lines are fine at this stage. Fix any `FAIL` using
**Troubleshooting** below.

## 4. Deploy to Vercel

```bash
npx vercel login
npx vercel link                       # create a new project when asked
npx vercel blob create-store ffg-data --access private -e production -y
npm run push-env                      # copies .env.local to Vercel; never prints values
npx vercel deploy --prod
```

Take the production URL from the deploy output, then:

```bash
# put the URL in .env.local as SITE_URL=https://..., then
npm run push-env -- --force
npx vercel deploy --prod
```

Open the URL, enter the PIN, and confirm the page loads their team.

## 5. Phone alerts

On iPhone, alerts only work from a Home Screen app: open the site in Safari → Share → Add to Home
Screen → open it from the Home Screen → enter the PIN → tap **Turn on alerts**. Android Chrome can
turn alerts on directly. A test alert confirms it works.

## 6. Schedule the alert check

- **Vercel Pro:** `npx vercel crons add --path /api/cron/watch --schedule "*/15 * * * *"`, then
  `npx vercel deploy --prod`.
- **Vercel Hobby (free):** Hobby cron jobs can only run once a day and deploys fail with a
  15-minute schedule, so use GitHub Actions instead. Copy `docs/github-actions-alerts.yml` to
  `.github/workflows/alerts.yml` in their repository, add the Actions variable `SITE_URL` and the
  Actions secret `CRON_SECRET` (same value as `.env.local`; tell them to copy it from that file
  themselves), and push.

## 7. Ask Claude or ChatGPT (optional)

On the site, open **Ask Claude or ChatGPT** at the bottom. It shows their private connector link
with a copy button and setup steps. Claude: Settings → Connectors → Add custom connector (no
OAuth). ChatGPT: Settings → Apps → Advanced → Developer mode → Create (no authentication;
Plus/Pro plans). Details: docs/AI-CONNECTOR.md.

## Rules for you, the assistant

1. **Never commit, print or log secrets.** `.env.local` is git-ignored; keep it that way. Do not
   `cat` it. Do not echo values in commands you show.
2. **Run `npm run scan` before any push** to a repository. It must pass.
3. **Do not weaken security to make something work.** Do not remove the PIN gate, the lockout,
   the security headers, or the checks in `middleware.js`. Do not make the Blob store public.
4. **Rapid repeated requests can get their IP temporarily blocked by Vercel's DDoS protection**
   (403 with `x-vercel-mitigated: deny`). Test the deployed site with a few sequential requests.
5. **Nothing here writes to their league.** If they ask you to make a move for them, explain that
   they make it in their fantasy app.
6. Keep changes small and run `npm test` after editing code.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `No Sleeper user named ...` | They gave a team name or display name. Ask for the username from their Sleeper profile. |
| `None of the teams in this league is yours` | Wrong username or `ESPN_TEAM_ID`, or a different league. |
| `ESPN refused the league` | Private league: set `ESPN_S2` and `ESPN_SWID` (docs/PLATFORMS.md). |
| Page says "not set up yet. Missing environment variables" | Run `npm run push-env`, then redeploy. |
| Alerts never arrive | Check step 6 is done; on iPhone confirm it was added to the Home Screen; use **Send a test** on the page. |
| `Projections are down` | A data feed is temporarily unavailable. The page recovers on its own. |
| Deploy fails with "Hobby accounts are limited to daily cron jobs" | Remove the `crons` entry from `vercel.json` and use the GitHub Actions option. |
| 403 from every Vercel URL | Temporary DDoS block from too many rapid requests. Wait 15 to 30 minutes. |

## Where things are

- `lib/platforms/` – one adapter per platform (see `lib/source.js` for the shared shape)
- `lib/week.js` – this week's lineup, odds, injuries, pickups
- `lib/leagueData.js` – standings, playoff odds, trades, player cards, news
- `lib/alerts.js` – when to send which alert
- `api/` – thin HTTP routes; `middleware.js` – the access gate
- `public/` – the page, service worker and home-screen manifest
- `docs/` – deploy, platforms, architecture, alerts, AI connector
