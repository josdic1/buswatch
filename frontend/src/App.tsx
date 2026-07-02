import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Polyline,
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

type AudioWindow = Window &
  typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
  };

type VibratingNavigator = Navigator & {
  vibrate?: (pattern: number | number[]) => boolean;
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
    id: "i80-entry",
    label: "I-80 E",
    point: { lat: 40.8839, lng: -74.7069 },
    kind: "road",
    visible: true,
    labelOpacity: 0.82,
  },
  {
    id: "wharton",
    label: "Wharton",
    point: { lat: 40.8986, lng: -74.5827 },
    kind: "road",
    visible: false,
  },
  {
    id: "rockaway",
    label: "Rockaway",
    point: { lat: 40.9004, lng: -74.5128 },
    kind: "road",
    visible: false,
  },
  {
    id: "denville",
    label: "Denville",
    point: { lat: 40.8881, lng: -74.4708 },
    kind: "road",
    visible: false,
  },
  {
    id: "parsippany",
    label: "Parsippany",
    point: { lat: 40.8637, lng: -74.3927 },
    kind: "road",
    visible: false,
  },
  {
    id: "i280",
    label: "I-280 E",
    point: { lat: 40.8458, lng: -74.3498 },
    kind: "road",
    visible: true,
    labelOpacity: 0.46,
  },
  {
    id: "northfield",
    label: "Northfield",
    point: { lat: 40.7808, lng: -74.2944 },
    kind: "road",
    visible: true,
    labelOpacity: 0.22,
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

function formatCountdown(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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
    const points: Point[] = [CAMP_POINT, JCC_POINT];

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
    checkpoint.kind === "camp" ? 9 : checkpoint.kind === "jcc" ? 10 : 4;

  const pathOptions =
    checkpoint.kind === "camp"
      ? {
          color: "#f97316",
          fillColor: "#fed7aa",
          fillOpacity: 1,
          opacity: 1,
          weight: 3,
        }
      : checkpoint.kind === "jcc"
        ? {
            color: "#f8fafc",
            fillColor: "#0f172a",
            fillOpacity: 1,
            opacity: 1,
            weight: 4,
          }
        : {
            color: "#5eead4",
            fillColor: "#5eead4",
            fillOpacity: 0.6 * labelOpacity,
            opacity: 0.5 * labelOpacity,
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
        offset={[0, isRoad ? -6 : -10]}
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
  const leaveAlertTimerRef = useRef<number | null>(null);
  const alarmIntervalRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const [userPoint, setUserPoint] = useState<Point | null>(null);
  const [busPoint, setBusPoint] = useState<Point | null>(null);

  const [plannedRoute, setPlannedRoute] = useState<Point[]>([]);
  const [busEta, setBusEta] = useState<EtaResult | null>(null);
  const [userEta, setUserEta] = useState<EtaResult | null>(null);

  const [routeLoading, setRouteLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [logoLaunching, setLogoLaunching] = useState(false);
  const [error, setError] = useState("");
  const [alertStatus, setAlertStatus] = useState("");
  const [alertTargetTimeMs, setAlertTargetTimeMs] = useState<number | null>(
    null,
  );
  const [alertCountdownSeconds, setAlertCountdownSeconds] = useState<
    number | null
  >(null);
  const [alarmActive, setAlarmActive] = useState(false);
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

  async function primeAlarmAudio() {
    const audioWindow = window as AudioWindow;
    const AudioContextConstructor =
      audioWindow.AudioContext || audioWindow.webkitAudioContext;

    if (!AudioContextConstructor) return;

    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContextConstructor();
    }

    if (audioContextRef.current.state === "suspended") {
      await audioContextRef.current.resume();
    }
  }

  function vibrateAlarm() {
    const vibratingNavigator = navigator as VibratingNavigator;
    vibratingNavigator.vibrate?.([500, 180, 500, 180, 700]);
  }

  function playBeep() {
    const audioContext = audioContextRef.current;

    if (!audioContext) return;

    if (audioContext.state === "suspended") {
      audioContext.resume();
    }

    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const now = audioContext.currentTime;

    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(880, now);
    oscillator.frequency.setValueAtTime(660, now + 0.18);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.32, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.46);

    oscillator.connect(gain);
    gain.connect(audioContext.destination);

    oscillator.start(now);
    oscillator.stop(now + 0.5);
  }

  function stopAlarmSound() {
    if (alarmIntervalRef.current !== null) {
      window.clearInterval(alarmIntervalRef.current);
      alarmIntervalRef.current = null;
    }
  }

  function startAlarmSound() {
    stopAlarmSound();

    playBeep();
    vibrateAlarm();

    alarmIntervalRef.current = window.setInterval(() => {
      playBeep();
      vibrateAlarm();
    }, 1100);
  }

  function clearLeaveAlert() {
    if (leaveAlertTimerRef.current !== null) {
      window.clearTimeout(leaveAlertTimerRef.current);
      leaveAlertTimerRef.current = null;
    }

    stopAlarmSound();
    setAlertTargetTimeMs(null);
    setAlertCountdownSeconds(null);
    setAlarmActive(false);
    setAlertStatus("");
  }

  function stopLeaveAlarm() {
    stopAlarmSound();
    setAlarmActive(false);
    setAlertTargetTimeMs(null);
    setAlertCountdownSeconds(null);
    setAlertStatus("Alarm stopped.");
  }

  async function requestNotificationPermission() {
    if (!("Notification" in window)) return false;

    if (Notification.permission === "granted") return true;

    if (Notification.permission === "denied") return false;

    const permission = await Notification.requestPermission();
    return permission === "granted";
  }

  function fireLeaveAlarm() {
    leaveAlertTimerRef.current = null;
    setAlertTargetTimeMs(null);
    setAlertCountdownSeconds(0);
    setAlarmActive(true);
    setAlertStatus("Leave alarm firing.");

    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Leave now", {
        body: "Deeny bus timing says it’s time to go.",
        icon: "/logo.png",
      });
    }

    startAlarmSound();
  }

  async function scheduleLeaveAlarm() {
    if (leaveInMinutes === null) return;

    await primeAlarmAudio();
    await requestNotificationPermission();

    if (leaveAlertTimerRef.current !== null) {
      window.clearTimeout(leaveAlertTimerRef.current);
      leaveAlertTimerRef.current = null;
    }

    stopAlarmSound();
    setAlarmActive(false);

    const safeLeaveInMinutes = Math.max(0, leaveInMinutes);
    const delayMs = safeLeaveInMinutes * 60 * 1000;
    const targetTimeMs = Date.now() + delayMs;

    setAlertTargetTimeMs(targetTimeMs);
    setAlertCountdownSeconds(Math.ceil(delayMs / 1000));
    setAlertStatus(
      safeLeaveInMinutes <= 0
        ? "Alarm firing now."
        : `Alarm set for ${safeLeaveInMinutes} min.`,
    );

    leaveAlertTimerRef.current = window.setTimeout(() => {
      fireLeaveAlarm();
    }, delayMs);
  }

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
    clearLeaveAlert();

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

    clearLeaveAlert();

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

    return () => {
      if (leaveAlertTimerRef.current !== null) {
        window.clearTimeout(leaveAlertTimerRef.current);
      }

      stopAlarmSound();
    };
  }, []);

  useEffect(() => {
    if (alertTargetTimeMs === null || alarmActive) return;

    const updateCountdown = () => {
      const secondsLeft = Math.max(
        0,
        Math.ceil((alertTargetTimeMs - Date.now()) / 1000),
      );

      setAlertCountdownSeconds(secondsLeft);
    };

    updateCountdown();

    const countdownInterval = window.setInterval(updateCountdown, 1000);

    return () => {
      window.clearInterval(countdownInterval);
    };
  }, [alertTargetTimeMs, alarmActive]);

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
            attribution="&copy; OpenStreetMap contributors &copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />

          <TapBusHandler enabled={!routeLoading} onTapBus={handleTapBus} />

          <FitEverythingInView
            plannedRoute={plannedRoute}
            remainingRoute={remainingRoute}
            busPoint={busPoint}
            userPoint={userPoint}
          />

          {plannedRoute.length > 0 && (
            <>
              <Polyline
                positions={plannedRoute.map((point) => [point.lat, point.lng])}
                pathOptions={{
                  color: "#1e1b4b",
                  weight: 11,
                  opacity: 0.88,
                  lineCap: "round",
                  lineJoin: "round",
                }}
              />

              <Polyline
                positions={plannedRoute.map((point) => [point.lat, point.lng])}
                pathOptions={{
                  color: "#4338ca",
                  weight: 6,
                  opacity: 0.96,
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
                color: "#22c55e",
                weight: 8,
                opacity: 1,
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
                color: "#ffffff",
                fillColor: "#3b82f6",
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
                color: "#ffffff",
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

      {alarmActive && (
        <section className="alarmOverlay" role="alert">
          <div className="alarmCard">
            <p className="alarmKicker">DEENYWHEREUAT</p>
            <h1>LEAVE NOW</h1>
            <p>The bus timing says it is time to go.</p>

            <button
              type="button"
              className="stopAlarmButton"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                stopLeaveAlarm();
              }}
            >
              Stop alarm
            </button>
          </div>
        </section>
      )}

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

                {alertTargetTimeMs !== null &&
                  alertCountdownSeconds !== null &&
                  !alarmActive && (
                    <div className="alertCountdown">
                      <span>Alarm in</span>
                      <strong>{formatCountdown(alertCountdownSeconds)}</strong>
                    </div>
                  )}

                {leaveInMinutes !== null &&
                  leaveInMinutes > 0 &&
                  alertTargetTimeMs === null &&
                  !alarmActive && (
                    <button
                      type="button"
                      className="notifyButton"
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
                        scheduleLeaveAlarm();
                      }}
                    >
                      Start loud leave alarm
                    </button>
                  )}

                {alertTargetTimeMs !== null && !alarmActive && (
                  <button
                    type="button"
                    className="cancelAlertButton"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      clearLeaveAlert();
                    }}
                  >
                    Cancel alarm
                  </button>
                )}

                {alertStatus && <p className="alertStatus">{alertStatus}</p>}
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}
