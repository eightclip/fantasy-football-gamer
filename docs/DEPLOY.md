# Deploy to Vercel

About 10 minutes. You need Node.js 20+ and a free Vercel account.

## 1. Configure locally

```bash
git clone https://github.com/eightclip/fantasy-football-gamer.git
cd fantasy-football-gamer
npm install
npm run setup     # writes .env.local with your league and freshly generated secrets
npm run check     # every line should say ok
```

Fork the repository first if you want your own copy on GitHub (needed for the free alert
schedule in step 5).

## 2. Create the Vercel project and private storage

```bash
npx vercel login
npx vercel link                                          # choose "create a new project"
npx vercel blob create-store ffg-data --access private -e production -y
```

The Blob store holds push subscriptions, alert history and news. It must be `private`.
Creating it adds `BLOB_READ_WRITE_TOKEN` to the project for you.

## 3. Send your settings and deploy

```bash
npm run push-env          # names only are printed; values go straight to Vercel as sensitive
npx vercel deploy --prod
```

Copy the production URL from the output. Add it to `.env.local` as `SITE_URL=https://...`, then:

```bash
npm run push-env -- --force
npx vercel deploy --prod
```

Open the URL and enter your PIN. You should see this week's lineup.

To use a custom domain: Vercel dashboard → your project → Settings → Domains. Update `SITE_URL`
to match and redeploy.

## 4. Turn on phone alerts

- **iPhone:** Safari → Share → Add to Home Screen. Open it from the Home Screen (it signs in
  separately), then tap **Turn on alerts**.
- **Android:** open the site in Chrome and tap **Turn on alerts**.

A test alert arrives right away. Repeat on each device you want alerts on.

## 5. Schedule the alert check (every 15 minutes)

**Vercel Pro**

```bash
npx vercel crons add --path /api/cron/watch --schedule "*/15 * * * *"
npx vercel deploy --prod
```

**Vercel Hobby (free).** Hobby cron jobs run at most once a day, and a 15-minute schedule makes
the deploy fail, so let GitHub call the check instead:

1. Copy `docs/github-actions-alerts.yml` to `.github/workflows/alerts.yml` in your fork and push.
2. In your GitHub repository: Settings → Secrets and variables → Actions.
   - Variables tab: `SITE_URL` = your site URL.
   - Secrets tab: `CRON_SECRET` = the value from your `.env.local`.
3. Actions tab → **Alert check** → **Run workflow** once to confirm it shows status 200.

GitHub can run scheduled jobs a few minutes late and pauses them after 60 days without commits;
re-enable from the Actions tab if that happens.

## 6. Connect Claude or ChatGPT (optional)

Open **Ask Claude or ChatGPT** at the bottom of the site and follow the steps there. See
[AI-CONNECTOR.md](AI-CONNECTOR.md).

## Updating

```bash
git pull
npm install
npm test
npx vercel deploy --prod
```

Or connect the GitHub repository in Vercel (Settings → Git) to deploy on every push.

## Changing a setting later

Edit `.env.local`, run `npm run push-env -- --force`, then `npx vercel deploy --prod`. Environment
changes only take effect on a new deployment.
