import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
  Circle,
  Tooltip,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { LatLngBoundsExpression, LatLngExpression } from "leaflet";
import { useEffect, useMemo, useRef, useState } from "react";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

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

type RouteCheckpoint = {
  id: string;
  label: string;
  point: Point;
  kind: "camp" | "road" | "jcc";
  visible?: boolean;
  labelOpacity?: number;
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

const ROUTE_CHECKPOINTS: RouteCheckpoint[] = [
  {
    id: "camp",
    label: "Camp",
    point: CAMP_POINT,
    kind: "camp",
    visible: true,
  },
  {
    id: "i80",
    label: "I-80 E",
    point: { lat: 40.8762, lng: -74.6805 },
    kind: "road",
    visible: true,
    labelOpacity: 0.78,
  },
  {
    id: "rt10",
    label: "Rt 10",
    point: { lat: 40.8461, lng: -74.4328 },
    kind: "road",
    visible: true,
    labelOpacity: 0.44,
  },
  {
    id: "mtpleasant",
    label: "Mt Pleasant",
    point: { lat: 40.8038, lng: -74.3498 },
    kind: "road",
    visible: false,
  },
  {
    id: "shrewsbury",
    label: "Shrewsbury",
    point: { lat: 40.7874, lng: -74.3208 },
    kind: "road",
    visible: false,
  },
  {
    id: "northfield",
    label: "Northfield",
    point: { lat: 40.7754, lng: -74.2989 },
    kind: "road",
    visible: true,
    labelOpacity: 0.18,
  },
  {
    id: "jcc",
    label: "JCC",
    point: JCC_POINT,
    kind: "jcc",
    visible: true,
  },
];

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

async function fetchFixedRoute(points: Point[]): Promise<Point[]> {
  const segments = await Promise.all(
    points.slice(0, -1).map((startPoint, index) => {
      const endPoint = points[index + 1];
      return fetchEta(startPoint, endPoint);
    }),
  );

  const merged: Point[] = [];

  segments.forEach((segment, index) => {
    if (segment.routePoints.length === 0) return;

    if (index === 0) {
      merged.push(...segment.routePoints);
      return;
    }

    merged.push(...segment.routePoints.slice(1));
  });

  return merged;
}

function pointDistanceSquared(a: Point, b: Point) {
  const latDiff = a.lat - b.lat;
  const lngDiff = a.lng - b.lng;
  return latDiff * latDiff + lngDiff * lngDiff;
}

function snapPointToRoute(target: Point, routePoints: Point[]) {
  let nearestIndex = 0;
  let nearestPoint = routePoints[0];
  let nearestDistance = pointDistanceSquared(target, routePoints[0]);

  for (let index = 1; index < routePoints.length; index += 1) {
    const routePoint = routePoints[index];
    const distance = pointDistanceSquared(target, routePoint);

    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = index;
      nearestPoint = routePoint;
    }
  }

  return {
    point: nearestPoint,
    index: nearestIndex,
  };
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

function TapBusHandler({
  enabled,
  onTapBus,
}: {
  enabled: boolean;
  onTapBus: (point: Point) => void;
}) {
  useMapEvents({
    click(event) {
      if (!enabled) return;

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
  remainingRoute,
  busPoint,
  userPoint,
}: {
  plannedRoute: Point[];
  remainingRoute: Point[];
  busPoint: Point | null;
  userPoint: Point | null;
}) {
  const map = useMap();

  useEffect(() => {
    const points: Point[] = [SOUTH_ORANGE_POINT, CAMP_POINT, JCC_POINT];

    if (plannedRoute.length > 0) {
      points.push(...plannedRoute);
    }

    if (remainingRoute.length > 0) {
      points.push(...remainingRoute);
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
      paddingTopLeft: [34, 34],
      paddingBottomRight: [34, 330],
      maxZoom: 10,
      animate: true,
    });
  }, [plannedRoute, remainingRoute, busPoint, userPoint, map]);

  return null;
}

function CheckpointMarker({ checkpoint }: { checkpoint: RouteCheckpoint }) {
  if (!checkpoint.visible) return null;

  const isRoad = checkpoint.kind === "road";
  const labelOpacity = checkpoint.labelOpacity ?? 1;

  const radius =
    checkpoint.kind === "camp" ? 9 : checkpoint.kind === "jcc" ? 10 : 3;

  const pathOptions =
    checkpoint.kind === "camp"
      ? {
          color: "#7c2d12",
          fillColor: "#fed7aa",
          fillOpacity: 1,
          opacity: 1,
          weight: 3,
        }
      : checkpoint.kind === "jcc"
        ? {
            color: "#111827",
            fillColor: "#ffffff",
            fillOpacity: 1,
            opacity: 1,
            weight: 4,
          }
        : {
            color: "#0f766e",
            fillColor: "#ccfbf1",
            fillOpacity: 0.35 * labelOpacity,
            opacity: 0.35 * labelOpacity,
            weight: 1,
          };

  const tooltipClassName = isRoad
    ? "checkpointTooltip roadTooltip"
    : "checkpointTooltip";

  return (
    <CircleMarker
      center={[checkpoint.point.lat, checkpoint.point.lng]}
      radius={radius}
      pathOptions={pathOptions}
    >
      <Tooltip
        permanent
        direction="top"
        offset={[0, isRoad ? -5 : -10]}
        opacity={isRoad ? labelOpacity : 1}
        className={tooltipClassName}
      >
        {checkpoint.label}
      </Tooltip>
    </CircleMarker>
  );
}

export default function App() {
  const requestIdRef = useRef(0);

  const [userPoint, setUserPoint] = useState<Point | null>(null);
  const [busPoint, setBusPoint] = useState<Point | null>(null);

  const [plannedRoute, setPlannedRoute] = useState<Point[]>([]);
  const [busEta, setBusEta] = useState<EtaResult | null>(null);
  const [userEta, setUserEta] = useState<EtaResult | null>(null);

  const [routeLoading, setRouteLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [logoLaunching, setLogoLaunching] = useState(false);
  const [error, setError] = useState("");
  const [busRouteStartIndex, setBusRouteStartIndex] = useState<number | null>(
    null,
  );

  const remainingRoute = useMemo(() => {
    if (
      busRouteStartIndex === null ||
      plannedRoute.length === 0 ||
      busRouteStartIndex >= plannedRoute.length
    ) {
      return [];
    }

    return plannedRoute.slice(busRouteStartIndex);
  }, [plannedRoute, busRouteStartIndex]);

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
            new Error("Location blocked. Allow location and tap the route again."),
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

  async function loadFixedRoute() {
    setRouteLoading(true);

    try {
      const route = await fetchFixedRoute(
        ROUTE_CHECKPOINTS.map((checkpoint) => checkpoint.point),
      );

      setPlannedRoute(route);
      setError("");
    } catch {
      setError("Could not load the Deeny route.");
    } finally {
      setRouteLoading(false);
    }
  }

  function resetBus() {
    requestIdRef.current += 1;

    setBusPoint(null);
    setBusEta(null);
    setUserEta(null);
    setBusRouteStartIndex(null);
    setError("");
    setLoading(false);
    setLogoLaunching(false);
  }

  async function handleTapBus(clickedPoint: Point) {
    if (plannedRoute.length === 0) {
      setError("Route is still loading.");
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setLogoLaunching(false);

    window.setTimeout(() => {
      if (requestIdRef.current === requestId) {
        setLogoLaunching(true);
      }
    }, 20);

    window.setTimeout(() => {
      if (requestIdRef.current === requestId) {
        setLogoLaunching(false);
      }
    }, 1250);

    const snapped = snapPointToRoute(clickedPoint, plannedRoute);

    setBusPoint(snapped.point);
    setBusRouteStartIndex(snapped.index);
    setBusEta(null);
    setUserEta(null);
    setError("");
    setLoading(true);

    try {
      const currentUserPoint = userPoint ?? (await getUserLocation());

      if (requestIdRef.current !== requestId) return;

      setUserPoint(currentUserPoint);

      const [nextBusEta, nextUserEta] = await Promise.all([
        fetchEta(snapped.point, JCC_POINT),
        fetchEta(currentUserPoint, JCC_POINT),
      ]);

      if (requestIdRef.current !== requestId) return;

      setBusEta(nextBusEta);
      setUserEta(nextUserEta);
    } catch (err) {
      if (requestIdRef.current !== requestId) return;

      setError(err instanceof Error ? err.message : "Could not calculate ETA.");
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    loadFixedRoute();
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
          maxBoundsViscosity={0.85}
          zoomControl={false}
          className="map"
          dragging={true}
          touchZoom="center"
          doubleClickZoom={true}
          scrollWheelZoom={false}
          boxZoom={false}
          keyboard={false}
          inertia={true}
          inertiaDeceleration={2800}
          inertiaMaxSpeed={900}
          zoomSnap={0.25}
          zoomDelta={0.5}
          preferCanvas={true}
          bounceAtZoomLimits={false}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />

          <TapBusHandler enabled={!routeLoading} onTapBus={handleTapBus} />

          <FitEverythingInView
            plannedRoute={plannedRoute}
            remainingRoute={remainingRoute}
            busPoint={busPoint}
            userPoint={userPoint}
          />

          <Circle
            center={[SOUTH_ORANGE_POINT.lat, SOUTH_ORANGE_POINT.lng]}
            radius={FIFTY_MILE_RADIUS_METERS}
            pathOptions={{
              color: "#0f766e",
              fillColor: "#0f766e",
              fillOpacity: 0.02,
              weight: 1,
              opacity: 0.16,
            }}
          />

          {plannedRoute.length > 0 && (
            <>
              <Polyline
                positions={plannedRoute.map((point) => [point.lat, point.lng])}
                pathOptions={{
                  color: "#0f766e",
                  weight: 11,
                  opacity: 0.1,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />

              <Polyline
                positions={plannedRoute.map((point) => [point.lat, point.lng])}
                pathOptions={{
                  color: "#0f766e",
                  weight: 5,
                  opacity: 0.38,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />
            </>
          )}

          {remainingRoute.length > 0 && (
            <Polyline
              positions={remainingRoute.map((point) => [point.lat, point.lng])}
              pathOptions={{
                color: "#14b8a6",
                weight: 8,
                opacity: 0.92,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          )}

          {ROUTE_CHECKPOINTS.map((checkpoint) => (
            <CheckpointMarker key={checkpoint.id} checkpoint={checkpoint} />
          ))}

          {userPoint && (
            <CircleMarker
              center={[userPoint.lat, userPoint.lng]}
              radius={11}
              pathOptions={{
                color: "#1d4ed8",
                fillColor: "#93c5fd",
                fillOpacity: 1,
                weight: 4,
              }}
            >
              <Tooltip
                permanent
                direction="top"
                offset={[0, -10]}
                className="checkpointTooltip userTooltip"
              >
                You
              </Tooltip>
            </CircleMarker>
          )}

          {busPoint && (
            <CircleMarker
              center={[busPoint.lat, busPoint.lng]}
              radius={13}
              pathOptions={{
                color: "#0f766e",
                fillColor: "#14b8a6",
                fillOpacity: 1,
                weight: 5,
              }}
            >
              <Tooltip
                permanent
                direction="top"
                offset={[0, -12]}
                className="checkpointTooltip busTooltip"
              >
                Bus
              </Tooltip>
            </CircleMarker>
          )}
        </MapContainer>
      </section>

      <section className="panel">
        <div className="panelTop">
          <div className="handle" />

          <button
            type="button"
            className="resetButton"
            onPointerDown={(event) => {
              event.stopPropagation();
            }}
            onTouchStart={(event) => {
              event.stopPropagation();
            }}
            onMouseDown={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              resetBus();
            }}
          >
            Reset
          </button>
        </div>

        <AppLogo loading={loading} launching={logoLaunching} />

        <div className={busPoint ? "statusCard" : "statusCard waiting"}>
          <div className="statusContent">
            {error && (
              <>
                <p className="label danger">Problem</p>
                <p className="mainText">{error}</p>
              </>
            )}

            {!error && routeLoading && (
              <>
                <p className="label">Loading route</p>
                <p className="mainText">Building the fixed Deeny route...</p>
              </>
            )}

            {!error && !routeLoading && loading && (
              <>
                <p className="label">Finding route</p>
                <p className="mainText">
                  Snapping to the route and calculating your leave time...
                </p>
              </>
            )}

            {!error && !routeLoading && !loading && !busPoint && (
              <>
                <p className="label">Ready</p>
                <p className="mainText">
                  Tap where the bus is on the highlighted route.
                </p>
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
