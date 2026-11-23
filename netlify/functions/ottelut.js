function reply(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }, body: JSON.stringify(body) };
}
exports.handler = async function (event) {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return reply(500, { error: "API_FOOTBALL_KEY puuttuu Netlifyn Functions-ympäristöstä." });
  const date = event.queryStringParameters?.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return reply(400, { error: "Virheellinen päivämäärä." });
  try {
    const res = await fetch(`https://v3.football.api-sports.io/fixtures?date=${date}&timezone=Europe%2FHelsinki`, { headers: { "x-apisports-key": key } });
    const data = await res.json();
    if (!res.ok || (data.errors && Object.keys(data.errors).length)) return reply(502, { error: "API-Football-virhe. Tarkista avain ja käyttöraja." });
    return reply(200, Array.isArray(data.response) ? data.response : []);
  } catch { return reply(502, { error: "Ottelupalveluun ei saatu yhteyttä." }); }
};