exports.handler = async (event) => {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return { statusCode: 500, headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "API_FOOTBALL_KEY is not configured in Netlify." }) };
  const params = new URLSearchParams(event.queryStringParameters || {});
  if (!params.has("live") && !params.has("date")) return { statusCode: 400, headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Use live=all or date=YYYY-MM-DD." }) };
  const endpoint = params.has("live") ? "https://v3.football.api-sports.io/fixtures?live=all" : `https://v3.football.api-sports.io/fixtures?date=${encodeURIComponent(params.get("date"))}`;
  try {
    const response = await fetch(endpoint, { headers: { "x-apisports-key": key } });
    const data = await response.json();
    return { statusCode: response.ok ? 200 : response.status, headers: { "content-type": "application/json", "cache-control": "public, max-age=60" }, body: JSON.stringify(data) };
  } catch (error) {
    return { statusCode: 502, headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Could not reach the football data provider." }) };
  }
};
