import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "*",
  }),
);

app.use(express.json());

const PORT = Number(process.env.PORT || 3001);

function toNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    app: "DEENYWHEREUAT API",
  });
});

app.get("/eta", async (req, res) => {
  const fromLat = toNumber(req.query.fromLat);
  const fromLng = toNumber(req.query.fromLng);
  const toLat = toNumber(req.query.toLat);
  const toLng = toNumber(req.query.toLng);

  if (
    fromLat === null ||
    fromLng === null ||
    toLat === null ||
    toLng === null
  ) {
    res.status(400).json({
      error: "fromLat, fromLng, toLat, and toLng are required numbers",
    });
    return;
  }

  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${fromLng},${fromLat};${toLng},${toLat}` +
    `?overview=full&geometries=geojson`;

  try {
    const etaResponse = await fetch(url);

    if (!etaResponse.ok) {
      res.status(502).json({ error: "ETA provider failed" });
      return;
    }

    const data = await etaResponse.json();

    if (!data.routes || data.routes.length === 0) {
      res.status(404).json({ error: "No route found" });
      return;
    }

    const route = data.routes[0];

    const routePoints = route.geometry.coordinates.map(
      ([lng, lat]: [number, number]) => ({
        lat,
        lng,
      }),
    );

    res.json({
      durationSeconds: Math.round(route.duration),
      durationMinutes: Math.round(route.duration / 60),
      distanceMeters: Math.round(route.distance),
      distanceMiles: Number((route.distance / 1609.344).toFixed(2)),
      routePoints,
    });
  } catch {
    res.status(500).json({
      error: "Could not calculate ETA",
    });
  }
});

app.listen(PORT, () => {
  console.log(`DEENYWHEREUAT API running on http://localhost:${PORT}`);
});
