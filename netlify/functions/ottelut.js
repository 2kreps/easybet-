'use strict';

/*
 * Football fixture list (Live / Today / Tomorrow).
 * This is the original, working football integration - same function name, same query
 * parameters (live=all or date=YYYY-MM-DD), same response shape ({ response: [...] }),
 * same API-Football host and the same API_FOOTBALL_KEY environment variable.
 * Additions: optional `tz` (visitor timezone, with automatic fallback if the provider
 * rejects it), de-duplication, league ordering and a larger list limit.
 * Match details live in match.js.
 */

const API = 'https://v3.football.api-sports.io';
const headers = () => ({ 'x-apisports-key': process.env.API_FOOTBALL_KEY || '' });

async function get(path, params = {}) {
  const u = new URL(API + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  });
  const r = await fetch(u, { headers: headers() });
  const j = await r.json();
  if (!r.ok || (j.errors && Object.keys(j.errors).length)) {
    throw new Error(JSON.stringify(j.errors || j.message || 'API request failed'));
  }
  return j.response || [];
}

// Same league whitelist as the original function (order = display priority).
const MAJOR = [
  39,   // Premier League
  140,  // La Liga
  135,  // Serie A
  78,   // Bundesliga
  61,   // Ligue 1
  2,    // UEFA Champions League
  3,    // UEFA Europa League
  848,  // UEFA Conference League
  45,   // FA Cup
  143,  // Copa del Rey
  81,   // DFB-Pokal
  48,   // EFL Cup
  137,  // Coppa Italia
  66,   // Coupe de France
  88,   // Eredivisie
  94    // Primeira Liga
];
const PRIORITY = new Map(MAJOR.map((id, i) => [id, i]));

const json = (statusCode, body, cache) => ({
  statusCode,
  headers: { 'content-type': 'application/json', ...(cache ? { 'cache-control': cache } : {}) },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  try {
    if (!process.env.API_FOOTBALL_KEY) {
      return json(500, { message: 'API_FOOTBALL_KEY is missing in Netlify environment variables.' });
    }
    const q = event.queryStringParameters || {};
    const tz = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(q.tz || '') ? q.tz : '';

    let base;
    if (q.live === 'all') base = { live: 'all' };
    else if (/^\d{4}-\d{2}-\d{2}$/.test(q.date || '')) base = { date: q.date };
    else return json(400, { message: 'Provide date (YYYY-MM-DD) or live=all.' });

    let response;
    if (tz) {
      try {
        response = await get('/fixtures', { ...base, timezone: tz });
      } catch (e) {
        response = await get('/fixtures', base); // provider rejected the timezone -> original behaviour
      }
    } else {
      response = await get('/fixtures', base);
    }

    const seen = new Set();
    response = response
      .filter((f) => PRIORITY.has(Number(f.league?.id)))
      .filter((f) => f.fixture?.id && f.teams?.home?.name && f.teams?.away?.name)
      .filter((f) => !seen.has(f.fixture.id) && seen.add(f.fixture.id))
      .sort(
        (a, b) =>
          PRIORITY.get(Number(a.league.id)) - PRIORITY.get(Number(b.league.id)) ||
          new Date(a.fixture.date) - new Date(b.fixture.date)
      );

    return json(200, { response: response.slice(0, 50) }, 'public, max-age=60');
  } catch (e) {
    return json(502, { message: e.message || 'Football data provider error' });
  }
};
