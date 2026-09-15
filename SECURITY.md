# Security

This project runs on your own Vercel account and reads your fantasy league. It is designed so
that only you can see your site, secrets never touch the repository, and nothing it does can
change your league.

## What protects your site

| Layer | How |
|---|---|
| Access gate | `middleware.js` runs before every request, static files and APIs included. Without a valid cookie you get the PIN screen and nothing else. |
| Sign-in cookie | HMAC-SHA256 of the PIN keyed with `GATE_SECRET`; `HttpOnly`, `Secure`, `SameSite=Lax`, one year. Changing the PIN or secret signs every device out. |
| Guessing | A wrong PIN waits 1.5 s. After 10 wrong PINs in 15 minutes, sign-in is locked for everyone until the window passes (devices already signed in keep working). Vercel's platform DDoS protection also blocks request floods. |
| Fail closed | Missing `ACCESS_PIN` or `GATE_SECRET` keeps the whole site locked. |
| Scheduled checks | `/api/cron/*` requires `Authorization: Bearer $CRON_SECRET`, compared in constant time. |
| AI connector | Only reachable at `/mcp/<MCP_SECRET>` (256 bits of randomness). Every tool is read-only. Anyone with the link can read what your page shows, so treat it like a password and rotate `MCP_SECRET` if it leaks. |
| Browser | Strict `Content-Security-Policy` (scripts from the site only, no framing), `X-Frame-Options: DENY`, HSTS, `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `noindex`, `Cache-Control: private, no-store`. |
| Output | Every value from an API or third-party feed is HTML-escaped before display; news links must be `https:`. News text passed to AI tools is marked as information, not instructions. |
| Storage | Push subscriptions, alert history and news live in a **private** Vercel Blob store. |

## Secrets

- Generated locally by `npm run setup` into `.env.local` (git-ignored, owner-only permissions).
- Copied to Vercel by `npm run push-env` as **sensitive** environment variables, without printing.
- `npm run scan` (also run in CI) fails if a tracked file looks like it contains a key, token,
  private key or filled-in secret. Add personal strings you never want published (league ID,
  username) to a git-ignored `.scan-denylist`, one per line.
- ESPN `espn_s2` and `SWID` cookies give access to your ESPN account. Store them only as sensitive
  environment variables and remove them if you stop using the site.

## What leaves your deployment

Requests go only to: your league platform (Sleeper or ESPN), Sleeper's public NFL schedule and
projection endpoints, ESPN's public injury and kickoff endpoints, GitHub (nflverse data files),
RotoWire and RotoBaller RSS feeds, web push services (Apple, Google, Mozilla; payloads are
encrypted end to end), and Anthropic if you set `ANTHROPIC_API_KEY` (only a one-sentence summary
of your week is sent). No analytics, no tracking.

## Rotating

| If this leaked | Do |
|---|---|
| PIN | Change `ACCESS_PIN`, redeploy. All devices sign in again. |
| Connector link | Change `MCP_SECRET`, redeploy, re-add the connector. |
| `CRON_SECRET` | Change it in Vercel and in your GitHub Actions secret, redeploy. |
| VAPID keys | Regenerate, redeploy, turn alerts on again on each phone. |
| Anthropic key | Revoke it at console.anthropic.com, set a new one. |

## Reporting a vulnerability

Please use GitHub's **Report a vulnerability** (Security tab → Advisories) rather than a public
issue. Include steps to reproduce. You will get a response as soon as possible.
