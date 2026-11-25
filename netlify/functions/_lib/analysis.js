'use strict';

/*
 * Pure analysis helpers for the EASYBET Match Centre.
 * No network access in this file: everything works on data returned by API-Football.
 *
 * HOW A TIP PROBABILITY IS CALCULATED (never invented, never inflated)
 *  1. ODDS CONSENSUS  - for each market we take every bookmaker's decimal odds, convert them to
 *     implied probabilities (1 / odds) and remove the bookmaker margin by normalising the
 *     outcomes of that market so they add up to 100 %. The tip probability is the MEDIAN over
 *     all bookmakers. At least MIN_BOOKMAKERS bookmakers must quote the market.
 *  2. PROVIDER PERCENTAGES - only for match result / double chance when no odds exist: the
 *     provider's own home / draw / away percentages (double chance = sum of two outcomes).
 *  3. RECENT HISTORY - only for goals / both-teams-to-score when no odds exist: the average of
 *     both teams' hit rates over their last 10 finished matches (at least 8 matches each and
 *     each team individually at 55 % or higher).
 *  A tip is published only when its probability is >= THRESHOLD (65 %).
 *  At most one tip per market family, best probability first, maximum 3 tips.
 */

const THRESHOLD = 65;
const MIN_BOOKMAKERS = 3;
const MIN_SAMPLE = 5;
const FINISHED = new Set(['FT', 'AET', 'PEN']);

/* ---------------------------------------------------------------- helpers */

function toNumber(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace('%', '').trim();
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function median(arr) {
  const a = [...arr].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

const round1 = (n) => Math.round(n * 10) / 10;

function tally(ms, fn) {
  let k = 0;
  let n = 0;
  for (const m of ms) {
    const v = fn(m);
    if (v === null || v === undefined) continue;
    n += 1;
    if (v) k += 1;
  }
  return { k, n };
}

function mean(ms, fn) {
  let sum = 0;
  let n = 0;
  for (const m of ms) {
    const v = fn(m);
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    sum += v;
    n += 1;
  }
  return n ? { value: sum / n, n } : null;
}

/* --------------------------------------------------------- recent matches */

function toMatches(fixtures, teamId) {
  const id = Number(teamId);
  const out = [];
  const seen = new Set();
  for (const f of fixtures || []) {
    const fid = f?.fixture?.id;
    if (!f?.fixture || !FINISHED.has(f.fixture.status?.short) || seen.has(fid)) continue;
    const home = f.teams?.home;
    const away = f.teams?.away;
    if (!home || !away) continue;
    const isHome = Number(home.id) === id;
    if (!isHome && Number(away.id) !== id) continue;

    const gh = toNumber(f.goals?.home);
    const ga = toNumber(f.goals?.away);
    if (gh === null || ga === null) continue;

    // 90-minute score is used for betting statistics (extra time excluded)
    const ft = f.score?.fulltime || {};
    const fh = toNumber(ft.home);
    const fa = toNumber(ft.away);
    const g90 = fh !== null && fa !== null ? [fh, fa] : [gh, ga];

    const ht = f.score?.halftime || {};
    const hh = toNumber(ht.home);
    const ha = toNumber(ht.away);
    const hasHt = hh !== null && ha !== null;

    const me = isHome ? home : away;
    const opp = isHome ? away : home;
    const gf = isHome ? gh : ga;
    const gAgainst = isHome ? ga : gh;
    let result;
    if (me.winner === true) result = 'W';
    else if (opp.winner === true) result = 'L';
    else result = gf > gAgainst ? 'W' : gf < gAgainst ? 'L' : 'D';

    seen.add(fid);
    out.push({
      id: fid,
      ts: Number(f.fixture.timestamp) || Math.floor(Date.parse(f.fixture.date) / 1000) || 0,
      date: f.fixture.date,
      isHome,
      result,
      gf,
      ga: gAgainst,
      f90: isHome ? g90[0] : g90[1],
      a90: isHome ? g90[1] : g90[0],
      htf: hasHt ? (isHome ? hh : ha) : null,
      hta: hasHt ? (isHome ? ha : hh) : null,
      opp: { id: opp.id, name: opp.name, logo: opp.logo },
      comp: f.league?.name || '',
      tag: f.fixture.status.short === 'FT' ? '' : f.fixture.status.short,
    });
  }
  out.sort((x, y) => y.ts - x.ts);
  return out;
}

function recentList(ms, limit = 5) {
  return ms.slice(0, limit).map((m) => ({
    r: m.result,
    score: `${m.gf}-${m.ga}`,
    opp: m.opp.name,
    venue: m.isHome ? 'H' : 'A',
    date: m.date,
    comp: m.comp,
    tag: m.tag,
  }));
}

function goalsSummary(ms) {
  if (ms.length < 3) return null;
  const f = mean(ms, (m) => m.f90);
  const a = mean(ms, (m) => m.a90);
  return {
    n: ms.length,
    avgFor: round1(f.value),
    avgAgainst: round1(a.value),
    cleanSheets: ms.filter((m) => m.a90 === 0).length,
    failedToScore: ms.filter((m) => m.f90 === 0).length,
    btts: ms.filter((m) => m.f90 > 0 && m.a90 > 0).length,
    over25: ms.filter((m) => m.f90 + m.a90 > 2.5).length,
  };
}

function venueSummary(all, wantHome, limit = 8) {
  const ms = all.filter((m) => m.isHome === wantHome).slice(0, limit);
  if (ms.length < 3) return null;
  const w = ms.filter((m) => m.result === 'W').length;
  const d = ms.filter((m) => m.result === 'D').length;
  const l = ms.filter((m) => m.result === 'L').length;
  return {
    n: ms.length,
    w,
    d,
    l,
    gf: ms.reduce((s, m) => s + m.f90, 0),
    ga: ms.reduce((s, m) => s + m.a90, 0),
    ppg: round1((3 * w + d) / ms.length),
  };
}

function halfTimeSummary(ms) {
  const hs = ms.filter((m) => m.htf !== null);
  if (hs.length < 3) return null;
  return {
    n: hs.length,
    lead: hs.filter((m) => m.htf > m.hta).length,
    level: hs.filter((m) => m.htf === m.hta).length,
    trail: hs.filter((m) => m.htf < m.hta).length,
    avgFor: round1(mean(hs, (m) => m.htf).value),
    avgAgainst: round1(mean(hs, (m) => m.hta).value),
  };
}

/* ----------------------------------------------------------- odds consensus */

function valueMap(bet) {
  const m = new Map();
  for (const v of bet?.values || []) {
    const o = Number(v?.odd);
    if (Number.isFinite(o) && o > 1) m.set(String(v.value).trim().toLowerCase(), o);
  }
  return m;
}

function threeWay(bet) {
  const m = valueMap(bet);
  const h = m.get('home');
  const d = m.get('draw');
  const a = m.get('away');
  if (!h || !d || !a) return null;
  const ih = 1 / h;
  const id = 1 / d;
  const ia = 1 / a;
  const s = ih + id + ia;
  if (s < 0.98 || s > 1.3) return null; // implausible margin -> ignore this bookmaker's row
  const home = (ih / s) * 100;
  const draw = (id / s) * 100;
  const away = (ia / s) * 100;
  return { home, draw, away, dc1x: home + draw, dcx2: draw + away, dc12: home + away };
}

function overUnderPairs(bet) {
  const raw = {};
  for (const [k, o] of valueMap(bet)) {
    const r = /^(over|under)\s+(\d+(?:\.\d+)?)$/.exec(k);
    if (!r) continue;
    (raw[r[2]] = raw[r[2]] || {})[r[1]] = o;
  }
  const out = [];
  for (const [line, v] of Object.entries(raw)) {
    if (!v.over || !v.under) continue;
    const io = 1 / v.over;
    const iu = 1 / v.under;
    const s = io + iu;
    if (s < 0.98 || s > 1.25) continue;
    out.push({ line, over: (io / s) * 100, under: (iu / s) * 100 });
  }
  return out;
}

function handicapPairs(bet) {
  const raw = {};
  for (const [k, o] of valueMap(bet)) {
    const r = /^(home|away)\s*([+-]?\d+(?:\.\d+)?)$/.exec(k);
    if (!r) continue;
    const l = Number(r[2]);
    const homeLine = String(r[1] === 'home' ? l : -l);
    (raw[homeLine] = raw[homeLine] || {})[r[1]] = o;
  }
  const out = [];
  for (const [homeLine, v] of Object.entries(raw)) {
    if (!v.home || !v.away) continue;
    const ih = 1 / v.home;
    const ia = 1 / v.away;
    const s = ih + ia;
    if (s < 0.98 || s > 1.25) continue;
    out.push({ homeLine, home: (ih / s) * 100, away: (ia / s) * 100 });
  }
  return out;
}

function offeredOddsFor(oddsResp, sel) {
  const books = Array.isArray(oddsResp?.[0]?.bookmakers) ? oddsResp[0].bookmakers : [];
  const out = [];
  const target = (sel.kind === 'r_home' ? ['match winner', 'home'] :
    sel.kind === 'r_away' ? ['match winner', 'away'] :
    sel.kind === 'ht_home' ? ['first half winner', 'home'] :
    sel.kind === 'ht_away' ? ['first half winner', 'away'] :
    sel.kind === 'btts_yes' ? ['both teams score', 'yes'] :
    sel.kind === 'btts_no' ? ['both teams score', 'no'] :
    sel.kind === 'over' ? ['goals over/under', `over ${sel.line}`] :
    sel.kind === 'under' ? ['goals over/under', `under ${sel.line}`] :
    sel.kind === 'c_over' ? ['corners over under', `over ${sel.line}`] :
    sel.kind === 'c_under' ? ['corners over under', `under ${sel.line}`] :
    null);
  if (!target) return null; // no directly offered bookmaker price for this selection
  for (const bm of books) {
    const bet = (bm?.bets || []).find(b => String(b?.name || '').trim().toLowerCase() === target[0]);
    if (!bet) continue;
    const v = (bet.values || []).find(x => String(x?.value || '').trim().toLowerCase() === target[1]);
    const odd = Number(v?.odd);
    if (Number.isFinite(odd) && odd > 1) out.push(odd);
  }
  return out.length >= MIN_BOOKMAKERS ? median(out) : null;
}

function oddsCandidates(oddsResp) {
  const bookmakers = Array.isArray(oddsResp?.[0]?.bookmakers) ? oddsResp[0].bookmakers : [];
  const acc = { r: {}, h: {}, goals: {}, btts: { yes: [], no: [] }, ah: {}, corners: {} };
  const push = (o, k, v) => {
    (o[k] = o[k] || []).push(v);
  };

  for (const bm of bookmakers) {
    const bets = bm?.bets || [];
    const find = (name) => bets.find((b) => String(b?.name || '').trim().toLowerCase() === name);

    const mw = find('match winner');
    const r = mw && threeWay(mw);
    if (r) for (const k of Object.keys(r)) push(acc.r, k, r[k]);

    const fh = find('first half winner');
    const h = fh && threeWay(fh);
    if (h) for (const k of Object.keys(h)) push(acc.h, k, h[k]);

    const gou = find('goals over/under');
    if (gou) {
      for (const p of overUnderPairs(gou)) {
        acc.goals[p.line] = acc.goals[p.line] || { over: [], under: [] };
        acc.goals[p.line].over.push(p.over);
        acc.goals[p.line].under.push(p.under);
      }
    }

    const bt = find('both teams score');
    if (bt) {
      const m = valueMap(bt);
      const y = m.get('yes');
      const n = m.get('no');
      if (y && n) {
        const s = 1 / y + 1 / n;
        if (s >= 0.98 && s <= 1.25) {
          acc.btts.yes.push((1 / y / s) * 100);
          acc.btts.no.push((1 / n / s) * 100);
        }
      }
    }

    const ah = find('asian handicap');
    if (ah) {
      for (const p of handicapPairs(ah)) {
        acc.ah[p.homeLine] = acc.ah[p.homeLine] || { home: [], away: [] };
        acc.ah[p.homeLine].home.push(p.home);
        acc.ah[p.homeLine].away.push(p.away);
      }
    }

    const co = find('corners over under');
    if (co) {
      for (const p of overUnderPairs(co)) {
        acc.corners[p.line] = acc.corners[p.line] || { over: [], under: [] };
        acc.corners[p.line].over.push(p.over);
        acc.corners[p.line].under.push(p.under);
      }
    }
  }

  const cands = [];
  const covered = new Set();
  const add = (family, sel, arr) => {
    if (!arr || arr.length < MIN_BOOKMAKERS) return;
    covered.add(family);
    cands.push({ family, sel, p: median(arr), source: 'odds', books: arr.length });
  };

  add('result', { kind: 'r_home' }, acc.r.home);
  add('result', { kind: 'r_away' }, acc.r.away);
  add('result', { kind: 'r_1x' }, acc.r.dc1x);
  add('result', { kind: 'r_x2' }, acc.r.dcx2);
  add('result', { kind: 'r_12' }, acc.r.dc12);

  add('halftime', { kind: 'ht_home' }, acc.h.home);
  add('halftime', { kind: 'ht_away' }, acc.h.away);
  add('halftime', { kind: 'ht_1x' }, acc.h.dc1x);
  add('halftime', { kind: 'ht_x2' }, acc.h.dcx2);

  // Trivial lines (e.g. Over 0.5 / Under 5.5) are deliberately not offered as tips.
  for (const line of [1.5, 2.5, 3.5]) add('goals', { kind: 'over', line }, acc.goals[String(line)]?.over);
  for (const line of [2.5, 3.5]) add('goals', { kind: 'under', line }, acc.goals[String(line)]?.under);

  add('btts', { kind: 'btts_yes' }, acc.btts.yes);
  add('btts', { kind: 'btts_no' }, acc.btts.no);

  add('handicap', { kind: 'ah', side: 'home', line: -1.5 }, acc.ah['-1.5']?.home);
  add('handicap', { kind: 'ah', side: 'away', line: 1.5 }, acc.ah['-1.5']?.away);
  add('handicap', { kind: 'ah', side: 'home', line: 1.5 }, acc.ah['1.5']?.home);
  add('handicap', { kind: 'ah', side: 'away', line: -1.5 }, acc.ah['1.5']?.away);

  for (const line of [7.5, 8.5, 9.5, 10.5, 11.5]) {
    add('corners', { kind: 'c_over', line }, acc.corners[String(line)]?.over);
    add('corners', { kind: 'c_under', line }, acc.corners[String(line)]?.under);
  }

  return { cands, covered, bookmakers: bookmakers.length };
}

/* ------------------------------------------------- provider / history fallbacks */

function providerCandidates(predictions) {
  const pc = predictions?.[0]?.predictions?.percent;
  const h = toNumber(pc?.home);
  const d = toNumber(pc?.draw);
  const a = toNumber(pc?.away);
  if (h === null || d === null || a === null) return [];
  const total = h + d + a;
  if (total < 97 || total > 103) return [];
  const mk = (kind, p) => ({ family: 'result', sel: { kind }, p, source: 'provider' });
  return [
    mk('r_home', h),
    mk('r_away', a),
    mk('r_1x', h + d),
    mk('r_x2', d + a),
    mk('r_12', h + a),
  ];
}

function historyCandidates(hs, as, covered) {
  const out = [];
  if (hs.length < 8 || as.length < 8) return out;
  const n = Math.min(hs.length, as.length);
  const rate = (ms, fn) => {
    const t = tally(ms, fn);
    return t.n ? (t.k / t.n) * 100 : null;
  };
  const add = (family, sel, fn) => {
    if (covered.has(family)) return;
    const a = rate(hs, fn);
    const b = rate(as, fn);
    if (a === null || b === null || a < 55 || b < 55) return;
    out.push({ family, sel, p: (a + b) / 2, source: 'history', sample: n });
  };
  const tot = (m) => m.f90 + m.a90;
  for (const line of [1.5, 2.5, 3.5]) add('goals', { kind: 'over', line }, (m) => tot(m) > line);
  for (const line of [2.5, 3.5]) add('goals', { kind: 'under', line }, (m) => tot(m) < line);
  add('btts', { kind: 'btts_yes' }, (m) => m.f90 > 0 && m.a90 > 0);
  add('btts', { kind: 'btts_no' }, (m) => !(m.f90 > 0 && m.a90 > 0));
  return out;
}

/* ---------------------------------------------------------------- wording */

const fmtLine = (l) => `${l > 0 ? '+' : '-'}${Math.abs(l)}`;

function describe(sel, H, A) {
  switch (sel.kind) {
    case 'r_home': return ['MATCH WINNER', `${H} to win`];
    case 'r_away': return ['MATCH WINNER', `${A} to win`];
    case 'r_1x': return ['DOUBLE CHANCE', `${H} or draw`];
    case 'r_x2': return ['DOUBLE CHANCE', `${A} or draw`];
    case 'r_12': return ['DOUBLE CHANCE', `${H} or ${A} (no draw)`];
    case 'ht_home': return ['HALF-TIME RESULT', `${H} leading at half-time`];
    case 'ht_away': return ['HALF-TIME RESULT', `${A} leading at half-time`];
    case 'ht_1x': return ['HALF-TIME RESULT', `${H} or draw at half-time`];
    case 'ht_x2': return ['HALF-TIME RESULT', `${A} or draw at half-time`];
    case 'over': return ['OVER/UNDER GOALS', `Over ${sel.line} goals`];
    case 'under': return ['OVER/UNDER GOALS', `Under ${sel.line} goals`];
    case 'btts_yes': return ['BOTH TEAMS TO SCORE', 'Yes - both teams score'];
    case 'btts_no': return ['BOTH TEAMS TO SCORE', 'No - a team fails to score'];
    case 'ah': return ['HANDICAP', `${sel.side === 'home' ? H : A} ${fmtLine(sel.line)}`];
    case 'c_over': return ['CORNERS', `Over ${sel.line} corners`];
    case 'c_under': return ['CORNERS', `Under ${sel.line} corners`];
    default: return ['TIP', ''];
  }
}

function explain(sel, ctx) {
  const { H, A, hs, as } = ctx;
  const parts = [];
  const add = (t, f) => {
    if (t.n >= MIN_SAMPLE) parts.push(f(t));
  };
  const res = (ms, r) => tally(ms, (m) => m.result === r);
  const ht = (kind) => (m) => {
    if (m.htf === null) return null;
    if (kind === 'lead') return m.htf > m.hta;
    if (kind === 'trail') return m.htf < m.hta;
    return m.htf >= m.hta; // not behind
  };

  switch (sel.kind) {
    case 'r_home':
      add(res(hs, 'W'), (t) => `${H} won ${t.k} of their last ${t.n}`);
      add(res(as, 'L'), (t) => `${A} lost ${t.k} of their last ${t.n}`);
      break;
    case 'r_away':
      add(res(as, 'W'), (t) => `${A} won ${t.k} of their last ${t.n}`);
      add(res(hs, 'L'), (t) => `${H} lost ${t.k} of their last ${t.n}`);
      break;
    case 'r_1x':
      add(tally(hs, (m) => m.result !== 'L'), (t) => `${H} avoided defeat in ${t.k} of their last ${t.n}`);
      add(res(as, 'W'), (t) => `${A} won ${t.k} of their last ${t.n}`);
      break;
    case 'r_x2':
      add(tally(as, (m) => m.result !== 'L'), (t) => `${A} avoided defeat in ${t.k} of their last ${t.n}`);
      add(res(hs, 'W'), (t) => `${H} won ${t.k} of their last ${t.n}`);
      break;
    case 'r_12':
      add(res(hs, 'D'), (t) => `${H} drew ${t.k} of their last ${t.n}`);
      add(res(as, 'D'), (t) => `${A} drew ${t.k} of their last ${t.n}`);
      break;
    case 'ht_home':
      add(tally(hs, ht('lead')), (t) => `${H} led at half-time in ${t.k} of their last ${t.n}`);
      add(tally(as, ht('trail')), (t) => `${A} trailed at half-time in ${t.k} of their last ${t.n}`);
      break;
    case 'ht_away':
      add(tally(as, ht('lead')), (t) => `${A} led at half-time in ${t.k} of their last ${t.n}`);
      add(tally(hs, ht('trail')), (t) => `${H} trailed at half-time in ${t.k} of their last ${t.n}`);
      break;
    case 'ht_1x':
      add(tally(hs, ht('notBehind')), (t) => `${H} were not behind at half-time in ${t.k} of their last ${t.n}`);
      add(tally(as, ht('lead')), (t) => `${A} led at half-time in ${t.k} of their last ${t.n}`);
      break;
    case 'ht_x2':
      add(tally(as, ht('notBehind')), (t) => `${A} were not behind at half-time in ${t.k} of their last ${t.n}`);
      add(tally(hs, ht('lead')), (t) => `${H} led at half-time in ${t.k} of their last ${t.n}`);
      break;
    case 'over':
    case 'under': {
      const test = sel.kind === 'over' ? (m) => m.f90 + m.a90 > sel.line : (m) => m.f90 + m.a90 < sel.line;
      for (const [name, ms] of [[H, hs], [A, as]]) {
        const t = tally(ms, test);
        const a = mean(ms, (m) => m.f90 + m.a90);
        if (t.n >= MIN_SAMPLE && a) {
          parts.push(`${name}'s last ${t.n} matches averaged ${round1(a.value)} goals (${sel.kind} ${sel.line} in ${t.k})`);
        }
      }
      break;
    }
    case 'btts_yes': {
      const a = tally(hs, (m) => m.f90 > 0 && m.a90 > 0);
      const b = tally(as, (m) => m.f90 > 0 && m.a90 > 0);
      if (a.n >= MIN_SAMPLE && b.n >= MIN_SAMPLE) {
        parts.push(`Both teams scored in ${a.k} of ${H}'s last ${a.n} and ${b.k} of ${A}'s last ${b.n}`);
      }
      break;
    }
    case 'btts_no': {
      const a = tally(hs, (m) => !(m.f90 > 0 && m.a90 > 0));
      const b = tally(as, (m) => !(m.f90 > 0 && m.a90 > 0));
      if (a.n >= MIN_SAMPLE && b.n >= MIN_SAMPLE) {
        parts.push(`A team failed to score in ${a.k} of ${H}'s last ${a.n} and ${b.k} of ${A}'s last ${b.n}`);
      }
      break;
    }
    case 'ah': {
      const name = sel.side === 'home' ? H : A;
      const ms = sel.side === 'home' ? hs : as;
      const t = tally(ms, (m) => m.f90 - m.a90 + sel.line > 0);
      add(t, (x) => `${name} would have covered the ${fmtLine(sel.line)} handicap in ${x.k} of their last ${x.n}`);
      break;
    }
    default:
      break;
  }
  return parts.length ? `${parts.join('; ')}.` : '';
}

function basisText(c) {
  if (c.source === 'odds') return `Based on ${c.books} bookmakers' odds, margin removed`;
  if (c.source === 'provider') return 'Based on the data provider’s win probabilities';
  return `Based on both teams' last ${c.sample} matches`;
}

function buildTips({ H, A, odds, predictions, hs, as }) {
  const o = oddsCandidates(odds);
  let cands = [...o.cands];
  const covered = new Set(o.covered);

  if (!covered.has('result')) {
    const pc = providerCandidates(predictions);
    if (pc.length) {
      covered.add('result');
      cands = cands.concat(pc);
    }
  }
  cands = cands.concat(historyCandidates(hs, as, covered));

  const best = new Map();
  for (const c of cands) {
    if (!(c.p >= THRESHOLD)) continue;
    // Publish only a directly quoted bookmaker price, not synthetic fair odds.
    c.offeredOdds = c.source === 'odds' ? offeredOddsFor(odds, c.sel) : null;
    if (!(Number(c.offeredOdds) > 1.80)) continue;
    const cur = best.get(c.family);
    if (!cur || c.p > cur.p) best.set(c.family, c);
  }
  const picked = [...best.values()].sort((a, b) => b.p - a.p).slice(0, 3);

  const ctx = { H, A, hs, as };
  return {
    considered: cands.length,
    tips: picked.map((c, i) => {
      const [market, selection] = describe(c.sel, H, A);
      const probability = Math.floor(c.p);
      let explanation = explain(c.sel, ctx);
      if (!explanation) {
        const fair = (100 / c.p).toFixed(2);
        explanation =
          c.source === 'odds'
            ? `${selection}: estimated probability ${probability}%; bookmaker's quoted odds ${Number(c.offeredOdds).toFixed(2)}.`
            : `${selection}: the data provider estimates a ${probability}% chance.`;
        const pc = predictions?.[0]?.predictions?.percent;
        if (pc && c.sel.kind.startsWith('r_') && c.source === 'odds') {
          explanation += ` The provider's own model gives ${H} ${pc.home}, draw ${pc.draw}, ${A} ${pc.away}.`;
        }
      }
      return {
        rank: i + 1,
        kind: c.sel.kind,
        market,
        selection,
        probability,
        fairOdds: Math.round((100 / c.p) * 1000) / 1000,
        offeredOdds: Math.round(c.offeredOdds * 100) / 100,
        source: c.source,
        basis: basisText(c),
        explanation,
      };
    }),
  };
}

/* ------------------------------------------------------ other detail pieces */

function mapInjuries(resp, homeId, awayId) {
  const out = { home: [], away: [] };
  const seen = new Set();
  for (const x of Array.isArray(resp) ? resp : []) {
    const tid = Number(x?.team?.id);
    const side = tid === Number(homeId) ? 'home' : tid === Number(awayId) ? 'away' : null;
    const name = x?.player?.name;
    if (!side || !name) continue;
    const key = `${side}|${x.player.id ?? name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const type = String(x.player.type || '').toLowerCase();
    out[side].push({
      name,
      reason: x.player.reason ? String(x.player.reason) : 'Reason not provided',
      status: type.includes('question') ? 'doubtful' : 'out',
    });
  }
  for (const side of ['home', 'away']) {
    out[side].sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'out' ? -1 : 1));
  }
  return out;
}

function pickStandings(resp, homeId, awayId) {
  const groups = resp?.[0]?.league?.standings;
  if (!Array.isArray(groups)) return null;
  const ids = [Number(homeId), Number(awayId)];
  const group = groups.find((g) => Array.isArray(g) && g.some((r) => ids.includes(Number(r?.team?.id))));
  if (!group || !group.length) return null;
  return {
    name: group[0]?.group || null,
    rows: group.map((r) => ({
      rank: r.rank,
      id: r.team?.id,
      name: r.team?.name,
      logo: r.team?.logo,
      played: r.all?.played ?? null,
      won: r.all?.win ?? null,
      draw: r.all?.draw ?? null,
      lose: r.all?.lose ?? null,
      gd: r.goalsDiff ?? null,
      pts: r.points ?? null,
    })),
  };
}

function cornersOf(statsResp, teamId) {
  if (!Array.isArray(statsResp) || statsResp.length < 2) return null;
  const val = (entry) => {
    const s = (entry?.statistics || []).find((x) => String(x.type).toLowerCase() === 'corner kicks');
    return toNumber(s?.value);
  };
  const mine = statsResp.find((e) => Number(e?.team?.id) === Number(teamId));
  const theirs = statsResp.find((e) => Number(e?.team?.id) !== Number(teamId));
  const f = val(mine);
  const a = val(theirs);
  return f === null || a === null ? null : { for: f, against: a };
}

function summariseCorners(list) {
  const ok = list.filter(Boolean);
  if (ok.length < 2) return null;
  const sum = (fn) => ok.reduce((s, x) => s + fn(x), 0);
  return {
    n: ok.length,
    avgFor: round1(sum((x) => x.for) / ok.length),
    avgAgainst: round1(sum((x) => x.against) / ok.length),
    avgTotal: round1(sum((x) => x.for + x.against) / ok.length),
  };
}

/* ---------------------------------------------------------------- report */

function buildReport(input) {
  const {
    homeId, awayId, homeName, awayName,
    homeLast, awayLast, injuries, standings, predictions, odds,
    prematch, failed = [],
  } = input;

  const hAll = toMatches(homeLast, homeId);
  const aAll = toMatches(awayLast, awayId);
  const hs = hAll.slice(0, 10);
  const as = aAll.slice(0, 10);

  const H = homeName || 'Home';
  const A = awayName || 'Away';

  let tipsStatus;
  let tips = [];
  if (!prematch) {
    tipsStatus = 'not_prematch';
  } else {
    const r = buildTips({ H, A, odds, predictions, hs, as });
    tips = r.tips;
    if (tips.length) tipsStatus = 'ok';
    else if (!r.considered && ['odds', 'predictions'].every((k) => failed.includes(k))) tipsStatus = 'unavailable';
    else tipsStatus = 'none';
  }

  return {
    prematch,
    tipsStatus,
    tips,
    recent: { home: recentList(hAll), away: recentList(aAll) },
    goals: { home: goalsSummary(hs), away: goalsSummary(as) },
    venue: { home: venueSummary(hAll, true), away: venueSummary(aAll, false) },
    halftime: { home: halfTimeSummary(hs), away: halfTimeSummary(as) },
    injuries: { available: !failed.includes('injuries'), ...mapInjuries(injuries, homeId, awayId) },
    standings: pickStandings(standings, homeId, awayId),
    corners: {
      home: hAll.slice(0, 5).map((m) => m.id),
      away: aAll.slice(0, 5).map((m) => m.id),
    },
    unavailable: failed,
  };
}

module.exports = {
  THRESHOLD,
  toMatches,
  buildTips,
  buildReport,
  cornersOf,
  summariseCorners,
  oddsCandidates,
  providerCandidates,
};
