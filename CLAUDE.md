# Fantasy Football Gamer

Read [AGENTS.md](AGENTS.md) first: it covers setup, deployment, the questions to ask, and the
security rules (never print or commit secrets, run `npm run scan` before pushing, never weaken
the access gate).

- `npm test` runs every test. `npm run check` verifies a configured league end to end.
- Code style: plain ES modules, no build step, no framework. Match the surrounding code.
- Platform adapters live in `lib/platforms/` and return the shapes documented in `lib/source.js`.
