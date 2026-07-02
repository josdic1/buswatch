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
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
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
  fitVersion,
  plannedRoute,
  remainingRoute,
  busPoint,
  userPoint,
}: {
  fitVersion: number;
  plannedRoute: Point[];
  remainingRoute: Point[];
  busPoint: Point | null;
  userPoint: Point | null;
}) {
  const map = useMap();
  const lastFitVersionRef = useRef(-1);

  useEffect(() => {
    // Only refit when explicitly asked. Never fight the user's fingers.
    if (fitVersion === lastFitVersionRef.current) return;
    lastFitVersionRef.current = fitVersion;

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

    const bounds = points.map(
      (point) => [point.lat, point.lng] as [number, number],
    );

    map.fitBounds(bounds, {
      paddingTopLeft: [34, 34],
      paddingBottomRight: [34, 330],
      maxZoom: 10,
      animate: true,
    });
  }, [fitVersion, plannedRoute, remainingRoute, busPoint, userPoint, map]);

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

  // Alarm machinery. No magic:
  // - audioContextRef: created + resumed on the button tap (iOS requires a user gesture)
  // - sirenStopRef: function that kills the siren + vibration loop
  // - wakeLockRef: keeps the screen on while the alarm is armed
  const audioContextRef = useRef<AudioContext | null>(null);
  const sirenStopRef = useRef<(() => void) | null>(null);
  const wakeLockRef = useRef<any>(null);

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
  const [busRouteStartIndex, setBusRouteStartIndex] = useState<number | null>(
    null,
  );
  const [fitVersion, setFitVersion] = useState(0);

  // Alarm state: target timestamp, live countdown, and whether it's ringing
  const [alarmTargetMs, setAlarmTargetMs] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [alarmFiring, setAlarmFiring] = useState(false);

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
      busEta.durationMinutes - userEta.durationMinutes - EXTRA_CUSHION_MINUTES
    );
  }, [busEta, userEta]);

  function refitMap() {
    setFitVersion((version) => version + 1);
  }

  // ---------- Alarm: audio ----------

  function unlockAudio() {
    if (!audioContextRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;

      if (!Ctx) return;

      audioContextRef.current = new Ctx();
    }

    // resume() inside a tap handler is what unlocks audio on iOS
    audioContextRef.current.resume();
  }

  function startSiren() {
    const ctx = audioContextRef.current;
    if (!ctx) return null;

    ctx.resume();

    const gain = ctx.createGain();
    gain.gain.value = 0.5;
    gain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 880;
    osc.connect(gain);
    osc.start();

    // Two-tone siren: flip pitch every 350ms
    let high = true;
    const pitchTimer = window.setInterval(() => {
      high = !high;
      osc.frequency.setValueAtTime(high ? 880 : 620, ctx.currentTime);
    }, 350);

    // Re-fire vibration every second so it keeps buzzing
    const vibrateTimer = window.setInterval(() => {
      navigator.vibrate?.([350, 120, 350]);
    }, 1000);

    navigator.vibrate?.([350, 120, 350]);

    return () => {
      window.clearInterval(pitchTimer);
      window.clearInterval(vibrateTimer);
      navigator.vibrate?.(0);
      osc.stop();
      osc.disconnect();
      gain.disconnect();
    };
  }

  // ---------- Alarm: wake lock ----------

  async function requestWakeLock() {
    try {
      const wakeLockApi = (navigator as any).wakeLock;
      if (!wakeLockApi) return;

      wakeLockRef.current = await wakeLockApi.request("screen");
    } catch {
      // Wake lock denied (low battery mode, etc). Alarm still works
      // as long as the screen stays on.
    }
  }

  function releaseWakeLock() {
    if (wakeLockRef.current) {
      wakeLockRef.current.release?.();
      wakeLockRef.current = null;
    }
  }

  // ---------- Alarm: lifecycle ----------

  function fireAlarm() {
    setAlarmFiring(true);
    setAlertStatus("");

    sirenStopRef.current?.();
    sirenStopRef.current = startSiren();

    // Best-effort notification. On iOS Safari this usually won't show
    // unless the app is installed to the home screen — the siren and
    // overlay are the real alarm.
    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("Leave now", {
          body: "Deeny bus timing says it’s time to go.",
          icon: "/logo.png",
        });
      } catch {
        // fine, overlay + siren carry it
      }
    }
  }

  function dismissAlarm() {
    sirenStopRef.current?.();
    sirenStopRef.current = null;

    setAlarmFiring(false);
    setAlarmTargetMs(null);
    setSecondsLeft(null);
    setAlertStatus("");
    releaseWakeLock();
  }

  function cancelAlarm() {
    dismissAlarm();
  }

  function setLeaveAlarm() {
    if (leaveInMinutes === null) return;

    // This runs inside the tap = our one chance to unlock audio on iOS
    unlockAudio();

    // Ask for notification permission as a bonus, don't block on it
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    const safeLeaveInMinutes = Math.max(0, leaveInMinutes);

    if (safeLeaveInMinutes <= 0) {
      fireAlarm();
      return;
    }

    requestWakeLock();
    setAlarmTargetMs(Date.now() + safeLeaveInMinutes * 60 * 1000);
    setAlertStatus("Keep the app open — screen will stay awake.");
  }

  // Countdown ticker. Computes from Date.now() every tick, so even if
  // iOS throttles the interval, the remaining time is always correct.
  useEffect(() => {
    if (alarmTargetMs === null) return;

    let fired = false;

    const tick = () => {
      const remaining = Math.ceil((alarmTargetMs - Date.now()) / 1000);

      if (remaining <= 0) {
        if (!fired) {
          fired = true;
          setSecondsLeft(0);
          setAlarmTargetMs(null);
          fireAlarm();
        }
        return;
      }

      setSecondsLeft(remaining);
    };

    tick();
    const interval = window.setInterval(tick, 250);

    return () => {
      window.clearInterval(interval);
    };
  }, [alarmTargetMs]);

  // iOS drops the wake lock when you background the tab. Re-grab it
  // when the user comes back and the alarm is still armed.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && alarmTargetMs !== null) {
        requestWakeLock();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [alarmTargetMs]);

  // ---------- Existing app logic ----------

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
            new Error(
              "Location blocked. Allow location and tap the route again.",
            ),
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
      refitMap();
    } catch {
      setError("Could not load the Deeny route.");
    } finally {
      setRouteLoading(false);
    }
  }

  function resetBus() {
    requestIdRef.current += 1;
    dismissAlarm();

    setBusPoint(null);
    setBusEta(null);
    setUserEta(null);
    setBusRouteStartIndex(null);
    setError("");
    setLoading(false);
    setLogoLaunching(false);
    refitMap();
  }

  async function handleTapBus(clickedPoint: Point) {
    if (plannedRoute.length === 0) {
      setError("Route is still loading.");
      return;
    }

    dismissAlarm();

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
      refitMap();
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
      sirenStopRef.current?.();
      releaseWakeLock();
    };
  }, []);

  const alarmArmed = alarmTargetMs !== null && secondsLeft !== null;

  return (
    <main className="app">
      <section className="mapShell">
        <MapContainer
          center={DEFAULT_CENTER}
          zoom={9}
          minZoom={8}
          maxZoom={17}
          maxBounds={NORTH_JERSEY_BOUNDS}
          maxBoundsViscosity={0.4}
          zoomControl={false}
          className="map"
          touchZoom={true}
          scrollWheelZoom={true}
          boxZoom={false}
          keyboard={false}
          zoomSnap={0.25}
          zoomDelta={0.5}
          bounceAtZoomLimits={false}
        >
          <TileLayer
            attribution="&copy; OpenStreetMap contributors &copy; CARTO"
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />

          <TapBusHandler enabled={!routeLoading} onTapBus={handleTapBus} />

          <FitEverythingInView
            fitVersion={fitVersion}
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

                {leaveInMinutes !== null &&
                  leaveInMinutes > 0 &&
                  !alarmArmed &&
                  !alarmFiring && (
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
                        setLeaveAlarm();
                      }}
                    >
                      Alert me when to leave
                    </button>
                  )}

                {alarmArmed && (
                  <div className="countdownBox">
                    <div className="countdownInfo">
                      <span>Alarm in</span>
                      <strong>{formatCountdown(secondsLeft)}</strong>
                    </div>

                    <button
                      type="button"
                      className="countdownCancel"
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
                        cancelAlarm();
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {alertStatus && <p className="alertStatus">{alertStatus}</p>}
              </>
            )}
          </div>
        </div>
      </section>

      {alarmFiring && (
        <div className="alarmOverlay">
          <div className="alarmOverlayInner">
            <p className="alarmEmoji">🚌</p>
            <p className="alarmTitle">Leave now</p>
            <p className="alarmSub">Deeny bus timing says it’s time to go.</p>

            <button
              type="button"
              className="alarmDismiss"
              onClick={dismissAlarm}
            >
              I’m going
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
