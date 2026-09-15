# Ask Claude or ChatGPT

The site includes a read-only [MCP](https://modelcontextprotocol.io) server. Your private link is
`https://<your-site>/mcp/<MCP_SECRET>`; the site shows it (after the PIN) under **Ask Claude or
ChatGPT** with a copy button.

## Connect

- **Claude** (claude.ai, desktop, mobile): Settings → Connectors → Add custom connector. Paste the
  link, leave OAuth empty. In a chat, enable it from the tools menu.
- **ChatGPT** (Plus or Pro): Settings → Apps → Advanced settings → Developer mode on → Create.
  Paste the link, authentication: No authentication. Work accounts may block custom connectors.
- **Claude Code:** `claude mcp add --transport http fantasy-football <link>`

Menu names change from time to time; check the providers' help pages if yours differ.

No connector? The **Copy my week** button copies a text snapshot to paste into any AI chat.

## Tools

| Tool | Answers |
|---|---|
| `how_am_i_doing` | Score, win chance, who still plays, the bottom line |
| `what_to_change` | Numbered moves to make right now, with lock times |
| `lineup` | Best lineup by slot, what is set or locked, bench |
| `injuries` | Injury status, practice reports and ESPN notes for your roster |
| `pickups` | Pickups with drops, free-now vs waivers, blocks, bye gaps, waiver priority |
| `standings` | Standings with playoff and bye odds |
| `team` | Any team's record, odds, best lineup and bench |
| `player` | Any player: owner, injury, projections, week-by-week usage, news |
| `news` | Recent headlines for your players or the whole league |
| `find_trades` | Trades that help you without hurting the other team |
| `evaluate_trade` | Judge a specific trade for both sides |

## Security

Anyone with the link can read what your page shows. Nothing can be changed. If the link leaks,
set a new `MCP_SECRET`, redeploy, and re-add the connector. The server is stateless: it answers
`GET` with 405 so clients do not hold connections open.
