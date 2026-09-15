// Everything that differs between one person's league and another's comes from environment
// variables. Nothing about a specific league, person or domain is written into the code.
// See .env.example for what each one means.

const env = (name, fallback = undefined) => {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
};

export const config = {
  platform: env('PLATFORM', 'sleeper').toLowerCase(), // 'sleeper' or 'espn'
  leagueId: env('LEAGUE_ID'),
  season: env('SEASON') ? Number(env('SEASON')) : null, // null: follow the NFL calendar

  // Which team is yours.
  sleeperUsername: env('SLEEPER_USERNAME'),
  sleeperUserId: env('SLEEPER_USER_ID'),
  espnTeamId: env('ESPN_TEAM_ID') ? Number(env('ESPN_TEAM_ID')) : null,
  espnS2: env('ESPN_S2'), // private ESPN leagues only
  espnSwid: env('ESPN_SWID'), // private ESPN leagues only

  // How the site talks and tells time.
  managerName: env('MANAGER_NAME'), // e.g. "Alex"; used in AI answers and alerts
  siteName: env('SITE_NAME', 'Fantasy Football Gamer'),
  siteUrl: env('SITE_URL', '').replace(/\/$/, ''), // e.g. https://my-team.vercel.app
  timezone: env('TIMEZONE', 'America/New_York'),
  waiverDay: env('WAIVER_DAY', 'Wednesday'), // when your league's waiver claims finish processing
  waiverHour: Number(env('WAIVER_HOUR', '3')),

  // Optional AI wording for the summary line.
  anthropicKey: env('ANTHROPIC_API_KEY'),
  adviceModel: env('ADVICE_MODEL', 'claude-haiku-4-5'),
  adviceOff: env('ADVICE') === 'off',
};

// "Alex's" / "your" for sentences written about the manager.
export const possessive = () => (config.managerName ? `${config.managerName}'s` : 'your');
export const subject = () => config.managerName || 'You';

export function missingConfig() {
  const missing = [];
  if (!config.leagueId) missing.push('LEAGUE_ID');
  if (config.platform === 'sleeper' && !config.sleeperUsername && !config.sleeperUserId) missing.push('SLEEPER_USERNAME');
  if (config.platform === 'espn' && !config.espnTeamId) missing.push('ESPN_TEAM_ID');
  if (!['sleeper', 'espn'].includes(config.platform)) missing.push('PLATFORM (sleeper or espn)');
  return missing;
}

// Short zone label for messages, e.g. "ET" or "PT".
export function zoneLabel(date = new Date()) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, timeZoneName: 'short' })
    .formatToParts(date).find(p => p.type === 'timeZoneName')?.value || '';
  return part.replace(/^([A-Z])[DS]T$/, '$1T');
}
