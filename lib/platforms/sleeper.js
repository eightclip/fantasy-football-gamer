// Sleeper adapter. Everything Sleeper-specific lives here; the rest of the app sees the shared
// shapes documented in lib/source.js. Sleeper's API is public and needs no key.

import { cached, json } from '../http.js';
import { config } from '../config.js';
import { score, startingSlots } from '../math.js';
import { idMaps, nflState } from '../nfl.js';

const FANTASY = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const api = path => json(`https://api.sleeper.app/v1${path}`);
const positions = FANTASY.map(p => `position[]=${p}`).join('&');

export function createSleeper() {
  const L = config.leagueId;
  const rawLeague = () => cached(`sl:league:${L}`, 3600, () => api(`/league/${L}`));
  const season = async () => (await nflState()).season;

  const myUserId = () => (config.sleeperUserId
    ? Promise.resolve(String(config.sleeperUserId))
    : cached(`sl:user:${config.sleeperUsername}`, 86400, async () => {
      const u = await api(`/user/${encodeURIComponent(config.sleeperUsername)}`);
      if (!u?.user_id) throw new Error(`No Sleeper user named "${config.sleeperUsername}". Check SLEEPER_USERNAME.`);
      return u.user_id;
    }));

  return {
    name: 'sleeper',

    async league() {
      const lg = await rawLeague();
      if (!lg) throw new Error(`No Sleeper league with id ${L}. Check LEAGUE_ID.`);
      const s = lg.settings || {};
      return {
        name: lg.name,
        slots: startingSlots(lg.roster_positions || []),
        playoffTeams: s.playoff_teams || 6,
        playoffStart: s.playoff_week_start || 15,
        tradeDeadline: s.trade_deadline || null,
        waiverClearDays: s.waiver_clear_days ?? 2,
        rules: lg.scoring_settings || {},
      };
    },

    async teams() {
      const [users, rosters, me] = await Promise.all([
        cached(`sl:users:${L}`, 3600, () => api(`/league/${L}/users`)),
        cached(`sl:rosters:${L}`, 120, () => api(`/league/${L}/rosters`)),
        myUserId(),
      ]);
      return rosters.map(r => {
        const u = users.find(x => x.user_id === r.owner_id);
        const s = r.settings || {};
        return {
          id: r.roster_id,
          name: u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`,
          owner: u?.display_name || '',
          isMine: r.owner_id === me,
          wins: s.wins || 0, losses: s.losses || 0, ties: s.ties || 0,
          pf: (s.fpts || 0) + (s.fpts_decimal || 0) / 100,
          pa: (s.fpts_against || 0) + (s.fpts_against_decimal || 0) / 100,
          players: (r.players || []).map(String),
          starters: (r.starters || []).map(String),
          waiverPosition: s.waiver_position ?? null,
        };
      });
    },

    async matchups(week) {
      const rows = await cached(`sl:matchups:${L}:${week}`, 60, () => api(`/league/${L}/matchups/${week}`));
      return (rows || []).map(m => ({
        teamId: m.roster_id, matchupId: m.matchup_id, points: m.points || 0,
        starters: (m.starters || []).map(String), playerPoints: m.players_points || {},
      }));
    },

    // Sleeper asks for this 5MB+ dictionary at most once a day. Keep only what the app uses.
    players: () => cached('sl:players', 86400, async () => {
      const all = await api('/players/nfl');
      const slim = {};
      for (const [id, p] of Object.entries(all)) {
        if (!FANTASY.includes(p.position) || !(p.team || p.active)) continue;
        const name = p.position === 'DEF' ? `${p.first_name} ${p.last_name}`.trim() : p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim();
        slim[id] = { name, pos: p.position, team: p.team || null, injury: p.injury_status || null, depth: p.depth_chart_order ?? null };
      }
      return slim;
    }),

    // Projected league points per player for a week, plus the fresher injury tags this feed carries.
    async projections(week) {
      const [yr, lg] = await Promise.all([season(), rawLeague()]);
      return cached(`sl:proj:${yr}:${week}`, week <= (await nflState()).week + 1 ? 900 : 6 * 3600, async () => {
        const rows = await json(`https://api.sleeper.com/projections/nfl/${yr}/${week}?season_type=regular&${positions}&order_by=ppr`);
        const points = {}, injury = {};
        for (const r of rows) {
          const id = String(r.player_id);
          if (r.stats && Object.keys(r.stats).length) {
            const pts = score(r.stats, lg.scoring_settings || {});
            if (pts) points[id] = pts;
          }
          if (r.player) injury[id] = { status: r.player.injury_status || null, body: r.player.injury_body_part || null };
        }
        if (!Object.keys(points).length) throw new Error('projections came back empty');
        return { points, injury };
      });
    },

    // What happened: league points and usage (snaps, targets, carries) per player.
    async weekStats(week, final) {
      const [yr, lg] = await Promise.all([season(), rawLeague()]);
      return cached(`sl:stats:${yr}:${week}`, final ? 43200 : 600, async () => {
        const rows = await json(`https://api.sleeper.com/stats/nfl/${yr}/${week}?season_type=regular&${positions}&order_by=pts_ppr`);
        const out = {};
        for (const r of rows || []) {
          const st = r.stats || {};
          if (!st.gp && !st.off_snp && !st.pts_ppr) continue;
          out[String(r.player_id)] = {
            pts: score(st, lg.scoring_settings || {}), snaps: st.off_snp || 0, teamSnaps: st.tm_off_snp || 0,
            targets: st.rec_tgt || 0, carries: st.rush_att || 0, receptions: st.rec || 0,
          };
        }
        return out;
      });
    },

    // { playerId: droppedAt ms } for completed drops in a week.
    drops: week => cached(`sl:drops:${L}:${week}`, 300, async () => {
      const out = {};
      for (const t of (await api(`/league/${L}/transactions/${week}`)) || []) {
        if (t.status !== 'complete' || !t.drops) continue;
        for (const id of Object.keys(t.drops)) out[id] = Math.max(out[id] || 0, t.status_updated || t.created);
      }
      return out;
    }),

    // How many Sleeper leagues added each player in the last two days.
    trending: () => cached('sl:trending', 3600, async () => {
      const rows = await api('/players/nfl/trending/add?lookback_hours=48&limit=50');
      return Object.fromEntries(rows.map(r => [r.player_id, r.count]));
    }),

    async externalIds() {
      return (await idMaps(await season())).bySleeper;
    },
  };
}
