import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Circle,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import { useEffect, useMemo, useState } from "react";

const API_URL = "http://localhost:3001";

type Point = {
  lat: number;
  lng: number;
};

type EtaResult = {
  durationSeconds: number;
  durationMinutes: number;
  distanceMeters: number;
  distanceMiles: number;
  routePoints: Point[];
};

const SOUTH_ORANGE_POINT: Point = {
  lat: 40.7489,
  lng: -74.2613,
};

const CAMP_POINT: Point = {
  lat: 40.8479,
  lng: -74.7096,
};

const JCC_POINT: Point = {
  lat: 40.7697,
  lng: -74.2916,
};

const DEFAULT_CENTER: LatLngExpression = [
  SOUTH_ORANGE_POINT.lat,
  SOUTH_ORANGE_POINT.lng,
];

const FIFTY_MILE_RADIUS_METERS = 50 * 1609.344;

const NORTH_JERSEY_BOUNDS: LatLngBoundsExpression = [
  [40.02, -75.22],
  [41.48, -73.3],
];

const EXTRA_CUSHION_MINUTES = 5;

async function fetchEta(from: Point, to: Point): Promise<EtaResult> {
  const params = new URLSearchParams({
    fromLat: String(from.lat),
    fromLng: String(from.lng),
    toLat: String(to.lat),
    toLng: String(to.lng),
  });

  const res = await fetch(`${API_URL}/eta?${params}`);

  if (!res.ok) {
    throw new Error("ETA failed");
  }

  return res.json();
}

function AppLogo({
  loading,
  launching,
}: {
  loading: boolean;
  launching: boolean;
}) {
  const className = [
    "logoBox",
    loading ? "loading" : "",
    launching ? "launching" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <img src="/logo.png" alt="Deeny WhereUAt" className="appLogo" />
    </div>
  );
}

function TapBusHandler({ onTapBus }: { onTapBus: (point: Point) => void }) {
  useMapEvents({
    click(event) {
      onTapBus({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
      });
    },
  });

  return null;
}

function FitEverythingInView({
  plannedRoute,
  busEta,
  userEta,
  busPoint,
  userPoint,
}: {
  plannedRoute: Point[];
  busEta: EtaResult | null;
  userEta: EtaResult | null;
  busPoint: Point | null;
  userPoint: Point | null;
}) {
  const map = useMap();

  useEffect(() => {
    const points: Point[] = [SOUTH_ORANGE_POINT, CAMP_POINT, JCC_POINT];

    if (plannedRoute.length > 0) {
      points.push(...plannedRoute);
    }

    if (busEta && busEta.routePoints.length > 0) {
      points.push(...busEta.routePoints);
    }

    if (userEta && userEta.routePoints.length > 0) {
      points.push(...userEta.routePoints);
    }

    if (busPoint) {
      points.push(busPoint);
    }

    if (userPoint) {
      points.push(userPoint);
    }

    const bounds = points.map((point) => [
      point.lat,
      point.lng,
    ] as [number, number]);

    map.fitBounds(bounds, {
      paddingTopLeft: [36, 36],
      paddingBottomRight: [36, 255],
      maxZoom: 10,
      animate: true,
    });
  }, [plannedRoute, busEta, userEta, busPoint, userPoint, map]);

  return null;
}

export default function App() {
  const [userPoint, setUserPoint] = useState<Point | null>(null);
  const [busPoint, setBusPoint] = useState<Point | null>(null);

  const [plannedRoute, setPlannedRoute] = useState<Point[]>([]);
  const [busEta, setBusEta] = useState<EtaResult | null>(null);
  const [userEta, setUserEta] = useState<EtaResult | null>(null);

  const [loading, setLoading] = useState(false);
  const [logoLaunching, setLogoLaunching] = useState(false);
  const [error, setError] = useState("");

  const leaveInMinutes = useMemo(() => {
    if (!busEta || !userEta) return null;

    return (
      busEta.durationMinutes -
      userEta.durationMinutes -
      EXTRA_CUSHION_MINUTES
    );
  }, [busEta, userEta]);

  async function getUserLocation(): Promise<Point> {
    if (!navigator.geolocation) {
      throw new Error("Location is not available in this browser.");
    }

    return new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          resolve({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        () => {
          reject(
            new Error("Location blocked. Allow location and tap the bus again."),
          );
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 30000,
        },
      );
    });
  }

  async function loadPlannedRoute() {
    try {
      const data = await fetchEta(CAMP_POINT, JCC_POINT);
      setPlannedRoute(data.routePoints);
    } catch {
      setError("Could not load the Deeny-to-JCC route.");
    }
  }

  function resetBus() {
    setBusPoint(null);
    setBusEta(null);
    setUserEta(null);
    setError("");
    setLoading(false);
    setLogoLaunching(false);
  }

  async function handleTapBus(point: Point) {
    setLogoLaunching(false);

    window.setTimeout(() => {
      setLogoLaunching(true);
    }, 20);

    window.setTimeout(() => {
      setLogoLaunching(false);
    }, 1250);

    setBusPoint(point);
    setBusEta(null);
    setUserEta(null);
    setError("");
    setLoading(true);

    try {
      const currentUserPoint = userPoint ?? (await getUserLocation());

      setUserPoint(currentUserPoint);

      const [nextBusEta, nextUserEta] = await Promise.all([
        fetchEta(point, JCC_POINT),
        fetchEta(currentUserPoint, JCC_POINT),
      ]);

      setBusEta(nextBusEta);
      setUserEta(nextUserEta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not calculate ETA.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPlannedRoute();
  }, []);

  return (
    <main className="app">
      <section className="mapShell">
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={9}
          minZoom={8}
          maxZoom={17}
          maxBounds={NORTH_JERSEY_BOUNDS}
          maxBoundsViscosity={0.7}
          zoomControl={false}
          className="map"
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <TapBusHandler onTapBus={handleTapBus} />

          <FitEverythingInView
            plannedRoute={plannedRoute}
            busEta={busEta}
            userEta={userEta}
            busPoint={busPoint}
            userPoint={userPoint}
          />

          <Circle
            center={[SOUTH_ORANGE_POINT.lat, SOUTH_ORANGE_POINT.lng]}
            radius={FIFTY_MILE_RADIUS_METERS}
            pathOptions={{
              color: "#0f766e",
              fillColor: "#0f766e",
              fillOpacity: 0.035,
              weight: 2,
              opacity: 0.35,
            }}
          />

          {plannedRoute.length > 0 && (
            <Polyline
              positions={plannedRoute.map((point) => [point.lat, point.lng])}
              pathOptions={{
                color: "#111827",
                weight: 4,
                opacity: 0.18,
              }}
            />
          )}

          {userEta && userEta.routePoints.length > 0 && (
            <Polyline
              positions={userEta.routePoints.map((point) => [
                point.lat,
                point.lng,
              ])}
              pathOptions={{
                color: "#2563eb",
                weight: 5,
                opacity: 0.58,
              }}
            />
          )}

          {busEta && busEta.routePoints.length > 0 && (
            <Polyline
              positions={busEta.routePoints.map((point) => [
                point.lat,
                point.lng,
              ])}
              pathOptions={{
                color: "#0f766e",
                weight: 8,
                opacity: 0.95,
              }}
            />
          )}

          <CircleMarker
            center={[SOUTH_ORANGE_POINT.lat, SOUTH_ORANGE_POINT.lng]}
            radius={8}
            pathOptions={{
              color: "#0f766e",
              fillColor: "#ccfbf1",
              fillOpacity: 1,
              weight: 3,
            }}
          />

          <CircleMarker
            center={[CAMP_POINT.lat, CAMP_POINT.lng]}
            radius={11}
            pathOptions={{
              color: "#7c2d12",
              fillColor: "#fed7aa",
              fillOpacity: 1,
              weight: 4,
            }}
          />

          <CircleMarker
            center={[JCC_POINT.lat, JCC_POINT.lng]}
            radius={12}
            pathOptions={{
              color: "#111827",
              fillColor: "#ffffff",
              fillOpacity: 1,
              weight: 4,
            }}
          />

          {userPoint && (
            <CircleMarker
              center={[userPoint.lat, userPoint.lng]}
              radius={12}
              pathOptions={{
                color: "#1d4ed8",
                fillColor: "#93c5fd",
                fillOpacity: 1,
                weight: 4,
              }}
            />
          )}

          {busPoint && (
            <CircleMarker
              center={[busPoint.lat, busPoint.lng]}
              radius={14}
              pathOptions={{
                color: "#0f766e",
                fillColor: "#14b8a6",
                fillOpacity: 1,
                weight: 5,
              }}
            />
          )}
        </MapContainer>
      </section>

      <section className="panel">
        <div className="handle" />

        <button className="resetButton" onClick={resetBus}>
          Reset
        </button>

        <AppLogo loading={loading} launching={logoLaunching} />

        <div className={busPoint ? "statusCard" : "statusCard waiting"}>
          <div className="statusContent">
            {error && (
              <>
                <p className="label danger">Problem</p>
                <p className="mainText">{error}</p>
              </>
            )}

            {!error && loading && (
              <>
                <p className="label">Finding route</p>
                <p className="mainText">
                  Fitting bus, you, camp, and JCC on one screen...
                </p>
              </>
            )}

            {!error && !loading && !busPoint && (
              <>
                <p className="label">Ready</p>
                <p className="mainText">Tap the bus location.</p>
              </>
            )}

            {!error && !loading && busEta && userEta && (
              <>
                <p className="label">Bus ETA to JCC</p>

                <div className="etaNumber">{busEta.durationMinutes} min</div>

                <div className="stats">
                  <div>
                    <span>You to JCC</span>
                    <strong>{userEta.durationMinutes} min</strong>
                  </div>

                  <div>
                    <span>Cushion</span>
                    <strong>{EXTRA_CUSHION_MINUTES} min</strong>
                  </div>
                </div>

                <div
                  className={
                    leaveInMinutes !== null && leaveInMinutes <= 0
                      ? "leaveNow"
                      : "leaveSoon"
                  }
                >
                  {leaveInMinutes !== null && leaveInMinutes <= 0
                    ? "Leave now"
                    : `Leave in ${leaveInMinutes} min`}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
