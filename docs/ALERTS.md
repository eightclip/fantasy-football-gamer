# Alerts

Web push notifications, decided by `lib/alerts.js` every time `/api/cron/watch` runs (every 15
minutes once scheduled, see DEPLOY.md). All times are in `TIMEZONE`.

| Alert | When | Only if |
|---|---|---|
| Game day | 8am Sunday, 9am other days, or 2 hours before the first kickoff if earlier (the evening before for very early games) | One of your starters plays that day. Leads with a decision if one is open. |
| Last call | About an hour before a lock | A lineup decision involving that game is still open |
| Injury | As soon as it is seen (held overnight unless kickoff is within 5 hours) | A player in your lineup gets worse news. Never on good news. At most 3 a day. |
| Waiver claim | Tuesday from 9am | A player on waivers is worth 2+ points over two weeks |
| Free agent | Wednesday to Sunday daytime | A player you can add right now is worth it |
| Block | Daytime | A free player your opponent would start, cheap for you to carry, protects 5+ points of win chance |

Rules: each alert sends once, at most 3 per run, nothing outside the NFL regular season or
playoffs, and the first run after setup only records injury status (no alerts about existing
injuries).

Preview without sending (needs your `CRON_SECRET`):

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://your-site/api/cron/watch?dry=1&at=2026-10-04T15:05:00Z"
```
