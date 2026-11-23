exports.handler = async function (event) {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "API_FOOTBALL_KEY is not configured in Netlify." }) };
  }
  const date = event.queryStringParameters?.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { statusCode: 400, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Please provide a date in YYYY-MM-DD format." }) };
  }
  try {
    const response = await fetch(`https://v3.football.api-sports.io/fixtures?date=${encodeURIComponent(date)}`, {
      headers: { "x-apisports-key": apiKey }
    });
    const data = await response.json();
    return {
      statusCode: response.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" },
      body: JSON.stringify(data)
    };
  } catch (error) {
    return { statusCode: 502, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ error: "Unable to fetch football fixtures." }) };
  }
};
