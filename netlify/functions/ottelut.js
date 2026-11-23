// EasyBet data endpoint placeholder.
// Keep your existing API-Football integration here when deploying.
// The frontend remains usable as a designed match-centre shell without live data.
exports.handler = async () => ({
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ fixtures: [], message: "Connect your API_FOOTBALL_KEY to enable live fixture data." })
});
