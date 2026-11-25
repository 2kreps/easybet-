(() => {
  'use strict';

  const FN = '/.netlify/functions/';
  const LIVE_CODES = new Set(['1H', '2H', 'HT', 'ET', 'BT', 'P', 'SUSP', 'INT', 'LIVE']);
  const DONE_CODES = new Set(['FT', 'AET', 'PEN']);
  const TITLES = { live: 'Live matches', today: 'Today’s matches', tomorrow: 'Tomorrow’s matches' };
  const SPORTS = [
    { id: 'football', label: 'Football', icon: '⚽', on: true },
    { id: 'hockey', label: 'Ice hockey', icon: '🏒' },
    { id: 'basketball', label: 'Basketball', icon: '🏀' },
    { id: 'tennis', label: 'Tennis', icon: '🎾' },
    { id: 'nfl', label: 'American football', icon: '🏈' },
    { id: 'baseball', label: 'Baseball', icon: '⚾' },
    { id: 'volleyball', label: 'Volleyball', icon: '🏐' },
    { id: 'handball', label: 'Handball', icon: '🤾' },
    { id: 'combat', label: 'Combat sports', icon: '🥊' },
  ];

  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; } })();

  const state = {
    tab: 'today',
    fixtures: new Map(),
    listToken: 0,
    matchToken: 0,
    listScroll: 0,
    fromList: false,
    refresh: null,
  };

  /* ------------------------------------------------------------ helpers */

  async function api(name, params) {
    const r = await fetch(`${FN}${name}?${new URLSearchParams(params)}`, { headers: { accept: 'application/json' } });
    let data = null;
    try { data = await r.json(); } catch (e) { /* non-JSON error page */ }
    if (!r.ok) throw new Error((data && data.message) || `Request failed (${r.status})`);
    return data || {};
  }

  function friendlyError(e) {
    const m = String(e && e.message || '');
    if (m.includes('API_FOOTBALL_KEY')) return 'The football API key is not configured on the server.';
    if (/rateLimit|Too many requests/i.test(m)) return 'The football data provider is rate-limiting requests. Please try again in a minute.';
    return 'The football data provider could not be reached right now.';
  }

  function dateKey(offset) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  const valid = (iso) => !Number.isNaN(new Date(iso).getTime());
  const fmtTime = (iso) => (valid(iso) ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');
  const fmtDay = (iso) => (valid(iso) ? new Date(iso).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  function tzShort(iso) {
    try {
      const p = new Intl.DateTimeFormat([], { timeZoneName: 'short' }).formatToParts(new Date(iso));
      return (p.find((x) => x.type === 'timeZoneName') || {}).value || '';
    } catch (e) { return ''; }
  }

  function logo(url, name, cls = 'logo') {
    const initials = String(name || '?').trim().slice(0, 2).toUpperCase();
    if (!url) return `<span class="logo-fallback">${esc(initials)}</span>`;
    return `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="${esc(initials)}">`;
  }
  // Replace broken logos with initials (never show a wrong / broken image)
  document.addEventListener('error', (e) => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.dataset.fallback) {
      const s = document.createElement('span');
      s.className = 'logo-fallback';
      s.textContent = t.dataset.fallback;
      t.replaceWith(s);
    }
  }, true);

  function statusInfo(f) {
    const s = (f.fixture && f.fixture.status) || {};
    const code = s.short || '';
    if (LIVE_CODES.has(code)) {
      let minute;
      if (code === 'HT') minute = 'HT';
      else if (code === 'BT') minute = 'BT';
      else if (code === 'P') minute = 'PEN';
      else if (s.elapsed != null) minute = `${s.elapsed}${s.extra ? '+' + s.extra : ''}'`;
      else minute = 'LIVE';
      return { kind: 'live', code, minute, text: code === 'HT' ? 'Half-time' : `Live · ${minute}`, showScore: true };
    }
    if (DONE_CODES.has(code)) return { kind: 'done', code, minute: code, text: code === 'FT' ? 'Full time' : (s.long || code), showScore: true };
    if (code === 'NS' || code === 'TBD') return { kind: 'upcoming', code, minute: '', text: code === 'TBD' ? 'Time to be defined' : 'Not started', showScore: false };
    return { kind: 'other', code, minute: code, text: s.long || code || 'Status unavailable', showScore: false };
  }

  /* ------------------------------------------------------- probability colour */
  // 65% pale green -> 70% medium -> 80% bright -> 90%+ deep neon green
  const STOPS = [
    [65, 125, 46, 82],
    [70, 130, 56, 66],
    [80, 138, 82, 52],
    [90, 143, 100, 47],
    [100, 146, 100, 46],
  ];
  function probStyle(p) {
    const v = Math.min(100, Math.max(65, p));
    let i = 0;
    while (i < STOPS.length - 2 && v > STOPS[i + 1][0]) i++;
    const a = STOPS[i];
    const b = STOPS[i + 1];
    const t = (v - a[0]) / (b[0] - a[0]);
    const h = a[1] + (b[1] - a[1]) * t;
    const s = a[2] + (b[2] - a[2]) * t;
    const l = a[3] + (b[3] - a[3]) * t;
    const glow = v >= 78 ? `0 0 ${Math.round((v - 70) * 1.1)}px hsla(${h.toFixed(0)},${s.toFixed(0)}%,${l.toFixed(0)}%,.45)` : 'none';
    return `--pbg:hsl(${h.toFixed(0)},${s.toFixed(0)}%,${l.toFixed(0)}%);--pglow:${glow}`;
  }

  /* ----------------------------------------------------------------- sports */
  function renderSports() {
    $('#sports').innerHTML = SPORTS.map((s) => s.on
      ? `<button class="sport is-active" type="button" role="tab" aria-selected="true">${s.icon} ${esc(s.label)}</button>`
      : `<button class="sport is-disabled" type="button" role="tab" aria-selected="false" aria-disabled="true" data-sport="${esc(s.label)}">${s.icon} ${esc(s.label)} <small>Soon</small></button>`
    ).join('');
  }
  $('#sports').addEventListener('click', (e) => {
    const b = e.target.closest('.sport.is-disabled');
    if (!b) return;
    const note = $('#sport-note');
    note.textContent = `${b.dataset.sport} is not available yet. It will appear once a verified data provider is connected — no placeholder fixtures are shown.`;
    note.hidden = false;
    clearTimeout(renderSports.t);
    renderSports.t = setTimeout(() => { note.hidden = true; }, 5000);
  });

  /* -------------------------------------------------------------- match list */
  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('is-active', b.dataset.tab === tab));
    $('#list-title').textContent = TITLES[tab];
    loadList();
  }
  $('#tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) setTab(b.dataset.tab);
  });

  async function loadList(silent = false) {
    const token = ++state.listToken;
    const box = $('#matches');
    if (!silent) {
      $('#list-count').textContent = '';
      box.innerHTML = '<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>';
    }
    try {
      const params = state.tab === 'live' ? { live: 'all' } : { date: dateKey(state.tab === 'today' ? 0 : 1) };
      if (TZ) params.tz = TZ;
      const d = await api('ottelut', params);
      if (token !== state.listToken) return;
      const list = Array.isArray(d.response) ? d.response : [];
      list.forEach((f) => state.fixtures.set(String(f.fixture.id), f));
      renderList(list);
    } catch (e) {
      if (token !== state.listToken || silent) return;
      $('#list-count').textContent = '';
      box.innerHTML = `<div class="state"><strong>Matches could not be loaded</strong><br>${esc(friendlyError(e))}<br><button class="btn" type="button" id="retry">Try again</button></div>`;
      $('#retry').addEventListener('click', () => loadList());
    }
  }

  function renderList(list) {
    const box = $('#matches');
    $('#list-count').textContent = list.length ? `${list.length} match${list.length === 1 ? '' : 'es'}` : '';
    if (!list.length) {
      const msg = state.tab === 'live' ? 'There are no live matches in the covered leagues right now.' : 'No matches found in the covered leagues for this day.';
      box.innerHTML = `<div class="state">${msg}</div>`;
      return;
    }
    const groups = new Map();
    list.forEach((f) => {
      const k = f.league.id;
      if (!groups.has(k)) groups.set(k, { league: f.league, items: [] });
      groups.get(k).items.push(f);
    });
    box.innerHTML = [...groups.values()].map((g) => `
      <section class="group">
        <div class="group-head">${logo(g.league.logo, g.league.name)}<b>${esc(g.league.name)}</b><span>${esc(g.league.country || '')}</span></div>
        ${g.items.map(rowHtml).join('')}
      </section>`).join('');
  }

  function rowHtml(f) {
    const st = statusInfo(f);
    const h = f.teams.home;
    const a = f.teams.away;
    const iso = f.fixture.date;
    let time;
    if (st.kind === 'live') time = `<span class="t-main">${esc(st.minute)}</span><span class="t-sub">LIVE</span>`;
    else if (st.kind === 'done') time = `<span class="t-main">${esc(st.minute)}</span><span class="t-sub">${esc(fmtDay(iso))}</span>`;
    else if (st.kind === 'upcoming') time = `<span class="t-main">${esc(fmtTime(iso))}</span><span class="t-sub">${esc(fmtDay(iso))}</span>`;
    else time = `<span class="t-main">${esc(st.minute || '—')}</span><span class="t-sub">${esc(fmtDay(iso))}</span>`;

    const gh = f.goals && f.goals.home;
    const ga = f.goals && f.goals.away;
    const score = st.showScore && gh != null && ga != null
      ? `<span class="mrow-score"><span class="g ${gh > ga ? 'lead' : ''}">${gh}</span><span class="g ${ga > gh ? 'lead' : ''}">${ga}</span></span>`
      : '<span class="mrow-score vs">VS</span>';

    return `<button class="mrow ${st.kind === 'live' ? 'is-live' : ''}" type="button" data-id="${esc(f.fixture.id)}">
      <span class="mrow-time">${time}</span>
      <span class="mrow-teams">
        <span class="mteam">${logo(h.logo, h.name)}<span class="name">${esc(h.name)}</span></span>
        <span class="mteam">${logo(a.logo, a.name)}<span class="name">${esc(a.name)}</span></span>
      </span>
      ${score}
      <span class="mrow-go" aria-hidden="true">›</span>
    </button>`;
  }

  $('#matches').addEventListener('click', (e) => {
    const row = e.target.closest('.mrow');
    if (!row) return;
    state.listScroll = window.scrollY;
    state.fromList = true;
    location.hash = `#match/${row.dataset.id}`;
  });

  /* ------------------------------------------------------------ match centre */
  function route() {
    const m = location.hash.match(/^#match\/(\d{1,12})$/);
    if (m) showMatch(m[1]);
    else showList();
  }
  window.addEventListener('hashchange', route);

  function showList() {
    state.matchToken++;
    $('#view-match').hidden = true;
    $('#view-list').hidden = false;
    window.scrollTo(0, state.listScroll || 0);
    scheduleRefresh();
  }

  $('#back').addEventListener('click', () => {
    if (state.fromList && history.length > 1) {
      state.fromList = false;
      history.back();
    } else {
      history.replaceState(null, '', location.pathname + location.search);
      route();
    }
  });

  function heroHtml(f) {
    const st = statusInfo(f);
    const h = f.teams.home;
    const a = f.teams.away;
    const iso = f.fixture.date;
    const gh = f.goals && f.goals.home;
    const ga = f.goals && f.goals.away;
    const mid = st.showScore && gh != null && ga != null
      ? `<div class="hero-score">${gh} : ${ga}</div>`
      : '<div class="hero-score vs">VS</div>';
    const tz = tzShort(iso);
    return `<section class="hero">
      <div class="hero-meta">${logo(f.league.logo, f.league.name)}<span>${esc(f.league.name)}${f.league.country ? ' · ' + esc(f.league.country) : ''}</span>
        <span class="pill ${st.kind === 'live' ? 'live' : ''}">${esc(st.text)}</span></div>
      <div class="hero-teams">
        <div class="hero-team">${logo(h.logo, h.name)}<strong>${esc(h.name)}</strong></div>
        <div class="hero-mid">${mid}
          <div class="hero-kick"><b>${esc(fmtTime(iso))}</b>${esc(fmtDay(iso))}${tz ? ' · ' + esc(tz) : ''}</div></div>
        <div class="hero-team">${logo(a.logo, a.name)}<strong>${esc(a.name)}</strong></div>
      </div>
    </section>`;
  }

  async function showMatch(id) {
    const token = ++state.matchToken;
    $('#view-list').hidden = true;
    $('#view-match').hidden = false;
    clearInterval(state.refresh);
    window.scrollTo(0, 0);

    const f = state.fixtures.get(id);
    const body = $('#match-body');
    const loadingSection = '<div class="section"><div class="skeleton"></div><div class="skeleton"></div></div>';
    body.innerHTML = (f ? heroHtml(f) : '<div class="skeleton" style="height:240px"></div>') + loadingSection;

    try {
      const p = { id };
      if (f) {
        Object.assign(p, {
          home: f.teams.home.id, away: f.teams.away.id, league: f.league.id, season: f.league.season,
          status: f.fixture.status.short, hn: f.teams.home.name, an: f.teams.away.name,
        });
        if (LIVE_CODES.has(f.fixture.status.short)) p.info = 1; // fresh score for live matches
      } else {
        p.info = 1; // opened from a direct link: ask the server for the fixture itself
      }
      const d = await api('match', p);
      if (token !== state.matchToken) return;
      const fx = d.fixture || f;
      if (!fx) throw new Error('Fixture not found');
      state.fixtures.set(id, fx);
      renderMatch(fx, d);
      loadCorners(token, fx, d);
    } catch (e) {
      if (token !== state.matchToken) return;
      body.innerHTML = (f ? heroHtml(f) : '') +
        `<div class="section"><div class="state"><strong>Match details could not be loaded</strong><br>${esc(friendlyError(e))}<br><button class="btn" type="button" id="retry-match">Try again</button></div></div>`;
      $('#retry-match').addEventListener('click', () => showMatch(id));
    }
  }

  /* ---- sections */
  const noData = (msg) => `<p class="nodata">${esc(msg || 'This information is not available from the data provider for this match.')}</p>`;

  function tipsHtml(d) {
    if (d.tipsStatus === 'not_prematch') {
      return noData('Betting tips are based on pre-match data, so they are only shown before kick-off.');
    }
    if (d.tipsStatus === 'unavailable') {
      return '';
    }
    if (!d.tips || !d.tips.length) {
      return '';
    }
    return `<div class="tips">${d.tips.map((t) => `
      <article class="tip" data-kind="${esc(t.kind)}">
        <div class="tip-top"><span>${esc(t.market)}</span><span class="tip-rank">ODDS ${Number(t.offeredOdds || 0).toFixed(2)}x</span></div>
        <div class="tip-main">
          <div class="tip-sel">${esc(t.selection)}</div>
          <div class="pct" style="${probStyle(t.probability)}"><span>${t.probability}</span><small>%</small></div>
        </div>
        <p class="tip-expl">${esc(t.explanation)}</p>
        <p class="tip-basis">${esc(t.basis)}</p>
      </article>`).join('')}</div>`;
  }

  function formHtml(list, name) {
    if (!list || !list.length) return noData('No recent results available.');
    const chips = [...list].reverse().map((m) => {
      const title = `${m.r} ${m.score} ${m.venue === 'H' ? 'vs' : '@'} ${m.opp}${m.tag ? ' (' + m.tag + ')' : ''} · ${m.comp} · ${fmtDay(m.date)}`;
      return `<div class="fchip ${esc(m.r)}" title="${esc(title)}"><i>${esc(m.r)}</i><small>${esc(m.score)}</small></div>`;
    }).join('');
    return `<div class="form-row" aria-label="Last ${list.length} results for ${esc(name)}">${chips}</div>`;
  }

  function teamHead(t) {
    return `<div class="card-team">${logo(t.logo, t.name)}<span>${esc(t.name)}</span></div>`;
  }

  function injuryCol(t, list, available) {
    let inner;
    if (!available) inner = noData('Injury data is temporarily unavailable.');
    else if (!list.length) inner = noData('No absences reported by the data provider.');
    else {
      inner = `<ul class="inj-list">${list.map((p) =>
        `<li><b>${esc(p.name)}</b><small class="${p.status === 'doubtful' ? 'doubtful' : ''}">${esc(p.reason)}${p.status === 'doubtful' ? ' · Doubtful' : ''}</small></li>`).join('')}</ul>`;
    }
    return `<div class="card inj-col"><h4>${logo(t.logo, t.name)}<span>${esc(t.name)}</span></h4>${inner}</div>`;
  }

  let statFailed = false;
  function statCard(title, sub, h, a, rows, wide) {
    const body = rows.filter((r) => r[1] != null || r[2] != null);
    if (!body.length) return '';
    const inner = body.length
      ? `<div class="stat-head"><span>${esc(h.name)}</span><span></span><span>${esc(a.name)}</span></div>
         ${body.map((r) => `<div class="stat-row"><b>${r[1] == null ? '–' : esc(r[1])}</b><span>${esc(r[0])}</span><b>${r[2] == null ? '–' : esc(r[2])}</b></div>`).join('')}`
      : noData(statFailed ? 'Temporarily unavailable: the data provider did not return recent matches.' : undefined);
    return `<section class="card stat-card ${wide ? 'wide' : ''}"><h3>${esc(title)}</h3><p class="sub">${esc(sub)}</p>${inner}</section>`;
  }

  const rec = (v) => (v ? `${v.w}-${v.d}-${v.l}` : null);

  function goalsCard(d, h, a) {
    const x = d.goals.home;
    const y = d.goals.away;
    const sub = `Last ${(x && x.n) || (y && y.n) || 10} matches · 90 minutes`;
    return statCard('Goals Scored & Conceded', sub, h, a, [
      ['Scored per match', x && x.avgFor, y && y.avgFor],
      ['Conceded per match', x && x.avgAgainst, y && y.avgAgainst],
      ['Clean sheets', x && `${x.cleanSheets}/${x.n}`, y && `${y.cleanSheets}/${y.n}`],
      ['Failed to score', x && `${x.failedToScore}/${x.n}`, y && `${y.failedToScore}/${y.n}`],
      ['Both teams scored', x && `${x.btts}/${x.n}`, y && `${y.btts}/${y.n}`],
    ]);
  }

  function venueCard(d, h, a) {
    const x = d.venue.home;
    const y = d.venue.away;
    return statCard('Home / Away Form', `${h.name} at home · ${a.name} away`, h, a, [
      ['Matches', x && x.n, y && y.n],
      ['W-D-L', rec(x), rec(y)],
      ['Goals for-against', x && `${x.gf}-${x.ga}`, y && `${y.gf}-${y.ga}`],
      ['Points per game', x && x.ppg, y && y.ppg],
    ]);
  }

  function halfTimeCard(d, h, a) {
    const x = d.halftime.home;
    const y = d.halftime.away;
    return statCard('Half-time Statistics', `Last ${(x && x.n) || (y && y.n) || 10} matches`, h, a, [
      ['Leading at half-time', x && `${x.lead}/${x.n}`, y && `${y.lead}/${y.n}`],
      ['Level at half-time', x && `${x.level}/${x.n}`, y && `${y.level}/${y.n}`],
      ['Trailing at half-time', x && `${x.trail}/${x.n}`, y && `${y.trail}/${y.n}`],
      ['1st-half goals scored', x && x.avgFor, y && y.avgFor],
      ['1st-half goals conceded', x && x.avgAgainst, y && y.avgAgainst],
    ]);
  }

  function standingsHtml(d, f) {
    const s = d.standings;
    if (d.unavailable && d.unavailable.includes('standings')) return noData('');
    if (!s || !s.rows || !s.rows.length) return noData('No league table is available for this competition.');
    const ids = new Set([f.teams.home.id, f.teams.away.id]);
    return `<div class="table-wrap"><table class="st"><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead><tbody>
      ${s.rows.map((r) => `<tr class="${ids.has(r.id) ? 'hl' : ''}"><td>${esc(r.rank)}</td><td class="team">${logo(r.logo, r.name)}<span>${esc(r.name)}</span></td><td>${esc(r.played ?? '–')}</td><td>${esc(r.won ?? '–')}</td><td>${esc(r.draw ?? '–')}</td><td>${esc(r.lose ?? '–')}</td><td>${esc(r.gd ?? '–')}</td><td class="pts">${esc(r.pts ?? '–')}</td></tr>`).join('')}
    </tbody></table></div>${s.name ? `<p class="form-note">${esc(s.name)}</p>` : ''}`;
  }

  function renderMatch(f, d) {
    const h = f.teams.home;
    const a = f.teams.away;
    const unavailable = new Set(d.unavailable || []);
    statFailed = unavailable.has('homeLast') || unavailable.has('awayLast');
    const recentHome = d.recent && d.recent.home || [];
    const recentAway = d.recent && d.recent.away || [];
    const hasRecent = recentHome.length || recentAway.length;
    const hasInjuries = d.injuries && d.injuries.available;

    $('#match-body').innerHTML = `
      ${heroHtml(f)}

      ${d.tips && d.tips.length ? `<section class="section">
        <h2 class="sec-title">TOP BETTING TIPS · 65%+ PROBABILITY</h2>
        ${tipsHtml(d)}
      </section>` : ''}

      ${hasRecent ? `<section class="section">
        <h2 class="sec-title">Last 5 Matches</h2>
        <div class="cards-2">
          ${recentHome.length ? `<div class="card">${teamHead(h)}${formHtml(recentHome, h.name)}</div>` : ''}
          ${recentAway.length ? `<div class="card">${teamHead(a)}${formHtml(recentAway, a.name)}</div>` : ''}
        </div>
        <p class="form-note">W = win · D = draw · L = loss.</p>
      </section>` : ''}

      ${hasInjuries ? `<section class="section">
        <h2 class="sec-title">Injuries &amp; Suspensions</h2>
        <div class="cards-2">
          ${injuryCol(h, d.injuries.home, true)}
          ${injuryCol(a, d.injuries.away, true)}
        </div>
      </section>` : ''}

      <section class="section" id="team-stats-section">
        <h2 class="sec-title">Team Statistics</h2>
        <div class="stats-grid">
          ${goalsCard(d, h, a)}
          <section class="card stat-card" id="corners-card"><h3>Corners Statistics</h3><p class="sub">Last 5 matches</p><div id="corners-body"><div class="skeleton" style="height:120px;margin:0"></div></div></section>
          ${venueCard(d, h, a)}
          ${halfTimeCard(d, h, a)}
          ${d.standings && d.standings.rows && d.standings.rows.length ? `<section class="card stat-card wide"><h3>League Standings</h3><p class="sub">${esc(f.league.name)} · ${esc(f.league.season)}</p>${standingsHtml(d, f)}</section>` : ''}
        </div>
      </section>`;
    const statsSection = $('#team-stats-section');
    if (statsSection && !statsSection.querySelector('.stat-card')) statsSection.remove();
  }

  function cleanupStatsSection() {
    const section = $('#team-stats-section');
    if (section && !section.querySelector('.stat-card')) section.remove();
  }

  async function loadCorners(token, f, d) {
    const slot = $('#corners-body');
    if (!slot) return;
    const hIds = (d.corners && d.corners.home) || [];
    const aIds = (d.corners && d.corners.away) || [];
    if (!hIds.length && !aIds.length) { $('#corners-card')?.remove(); cleanupStatsSection(); return; }
    try {
      const c = await api('match', { part: 'corners', home: f.teams.home.id, away: f.teams.away.id, h: hIds.join(','), a: aIds.join(',') });
      if (token !== state.matchToken) return;
      const x = c.home;
      const y = c.away;
      const rows = [
        ['Corners won per match', x && x.avgFor, y && y.avgFor],
        ['Corners conceded per match', x && x.avgAgainst, y && y.avgAgainst],
        ['Total corners per match', x && x.avgTotal, y && y.avgTotal],
        ['Matches with data', x && x.n, y && y.n],
      ].filter((r) => r[1] != null || r[2] != null);
      if (!rows.length) {
        $('#corners-card')?.remove();
        cleanupStatsSection();
        return;
      }
      slot.innerHTML = `<div class="stat-head"><span>${esc(f.teams.home.name)}</span><span></span><span>${esc(f.teams.away.name)}</span></div>
           ${rows.map((r) => `<div class="stat-row"><b>${r[1] == null ? '–' : esc(r[1])}</b><span>${esc(r[0])}</span><b>${r[2] == null ? '–' : esc(r[2])}</b></div>`).join('')}`;

      // Add real corner averages to a corners tip, if one is shown
      document.querySelectorAll('.tip[data-kind^="c_"]').forEach((tip) => {
        if (x && y) {
          const p = document.createElement('p');
          p.className = 'tip-extra';
          p.textContent = `Recent matches averaged ${x.avgTotal} corners for ${f.teams.home.name} and ${y.avgTotal} for ${f.teams.away.name}.`;
          tip.querySelector('.tip-expl').after(p);
        }
      });
    } catch (e) {
      if (token === state.matchToken) { $('#corners-card')?.remove(); cleanupStatsSection(); }
    }
  }

  /* --------------------------------------------------------- live auto-refresh */
  function scheduleRefresh() {
    clearInterval(state.refresh);
    state.refresh = setInterval(() => {
      if (document.hidden || $('#view-list').hidden || state.tab !== 'live') return;
      loadList(true);
    }, 90000);
  }

  /* -------------------------------------------------------------------- init */
  renderSports();
  $('#tz').textContent = TZ ? `Times in ${TZ.replace(/_/g, ' ')}` : '';
  scheduleRefresh();
  loadList();
  if (/^#match\/\d{1,12}$/.test(location.hash)) route();
})();
