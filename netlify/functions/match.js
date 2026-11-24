'use strict';

/*
 * Match Centre data for one football fixture.
 *   GET /.netlify/functions/match?id=…&home=…&away=…&league=…&season=…&status=…&hn=…&an=…
 *   GET /.netlify/functions/match?part=corners&home=…&away=…&h=id,id,…&a=id,id,…
 * The API key is read from the Netlify environment variable API_FOOTBALL_KEY only.
 */

const { buildReport, cornersOf, summariseCorners } = require('./_lib/analysis');

const API = 'https://v3.football.api-sports.io';
const PREMATCH = new Set(['NS', 'TBD']);
const isId = (v) => /^\d{1,12}$/.test(String(v || ''));
const cleanName = (v) =>
  String(v || '')
    .replace(/[^\p{L}\p{N} .'&-]/gu, '')
    .trim()
    .slice(0, 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, params = {}, retry = true) {
  const u = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  });
  const r = await fetch(u, { headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY || '' } });
  const j = await r.json();
  const errors = j.errors && !Array.isArray(j.errors) ? j.errors : {};
  if (retry && (r.status === 429 || errors.rateLimit)) {
    await sleep(1200);
    return get(path, params, false);
  }
  if (!r.ok || Object.keys(errors).length) {
    throw new Error(JSON.stringify(Object.keys(errors).length ? errors : j.message || 'API request failed'));
  }
  return j.response || [];
}

// Recent matches: try `last`, then fall back to the team's season fixtures
// (some API plans reject the `last` parameter).
async function lastMatches(team, season) {
  const attempts = [
    () => get('/fixtures', { team, last: 20 }),
    () => get('/fixtures', { team, last: 10 }),
    () => get('/fixtures', { team, season }),
  ];
  let lastErr;
  for (const attempt of attempts) {
    try {
      const r = await attempt();
      if (r.length) return r;
    } catch (e) {
      lastErr = e;
    }
  }
  if (lastErr) throw lastErr;
  return [];
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const reply = (statusCode, body, cache) => ({
  statusCode,
  headers: {
    'content-type': 'application/json',
    ...(cache
      ? {
          'cache-control': 'public, max-age=60',
          'netlify-cdn-cache-control': `public, s-maxage=${cache}, stale-while-revalidate=300`,
        }
      : { 'cache-control': 'no-store' }),
  },
  body: JSON.stringify(body),
});

async function cornersPart(q) {
  if (!isId(q.home) || !isId(q.away)) return reply(400, { message: 'home and away team ids are required.' });
  const ids = (s) =>
    String(s || '')
      .split(',')
      .map((x) => x.trim())
      .filter(isId)
      .slice(0, 5);
  const hIds = ids(q.h);
  const aIds = ids(q.a);

  const fetchOne = (id) => get('/fixtures/statistics', { fixture: id }).catch(() => null);
  const [hStats, aStats] = await Promise.all([mapLimit(hIds, 5, fetchOne), mapLimit(aIds, 5, fetchOne)]);

  return reply(
    200,
    {
      home: summariseCorners(hStats.map((s) => cornersOf(s, q.home))),
      away: summariseCorners(aStats.map((s) => cornersOf(s, q.away))),
    },
    3600
  );
}

async function detailPart(q) {
  if (!isId(q.id)) return reply(400, { message: 'A valid fixture id is required.' });

  let fixture = null;
  let { home, away, league, season, status } = q;
  let homeName = cleanName(q.hn);
  let awayName = cleanName(q.an);

  const complete = isId(home) && isId(away) && isId(league) && /^\d{4}$/.test(season || '') && /^[A-Z0-9]{1,5}$/.test(status || '');
  if (!complete || q.info === '1') {
    const r = await get('/fixtures', { id: q.id });
    fixture = r[0] || null;
    if (!fixture) return reply(404, { message: 'Fixture not found.' });
    home = fixture.teams.home.id;
    away = fixture.teams.away.id;
    league = fixture.league.id;
    season = fixture.league.season;
    status = fixture.fixture.status.short;
    homeName = fixture.teams.home.name;
    awayName = fixture.teams.away.name;
  }

  const prematch = PREMATCH.has(status);
  const failed = [];
  const errors = {};
  const run = (name, promise) =>
    promise.catch((e) => {
      failed.push(name);
      errors[name] = String((e && e.message) || e).slice(0, 200);
      return null;
    });

  const [homeLast, awayLast, injuries, standings, predictions, odds] = await Promise.all([
    run('homeLast', lastMatches(home, season)),
    run('awayLast', lastMatches(away, season)),
    run('injuries', get('/injuries', { fixture: q.id })),
    run('standings', get('/standings', { league, season })),
    prematch ? run('predictions', get('/predictions', { fixture: q.id })) : null,
    prematch ? run('odds', get('/odds', { fixture: q.id })) : null,
  ]);

  const report = buildReport({
    homeId: Number(home),
    awayId: Number(away),
    homeName,
    awayName,
    homeLast: homeLast || [],
    awayLast: awayLast || [],
    injuries: injuries || [],
    standings: standings || [],
    predictions: predictions || [],
    odds: odds || [],
    prematch,
    failed,
  });

  return reply(200, { fixture, ...report, errors }, failed.length ? 0 : prematch ? 600 : 120);
}

exports.handler = async (event) => {
  try {
    if (!process.env.API_FOOTBALL_KEY) {
      return reply(500, { message: 'API_FOOTBALL_KEY is missing in Netlify environment variables.' });
    }
    const q = event.queryStringParameters || {};
    return q.part === 'corners' ? await cornersPart(q) : await detailPart(q);
  } catch (e) {
    return reply(502, { message: e.message || 'Football data provider error' });
  }
};
