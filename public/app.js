// Renders /api/week. All the math happens on the server; this file only decides
// what to say first. The one job: within five seconds she knows whether there is
// anything to do in the fantasy app, and if so, exactly what, in order, and by when.

// What each day of the week is actually for. Copy is final (SPEC.md §6).
const PLAYBOOK = [
  { key: 'Sun', head: 'Game day',
    detail: 'Check injuries one more time before the early games, make any changes below, and they lock at each player\'s kickoff.' },
  { key: 'Mon', head: 'Last game of the week',
    detail: 'Nothing to set unless someone plays tonight. Watch for injuries; tomorrow is for waivers.' },
  { key: 'Tue', head: 'Waiver day',
    detail: 'Look over the pickups below and put in claims before they process.' },
  { key: 'Wed', head: 'Claims are in',
    detail: 'See which claims went through. Players nobody claimed can usually be added right away.' },
  { key: 'Thu', head: 'First game of the week',
    detail: 'Anyone playing tonight locks at kickoff, so settle those spots first.' },
  { key: 'Fri', head: 'Practice reports',
    detail: 'Teams post who practiced this week. A starter who sat out all week is a real risk for Sunday.' },
  { key: 'Sat', head: 'Set it early',
    detail: 'Put in tomorrow\'s lineup now. You can still change it before each game starts.' },
];

// Filled in from /api/week: which fantasy app the league lives on, and the site's name.
let APP = { name: 'your fantasy app', url: null };
let SITE = 'Fantasy Football Gamer';


const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n1 = x => (Number(x) || 0).toFixed(1);
const pct = p => `${Math.round(p * 100)}%`;
const bigCount = c => (c >= 1000 ? `${Math.round(c / 1000)}k` : String(c));
const slotName = s => String(s || '').replace('_', ' ');
const joinNames = list => {
  const names = list.map(p => p.name);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};
const plural = (n, one, many) => (n === 1 ? one : many);

// "10am today", "5:15pm Monday": her phone's clock, never a time zone name.
function whenText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const h = d.getHours(), m = d.getMinutes();
  const t = `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`;
  const day0 = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((day0(d) - day0(new Date())) / 864e5);
  const day = diff === 0 ? 'today' : diff === 1 ? 'tomorrow'
    : Math.abs(diff) < 7 ? d.toLocaleDateString(undefined, { weekday: 'long' })
    : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${t} ${day}`;
}
const earliest = list => list.filter(Boolean).sort()[0] || null;

// ---- what to do, as steps ----------------------------------------------------

// Lineup changes, straight from the solved lineup: every spot whose player is not
// the one set in the app right now. A locked player can never be a step.
function lineupSteps(w) {
  if (!w.projectionsOk) return [];
  const steps = [];
  // A spot locks when whoever is in it now kicks off, and we do not know which spot
  // holds which benched player, so every change is due by the earliest of them.
  const sit = (w.swaps?.sit || []).filter(p => !p.locked);
  const sitLock = earliest(sit.map(p => p.kickoff));
  for (const r of w.optimal) {
    if (!r.name) {
      steps.push({ kind: 'fill', slot: r.slot, lockAt: null });
    } else if (!r.starting && !r.locked) {
      steps.push({ kind: 'start', slot: r.slot, p: r, lockAt: earliest([r.kickoff, sitLock]) });
    }
  }
  if (sit.length && steps.some(s => s.kind === 'start')) {
    steps.push({ kind: 'bench', check: true, players: sit, lockAt: sitLock });
  }
  return steps;
}

// Free agents can be added instantly; players on waivers need a claim and wait for the run.
function claimText(p) {
  if (!p.claim) return '';
  return p.claim.free ? 'free now, add instantly' : `on waivers, put in a claim (goes through ${whenText(p.claim.until)})`;
}
function winText(p) {
  const n = Math.round((p.winGain || 0) * 100);
  return n >= 1 ? `raises your chance this week by ${n} ${n === 1 ? 'point' : 'points'}` : '';
}

function pickupSteps(w) {
  // Pickups are alternatives. As steps to do together, never drop the same player twice.
  const dropped = new Set(), added = new Set();
  return (w.pickups || []).filter(p => {
    if (dropped.has(p.dropId) || added.has(p.id)) return false;
    dropped.add(p.dropId); added.add(p.id);
    return true;
  }).map(p => ({ kind: 'add', p, lockAt: null }));
}

// Decisions the server raised that do not turn into a step: a hurt starter who is
// still the best option. Worth a sentence, not a number.
function watchItems(w, stepIds) {
  return (w.decisions || []).filter(d =>
    d.kind === 'injury' && !d.ids.some(id => stepIds.has(id)));
}

function stepHtml(s, i, headLock) {
  const lock = s.lockAt && s.lockAt !== headLock ? `<span class="lock">locks ${esc(whenText(s.lockAt))}</span>` : '';
  const sep = ' &middot; ';
  let body = '';
  if (s.kind === 'start') {
    const bits = [s.p.pos, s.p.team || 'Free agent'].map(esc);
    if (s.p.injury) bits.push(`<span class="hurt">${esc(s.p.injury)}</span>`);
    body = `<div class="act"><span class="v in">Start</span> ${esc(s.p.name)}</div>
      <div><span class="spot">${esc(slotName(s.slot))} spot</span></div>
      <div class="meta">${bits.join(sep)}${lock ? sep + lock : ''}</div>`;
  } else if (s.kind === 'bench') {
    body = `<div class="act"><span class="v out">Bench</span> ${esc(joinNames(s.players))}</div>
      <div class="meta">${plural(s.players.length, 'Should be', 'They should be')} on the bench when you are done.${lock ? sep + lock : ''}</div>`;
  } else if (s.kind === 'fill') {
    body = `<div class="act"><span class="v out">Fill</span> the ${esc(slotName(s.slot))} spot</div>
      <div class="meta">Nobody on your roster can play there. Pick someone up from the list under Still available, then start them. An empty spot scores zero.</div>`;
  } else if (s.kind === 'add') {
    const p = s.p;
    const bits = [p.pos, p.team || 'Free agent'].map(esc);
    bits.push(`worth about ${n1(p.gain)} points over two weeks`);
    if (winText(p)) bits.push(esc(winText(p)));
    if (claimText(p)) bits.push(esc(claimText(p)));
    if (p.locked) bits.push('already played, so this is for next week');
    if (p.trending) bits.push(`added in ${bigCount(p.trending)} leagues this week`);
    body = `<div class="act"><span class="v in">Add</span> ${esc(p.name)}</div>
      <div class="act"><span class="v out">Drop</span> ${esc(p.dropName)}</div>
      <div class="meta">${bits.join(sep)}</div>`;
  }
  const num = s.check ? `<span class="num check" aria-hidden="true">&#10003;</span>` : `<span class="num" aria-hidden="true">${i + 1}</span>`;
  return `<li class="step">${num}<div class="what">${body}</div></li>`;
}

// ---- the lead block ------------------------------------------------------------

function paintLead({ title, lines = [], steps = [], watch = [], howto = '', calm = false, error = false }) {
  const h1 = `<h1 id="directive" class="fade${calm ? ' calm' : ''}">${esc(title)}</h1>`;
  const ps = lines.map(l => `<p class="lead-line${l.quiet ? ' quiet' : ''}">${l.html}</p>`).join('');
  const headLock = earliest(steps.map(s => s.lockAt));
  const ol = steps.length ? `<ol class="steps">${steps.map((s, i) => stepHtml(s, i, headLock)).join('')}</ol>` : '';
  const how = howto && steps.length ? `<p class="howto">${howto}</p>` : '';
  const ws = watch.map(d => `<div class="watch"><b>${esc(d.headline)}.</b> ${esc(d.text)}
    ${d.lockAt ? `<div class="meta">Locks ${esc(whenText(d.lockAt))}.</div>` : ''}</div>`).join('');
  const btn = error ? '' : `<div class="lead-actions">
    <a class="btn big${steps.length ? '' : ' quiet'}" href="${esc(APP.url || '#')}" target="_blank" rel="noopener">Open ${esc(APP.name)}</a>
  </div>`;
  $('lead').innerHTML = h1 + ps + ol + how + ws + btn;
}

function leadFor(w, todayKey) {
  const m = w.matchup;
  const lineup = lineupSteps(w);
  const picks = pickupSteps(w);
  const waiverDay = todayKey === 'Tue' || todayKey === 'Wed';
  const bigPick = picks.length && (picks[0].p.gain >= 3 || (picks[0].p.claim?.free && picks[0].p.winGain >= 0.03));

  // Order the steps the way the day wants them: waivers first on Tue/Wed, lineup first otherwise.
  let steps = [];
  if (waiverDay) steps = [...picks, ...lineup];
  else steps = [...lineup, ...(bigPick ? picks : [])];

  const stepIds = new Set(steps.flatMap(s => s.kind === 'bench' ? s.players.map(p => p.id) : s.p ? [s.p.id] : []));
  const watch = watchItems(w, stepIds);
  const reasons = (w.decisions || [])
    .filter(d => ['injury', 'bye', 'empty'].includes(d.kind) && !watch.includes(d))
    .map(d => esc(d.headline));

  const oddsLine = () => {
    if (m?.status === 'final') return `You ${m.you > m.them ? 'beat' : m.you < m.them ? 'lost to' : 'tied'} ${esc(m.opponent)}, ${n1(m.you)} to ${n1(m.them)}.`;
    if (m?.winProbability != null) return `<b>${pct(m.winProbability)}</b> chance you beat ${esc(m.opponent)} this week.`;
    return '';
  };

  if (!w.projectionsOk) {
    return {
      title: 'Projections are down', calm: true,
      lines: [
        { html: `The projection feed did not respond, so the numbers below are not trustworthy and this page cannot check your lineup. Rosters, injuries and the score are still accurate.` },
        { html: `Check back in a few minutes. If it is game day, open ${esc(APP.name)} and make sure nobody Out or on bye is starting.`, quiet: true },
      ],
    };
  }

  if (steps.length) {
    const nLineup = lineup.filter(s => !s.check).length, nPick = picks.length;
    const lockAt = earliest(steps.map(s => s.lockAt));
    let title, howto;
    const pickupsFirst = nPick && (waiverDay || !nLineup);
    if (pickupsFirst) {
      title = `${nPick === 1 ? 'One player' : `${nPick} players`} to pick up`;
      howto = `In ${esc(APP.name)}: find the player, add him, then choose who to drop.`;
    } else {
      title = `${nLineup === 1 ? 'One change' : `${nLineup} changes`} to make`;
      howto = `In ${esc(APP.name)}: open your team, tap the spot, then choose the player.`;
    }
    const lines = [];
    let first = reasons.length ? `<span class="why">${reasons.join('. ')}.</span> ` : '';
    if (pickupsFirst) {
      const top = picks[0].p;
      first += top.claim?.free
        ? `${nPick === 1 ? 'He is' : 'They are'} free right now, so <span class="by">add ${nPick === 1 ? 'him' : 'them'} today</span> before someone else does.`
        : todayKey === 'Tue'
        ? `Put in your claims <span class="by">today</span>, before everyone else does.`
        : todayKey === 'Wed' || top.claim?.free !== false
          ? `Free agency is first come, first served, so <span class="by">do it now</span>.`
          : `Put in a claim <span class="by">now</span>. It goes through ${esc(whenText(top.claim.until))}.`;
      if (nLineup) first += ` Then fix your lineup, it locks ${esc(whenText(earliest(lineup.map(s => s.lockAt))))}.`;
    } else {
      first += lockAt
        ? `Do this in ${esc(APP.name)} <span class="by">before ${esc(whenText(lockAt))}</span>.`
        : `Do this in ${esc(APP.name)} <span class="by">now</span>.`;
    }
    lines.push({ html: first });
    if (m?.winProbability != null && m.winProbabilityWithSwaps > m.winProbability + 0.005) {
      lines.push({ html: `Your chance of winning goes from ${pct(m.winProbability)} to <b>${pct(m.winProbabilityWithSwaps)}</b>.`, quiet: true });
    } else if (w.swaps?.worth > 0.05 && nLineup) {
      lines.push({ html: `Worth about ${n1(w.swaps.worth)} points this week.`, quiet: true });
    }
    return { title, lines, steps, howto, watch };
  }

  // Nothing to change. Say so, loudly and calmly.
  const lines = [];
  const odds = oddsLine();
  if (watch.length) {
    lines.push({ html: `Your lineup is set. ${odds}` });
    return { title: 'Nothing to change yet', calm: true, lines, watch };
  }
  if (m?.status === 'final') {
    lines.push({ html: `${odds} ${w.nextMatchup ? `Next week's lineup is already right.` : 'Your lineup is already right.'}` });
    if (w.nextMatchup) {
      const n = w.nextMatchup;
      lines.push({ html: `Week ${esc(n.week)} against ${esc(n.opponent)}: <b>${pct(n.winProbability)}</b> chance you win as things stand.`, quiet: true });
    }
    return { title: m.you > m.them ? 'You won. Nothing to change' : 'Nothing to change', calm: true, lines };
  }
  lines.push({ html: `Your lineup is set. ${odds || 'Nothing on your bench or the wire beats who you have starting.'}` });
  if (picks.length) lines.push({ html: `One small pickup is worth a look below, but it can wait.`, quiet: true });
  return { title: 'Nothing to change', calm: true, lines };
}

// Haiku's one-sentence version of the lead, when the server has a key. It arrives after
// the page is up and replaces the rule-written line; if it never comes, nothing changes.
async function addNote() {
  try {
    const res = await fetch('/api/advice', { credentials: 'same-origin' });
    if (!res.ok) return;
    const { advice } = await res.json();
    if (!advice?.body || advice.by === 'rules') return;
    const first = $('lead')?.querySelector('.lead-line:not(.quiet)');
    if (!first) return;
    const note = document.createElement('p');
    note.className = 'lead-line';
    note.textContent = advice.body;
    first.replaceWith(note);
    // The sentence already carries the odds or points, so drop the quiet line that repeats them.
    if (/%|point/.test(advice.body)) {
      $('lead').querySelectorAll('.lead-line.quiet').forEach(q => { if (/%|points/.test(q.textContent)) q.remove(); });
    }
  } catch { /* keep the rule-written line */ }
}

// ---- the rest of the page -------------------------------------------------------

function playerLine(p, extra = '') {
  const hurt = p.injury ? ` <span class="hurt">${esc(p.injury)}</span>` : '';
  const bits = [p.pos, p.team || 'Free agent'];
  if (p.bye) bits.push('on bye');
  if (p.locked) bits.push('game started');
  return `<b>${esc(p.name)}</b>${hurt}<div class="meta">${bits.map(esc).join(' &middot; ')}${extra}</div>`;
}

function move(verb, cls, p, right, extra) {
  return `<div class="move">
    <span class="verb ${cls}">${esc(verb)}</span>
    <span class="who">${playerLine(p, extra)}</span>
    <span class="pts">${right}</span>
  </div>`;
}

function fold(title, count, inner, { open = false, hot = false } = {}) {
  const c = count != null ? ` <span class="count${hot ? ' hot' : ''}">${esc(count)}</span>` : '';
  return `<details${open ? ' open' : ''}><summary>${esc(title)}${c}</summary><div class="body">${inner}</div></details>`;
}

function playbookHtml(todayIdx) {
  const strip = PLAYBOOK.map((d, i) => `
    <button class="day" type="button" data-i="${i}" aria-current="${i === todayIdx}" aria-pressed="${i === todayIdx}">${d.key}</button>`).join('');
  return `<section class="playbook">
    <h2>This week</h2>
    <p class="sub">What each day is for.</p>
    <nav class="week" id="week" aria-label="Days of the week">${strip}</nav>
    <div id="playbookCopy"><p class="head" id="pbHead"></p><p class="detail" id="pbDetail"></p></div>
  </section>`;
}

function paintDay(i) {
  const d = PLAYBOOK[i];
  if (!d) return;
  $('pbHead').textContent = d.head;
  $('pbDetail').textContent = d.detail;
  const copy = $('playbookCopy');
  copy.classList.remove('fade');
  void copy.offsetWidth;
  copy.classList.add('fade');
}

// The opponent has a better player sitting on their bench. Plan as if they notice.
function benchWarning(m) {
  const b = m?.opponentBench;
  if (!b || m.winProbabilityIfTheyFix == null) return '';
  return `<p class="odds">If they start ${esc(b.start.join(' and '))} over ${esc(b.sit.join(' and '))}, they gain about
    ${n1(b.gain)} points and your chance becomes <b>${pct(m.winProbabilityIfTheyFix)}</b>. The advice on this page already plans for that.</p>`;
}

function matchupHtml(w) {
  const m = w.matchup;
  const next = w.nextMatchup;
  let html = '';
  if (m) {
    const label = { live: '<span class="live">Live</span>', final: 'Final', upcoming: 'Kicks off this week' }[m.status] || '';
    const lead = m.you === m.them ? '' : m.you > m.them ? 'you' : 'them';
    html += `<section>
      <h2>Week ${esc(m.week)} against ${esc(m.opponent)}</h2>
      <p class="sub">${label} &middot; they are ${esc(m.opponentRecord)}</p>
      <div class="card">
        <div class="score">
          <div class="side ${lead === 'you' ? 'ahead' : ''}"><span class="n">${n1(m.you)}</span><span class="who2">You</span></div>
          <div class="vs">to</div>
          <div class="side ${lead === 'them' ? 'ahead' : ''}"><span class="n">${n1(m.them)}</span><span class="who2">${esc(m.opponent)}</span></div>
        </div>`;
    if (m.winProbability != null) {
      const better = m.winProbabilityWithSwaps > m.winProbability + 0.005
        ? ` Make the changes above and it goes to <b>${pct(m.winProbabilityWithSwaps)}</b>.` : '';
      html += `<p class="odds"><b>${pct(m.winProbability)}</b> chance you win. Projected to finish
        ${n1(m.youProjected)} to ${n1(m.themProjected)}.${better}</p>`;
    }
    html += benchWarning(m);
    html += `</div></section>`;
  }
  if (next) {
    html += `<section>
      <h2>Next up: ${esc(next.opponent)}</h2>
      <p class="sub">Week ${esc(next.week)} &middot; they are ${esc(next.opponentRecord)}</p>
      <p class="odds"><b>${pct(next.winProbability)}</b> chance you win with the lineup below.
        Projected ${n1(next.youProjected)} to ${n1(next.themProjected)}.</p>
      ${benchWarning(next)}
    </section>`;
  }
  return html;
}

function lineupHtml(w) {
  const ok = w.projectionsOk;
  const rows = w.optimal;
  const changes = ok ? rows.filter(r => r.name && !r.starting && !r.locked).length : 0;
  const holes = rows.filter(r => !r.name).length;
  const sub = !ok ? 'Projections are down, so this is your roster by position, not a recommendation.'
    : changes ? `${rows.length - changes - holes} of ${rows.length} spots already match your app. The lit ${plural(changes, 'one needs', 'ones need')} changing.`
    : holes ? 'Every spot you can fill matches your app.'
    : 'Every spot matches what is set in your app right now.';

  let html = `<section>
    <h2>Your lineup</h2>
    <p class="sub">${sub}</p>
    <ul class="lineup">`;
  for (const r of rows) {
    const cls = !r.name ? 'hole' : ok && !r.starting && !r.locked ? 'change' : r.locked ? 'locked' : 'set';
    const tag = !r.name ? 'empty' : r.locked ? 'locked' : ok && !r.starting ? 'put in' : 'set';
    const bits = [];
    if (r.name) {
      bits.push(esc(r.pos), esc(r.team || 'Free agent'));
      if (r.injury) bits.push(`<span class="hurt">${esc(r.injury)}</span>`);
      if (r.practice && r.practice !== 'Full') bits.push(esc(r.practice === 'DNP' ? 'missed practice' : `${r.practice.toLowerCase()} practice`));
      if (r.bye) bits.push('<span class="hurt">on bye</span>');
      if (!r.locked && !r.starting && r.kickoff && ok) bits.push(`plays ${esc(whenText(r.kickoff))}`);
    }
    html += `<li class="row ${cls}">
      <span class="slot">${esc(slotName(r.slot))}</span>
      <span><span class="name">${r.name ? esc(r.name) : 'Nobody eligible'}</span><div class="meta">${bits.join(' &middot; ')}</div></span>
      <span class="right"><span class="pts num-t">${r.name && ok ? n1(r.pts) : '—'}</span><span class="tag">${tag}</span></span>
    </li>`;
  }
  html += `</ul>`;
  if (ok) {
    html += `<div class="totals">
      <div class="stat"><span class="n">${n1(w.totals.best)}</span><span class="l">Best possible</span></div>
      <div class="stat"><span class="n">${n1(w.totals.current)}</span><span class="l">Set right now</span></div>
      <div class="stat gain"><span class="n">${w.totals.onTheTable > 0 ? '+' : ''}${n1(w.totals.onTheTable)}</span><span class="l">On the table</span></div>
    </div>`;
  }
  return html + `</section>`;
}

function oddsPlayHtml(o) {
  if (!o) return '';
  return `<section>
    <h2>Optional: ${o.underdog ? 'play for the upset' : 'play it safe'}</h2>
    <p class="sub">Not required. Raises your chance of winning from ${pct(o.from)} to <b>${pct(o.probability)}</b>,
      for about ${n1(o.pointsCost)} fewer projected points. ${o.underdog
        ? 'When you are behind, a player who could go off beats a steady one.'
        : 'When you are ahead, a steady player protects the lead.'}</p>
    ${o.start.map(p => move('Start', 'in', p, n1(p.pts))).join('')}
    ${o.sit.map(p => move('Sit', 'out', p, n1(p.pts))).join('')}
  </section>`;
}

function render(w, todayIdx, todayKey) {
  paintLead(leadFor(w, todayKey));
  if (w.projectionsOk) addNote();

  let html = '';
  if (!w.liveOk) {
    html += `<div class="note bad"><b>Game status did not load.</b> Which games have started is unknown,
      so the page may suggest moving a player who is already locked. If the app will not let you move someone, that is why.</div>`;
  }
  html += playbookHtml(todayIdx);
  html += matchupHtml(w);
  html += lineupHtml(w);
  html += oddsPlayHtml(w.oddsPlay);
  html += `<div id="alerts"></div>`;

  // ---- the quiet part: collapsed, scannable ----
  const waiverDay = todayKey === 'Tue' || todayKey === 'Wed';
  const pickupsLead = w.pickups.length && (waiverDay || w.pickups[0].gain >= 3 || (w.pickups[0].claim?.free && w.pickups[0].winGain >= 0.03));
  if (w.pickups.length && !pickupsLead) {
    html += fold('Worth picking up', w.pickups.length,
      `<p class="sub">Each one makes your best lineup better over the next two weeks, counting who you would drop. Not urgent.${
        w.waiverPosition ? ` You are #${esc(w.waiverPosition)} of ${esc(w.teams)} in waiver priority.` : ''}</p>` +
      w.pickups.map(p => {
        const trend = p.trending ? ` &middot; added in ${bigCount(p.trending)} leagues this week` : '';
        const when = p.locked ? ' &middot; already played, so this is for next week' : '';
        const extra = [winText(p), claimText(p)].filter(Boolean).map(t => ` &middot; ${esc(t)}`).join('');
        return move('Add', 'in', { ...p, locked: false }, `+${n1(p.gain)}`, `<br>Drop ${esc(p.dropName)}${extra}${when}${trend}`);
      }).join(''));
  }

  if (w.blocks?.length) {
    html += fold(`Keep from ${w.blocks[0].opponent}`, w.blocks.length,
      `<p class="sub">Free players your opponent would start over someone they have. They cost you almost nothing to carry, and taking them first protects your chance of winning.</p>` +
      w.blocks.map(b => move('Grab', 'in', { ...b, locked: false }, `${Math.round(b.protects * 100)}%`,
        `<br>They would gain about ${n1(b.oppGain)} points. Drop ${esc(b.dropName)} &middot; ${esc(claimText(b))}`)).join(''));
  }

  if (w.injuryReport.length) {
    const worst = w.injuryReport[0];
    const hot = w.injuryReport.some(p => p.starting && /^(out|doubtful|ir)/i.test(p.status || ''));
    html += fold('Injury report', `${worst.name} ${worst.status || 'limited'}${w.injuryReport.length > 1 ? ` and ${w.injuryReport.length - 1} more` : ''}`,
      `<p class="sub">Your players only. Your app, ESPN and the official practice report, worst news first.</p>` +
      w.injuryReport.map(p => {
        const practice = p.practice ? ` &middot; practice: ${esc(p.practice === 'DNP' ? 'did not practice' : p.practice.toLowerCase())}` : '';
        const body = p.body ? ` &middot; ${esc(p.body)}` : '';
        const note = p.comment ? `<div class="comment">${esc(p.comment)}</div>` : '';
        return move(p.starting ? 'Starter' : 'Bench', p.starting ? 'out' : '', { ...p, injury: p.status }, '', `${body}${practice}${note}`);
      }).join(''), { hot });
  }

  if (w.handcuffs.length || w.byeGaps.length) {
    html += fold('Looking ahead', w.byeGaps.length ? `${w.byeGaps.length} bye ${plural(w.byeGaps.length, 'gap', 'gaps')}` : `${w.handcuffs.length} ${plural(w.handcuffs.length, 'backup', 'backups')} free`,
      `<p class="sub">Cheap insurance, handled before anyone else notices.</p>` +
      w.byeGaps.map(g => `<div class="note"><b>Week ${esc(g.week)}: nobody to start at ${esc(g.empty.join(', '))}.</b>
        On bye: ${esc(g.onBye.join(', '))}. Pick up a fill-in the week before.</div>`).join('') +
      w.handcuffs.map(h => move('Backup', '', { name: h.backup, pos: 'RB', team: h.team }, '',
        `<br>Backs up your ${esc(h.starter)}. Free right now.`)).join(''), { hot: w.byeGaps.length > 0 });
  }

  html += fold('Still available', w.freeAgents.length ? `top ${w.freeAgents.length}` : null,
    `<p class="sub">${w.freeAgents.length
      ? 'Best projected players nobody in the league owns. Add means he beats one of your starters this week.'
      : 'The free agent list could not load.'}</p>` +
    w.freeAgents.map(p => {
      const trend = p.trending ? ` &middot; added in ${bigCount(p.trending)} leagues` : '';
      return move(p.beatsWorstStarter ? 'Add' : '', p.beatsWorstStarter ? 'in' : '', p, n1(p.pts), trend);
    }).join(''));

  html += fold('The rest of your bench', w.bench.length,
    w.bench.map(p => move('', '', p, w.projectionsOk ? n1(p.pts) : '—')).join(''));

  html += `<div id="league"></div>`;
  html += fold('Ask Claude or ChatGPT', null, `<div id="askAi">${askAiHtml()}</div>`);

  $('body').innerHTML = html;

  $('week').addEventListener('click', e => {
    const btn = e.target.closest('.day');
    if (!btn) return;
    [...$('week').children].forEach(c => c.setAttribute('aria-pressed', c === btn));
    paintDay(+btn.dataset.i);
  });
  paintDay(todayIdx);
}

async function run() {
  const localKey = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'America/Los_Angeles' }).format(new Date());

  let w;
  try {
    const res = await fetch('/api/week', { credentials: 'same-origin' });
    if (res.status === 401) { location.reload(); return; }
    w = await res.json();
    if (!res.ok) throw new Error(w.error || `The server returned ${res.status}`);
  } catch (err) {
    paintLead({
      title: 'Could not load your week', calm: true, error: true,
      lines: [{ html: `${esc(err.message)}. Check your connection, then reload.` },
        { html: `${esc(APP.name)} itself still works${APP.url ? `: <a href="${esc(APP.url)}" target="_blank" rel="noopener">open it here</a>` : ''}.`, quiet: true }],
    });
    return;
  }

  // The server's weekday (in the league's time zone) is the one the alerts use; fall back to the phone's.
  const todayKey = PLAYBOOK.some(d => d.key === w.dayKey) ? w.dayKey : localKey;
  const todayIdx = Math.max(0, PLAYBOOK.findIndex(d => d.key === todayKey));

  APP = { name: w.platformName || APP.name, url: w.appUrl || null };
  SITE = w.siteName || SITE;
  document.title = SITE;
  $('leagueName').textContent = w.league || 'Your league';
  $('todayLine').textContent = `Week ${w.week} · ${w.record}`;
  $('stamp').textContent = ` Updated ${new Date(w.generatedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}.`;
  render(w, todayIdx, todayKey);
  setUpAlerts();
  setUpAskAi();
  loadLeague();
}

// ---- the league: standings, trades, news, usage -------------------------------

const agoText = iso => {
  if (!iso) return '';
  const h = Math.round((Date.now() - new Date(iso)) / 3600e3);
  return h < 1 ? 'just now' : h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
};

function leagueHtml(L) {
  let html = '';
  const me = L.standings.find(t => t.isMine);

  if (L.standings.length) {
    const summary = me ? `you are ${ordinal(me.rank)}${me.playoffs != null ? `, ${pct(me.playoffs)} playoffs` : ''}` : null;
    html += fold('Standings and playoff odds', summary,
      `<p class="sub">The top 6 make the playoffs in week ${esc(L.playoffStart)}; the top 2 get a bye. Odds come from playing out the rest of the season thousands of times with each team's best projected lineup.</p>
      <div class="scroll"><table class="standings"><thead><tr><th>Team</th><th>Record</th><th>Playoffs</th><th>Bye</th></tr></thead><tbody>` +
      L.standings.map(t => `<tr class="${t.isMine ? 'mine' : ''}">
        <td><span class="rank">${esc(t.rank)}</span> ${esc(t.name)}${t.isMine ? ' <span class="you">you</span>' : ''}<div class="meta">${n1(t.pf)} points for</div></td>
        <td class="num">${esc(t.record)}</td>
        <td class="num">${t.playoffs != null ? pct(t.playoffs) : '—'}</td>
        <td class="num">${t.bye != null ? pct(t.bye) : '—'}</td>
      </tr>`).join('') + `</tbody></table></div>`);
  }

  if (!L.tradesOpen) {
    html += fold('Trade ideas', 'deadline passed', `<p class="sub">The trade deadline (week ${esc(L.deadline)}) has passed.</p>`);
  } else if (L.trades.length) {
    const names = list => list.map(p => `${esc(p.name)} <span class="meta-inline">${esc(p.pos)}</span>`).join(' and ');
    html += fold('Trade ideas', L.trades.length,
      `<p class="sub">Trades that make your best lineup stronger for the rest of the season, playoff weeks counted extra, without hurting the other team. Those are the offers people accept. Send them in your app.${L.deadline ? ` Deadline: week ${esc(L.deadline)}.` : ''}</p>` +
      L.trades.map(t => `<div class="move trade">
        <span class="verb in">+${n1(t.forMe)}</span>
        <span class="who"><div><span class="v out">Give</span> ${names(t.give)}</div><div><span class="v in">Get</span> ${names(t.get)}</div>
          <div class="meta">From ${esc(t.partner)} &middot; ${n1(t.playoffGainForMe)} of it in the playoff weeks &middot; they gain ${n1(t.forThem)} &middot; value is ${esc(t.fairness)}</div></span>
      </div>`).join(''));
  }

  const mine = L.news?.mine || [];
  html += fold('News on your players', mine.length || 'nothing new',
    mine.length
      ? `<p class="sub">From RotoWire and RotoBaller, newest first.</p>` + mine.map(n => `<div class="news">
          <b>${esc(n.player)}</b> <span class="meta-inline">${esc([n.source, agoText(n.published)].filter(Boolean).join(' · '))}</span>
          <div>${esc(n.title)}</div>
          ${/^https:\/\//.test(n.link || '') ? `<a class="meta" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">Read more</a>` : ''}
        </div>`).join('')
      : `<p class="sub">No recent headlines about your players. Quiet is usually good.</p>`);

  if (L.trends?.length) {
    const label = { up: 'Getting more work', down: 'Getting less work', steady: 'Steady role' };
    html += fold('How your players are being used', L.trends.filter(p => p.trend.direction === 'down').length ? 'someone is slipping' : null,
      `<p class="sub">Targets and carries repeat week to week; touchdowns do not. A shrinking role is the earliest sign to bench or drop someone.</p>` +
      [...L.trends].sort((a, b) => ({ down: 0, up: 1, steady: 2 }[a.trend.direction] ?? 3) - ({ down: 0, up: 1, steady: 2 }[b.trend.direction] ?? 3))
        .map(p => move(label[p.trend.direction] ? (p.trend.direction === 'down' ? 'Less' : p.trend.direction === 'up' ? 'More' : '') : '',
          p.trend.direction === 'down' ? 'out' : p.trend.direction === 'up' ? 'in' : '',
          { name: p.name, pos: p.pos, team: p.team }, n1(p.trend.ptsPerGame),
          ` &middot; ${n1(p.trend.opportunitiesPerGame)} targets + carries a game &middot; ${Math.round(p.trend.snapShare * 100)}% of snaps${label[p.trend.direction] ? ` &middot; ${label[p.trend.direction].toLowerCase()}` : ''}`)).join(''));
  }
  return html;
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

async function loadLeague() {
  const box = $('league');
  if (!box) return;
  try {
    const res = await fetch('/api/league', { credentials: 'same-origin' });
    if (!res.ok) return;
    box.innerHTML = leagueHtml(await res.json());
  } catch { /* the rest of the page stands on its own */ }
}

// ---- ask Claude or ChatGPT -----------------------------------------------

const ASK_PROMPTS = [
  'How am I doing in fantasy this week?',
  'What do I need to change in my lineup right now?',
  'Anyone worth picking up, and who would I drop?',
  'Any injuries I should worry about?',
];

function copyRow(label, value, id) {
  return `<div class="copyrow"><div class="copyval" id="${id}">${esc(value)}</div>
    <button class="btn quiet" type="button" data-copy="${id}">${esc(label)}</button></div>`;
}

function askAiHtml() {
  return `
    <p class="sub">Connect it once and you can ask from any chat, at work or on your phone.
      It can only read your league. It cannot change anything in your league.</p>

    <h3 class="askh">1. Copy your connection link</h3>
    <div id="mcpLink"><p class="comment">Loading your link…</p></div>
    <p class="comment">Keep it to yourself. Anyone with it can see what this page shows.</p>

    <h3 class="askh">2a. Add it to Claude</h3>
    <ol class="howlist">
      <li>On claude.ai, open Settings, then Connectors (on some plans it is under Customize).</li>
      <li>Choose Add custom connector. Name it ${esc(SITE)} and paste the link.</li>
      <li>Leave the OAuth fields empty and tap Add.</li>
      <li>In a new chat, turn on ${esc(SITE)} from the tools menu, then ask away.</li>
    </ol>

    <h3 class="askh">2b. Or add it to ChatGPT</h3>
    <ol class="howlist">
      <li>On chatgpt.com, open Settings, then Apps. Under Advanced settings, turn on Developer mode.</li>
      <li>Choose Create. Name it ${esc(SITE)}, paste the link, and set authentication to No authentication.</li>
      <li>In a new chat, pick ${esc(SITE)} from the tools menu. Needs a Plus or Pro plan, and work accounts may block it.</li>
    </ol>

    <h3 class="askh">3. Try asking</h3>
    ${ASK_PROMPTS.map((q, i) => copyRow('Copy', q, `askPrompt${i}`)).join('')}

    <h3 class="askh">No setup? Copy your week instead</h3>
    <p class="sub">Copies everything on this page as text. Paste it into any AI chat and ask your question underneath.
      It is a snapshot, so copy it again later for fresh numbers.</p>
    <p><button class="btn quiet" type="button" id="copySnapshot">Copy my week</button></p>`;
}

async function copyText(text, btn) {
  const was = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied';
  } catch {
    btn.textContent = 'Press and hold to copy';
  }
  setTimeout(() => { btn.textContent = was; }, 2000);
}

async function setUpAskAi() {
  const root = $('askAi');
  if (!root) return;
  root.addEventListener('click', e => {
    const btn = e.target.closest('[data-copy]');
    if (btn) copyText($(btn.dataset.copy).textContent, btn);
  });

  // Fetched ahead of the tap: iPhones only allow copying straight from the tap itself.
  let snapshot = null;
  fetch('/api/connect?snapshot=1', { credentials: 'same-origin' })
    .then(r => (r.ok ? r.text() : null)).then(t => { snapshot = t; }).catch(() => {});
  $('copySnapshot').onclick = e => (snapshot
    ? copyText(snapshot, e.currentTarget)
    : (e.currentTarget.textContent = 'Still loading, try again in a moment'));

  try {
    const res = await fetch('/api/connect', { credentials: 'same-origin' });
    const { mcpUrl } = await res.json();
    $('mcpLink').innerHTML = mcpUrl
      ? copyRow('Copy link', mcpUrl, 'mcpUrl')
      : '<p class="comment">The connection link is not set up on the server yet.</p>';
  } catch {
    $('mcpLink').innerHTML = '<p class="comment">Could not load your link. Reload the page to try again.</p>';
  }
}

// ---- alerts on this phone ----------------------------------------------

const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
const installed = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function keyBytes(base64) {
  const pad = '='.repeat((4 - base64.length % 4) % 4);
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

async function api(method, body) {
  const res = await fetch('/api/push', {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `The server returned ${res.status}`);
  return json;
}

function card(inner) {
  $('alerts').innerHTML = `<section><div class="card alerts">${inner}</div></section>`;
}

async function setUpAlerts() {
  if (!$('alerts')) return;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

  if (!supported || (isIos && !installed)) {
    card(isIos && !installed
      ? `<h2>Get a heads-up before every game</h2>
         <p>Tap the Share button, then Add to Home Screen. Open ${esc(SITE)} from your home screen
         and turn alerts on there. iPhones only allow alerts from home screen apps.</p>`
      : `<h2>Alerts are not available here</h2><p>This browser cannot show notifications. Try Safari or Chrome on your phone.</p>`);
    return;
  }

  const reg = await navigator.serviceWorker.register('/sw.js');
  const status = await api('GET').catch(() => null);
  const sub = await reg.pushManager.getSubscription();

  if (sub && Notification.permission === 'granted') {
    const recent = status?.recent?.length
      ? `<details><summary>Recent alerts</summary><ul class="log">${status.recent.map(m =>
          `<li><b>${esc(m.title)}</b><br>${esc(m.body)}<br>${esc(new Date(m.at).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}</li>`).join('')}</ul></details>`
      : '';
    card(`<p class="on"><span>Alerts are on for this phone.</span>
      <button class="btn quiet" id="testAlert" type="button">Send a test</button></p>${recent}`);
    $('testAlert').onclick = async () => {
      $('testAlert').disabled = true;
      try { await api('POST', { test: true }); $('testAlert').textContent = 'Sent'; }
      catch (err) { $('testAlert').textContent = err.message; }
    };
    return;
  }

  if (Notification.permission === 'denied') {
    card(`<h2>Alerts are blocked</h2><p>Notifications for this site are turned off in your phone's settings.
      Turn them back on there, then reload.</p>`);
    return;
  }

  card(`<h2>Get a heads-up before every game</h2>
    <p>A short alert on game days when one of your players is in action, an hour before kickoff if something still
    needs fixing, and when one of your starters gets hurt. Nothing when there is nothing to do.</p>
    <p><button class="btn quiet" id="enableAlerts" type="button">Turn on alerts</button></p>`);
  $('enableAlerts').onclick = async () => {
    const btn = $('enableAlerts');
    btn.disabled = true;
    try {
      if (!status?.publicKey) throw new Error('Alerts are not set up on the server yet');
      if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications were not allowed');
      const subscription = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(status.publicKey) });
      await api('POST', { subscription });
      await api('POST', { test: true }).catch(() => {});
      setUpAlerts();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Try again';
      btn.insertAdjacentHTML('afterend', `<p class="comment">${esc(err.message)}.</p>`);
    }
  };
}

run();
