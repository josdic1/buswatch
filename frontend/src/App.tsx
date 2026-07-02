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

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  return outputArray;
}

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
      paddingBottomRight: [34, 265],
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const sirenStopRef = useRef<(() => void) | null>(null);
  const wakeLockRef = useRef<{ release?: () => Promise<void> | void } | null>(
    null,
  );

  const [userPoint, setUserPoint] = useState<Point | null>(null);
  const [busPoint, setBusPoint] = useState<Point | null>(null);

  const [plannedRoute, setPlannedRoute] = useState<Point[]>([]);
  const [busEta, setBusEta] = useState<EtaResult | null>(null);
  const [userEta, setUserEta] = useState<EtaResult | null>(null);

  const [routeLoading, setRouteLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [alertStatus, setAlertStatus] = useState("");
  const [pushStatus, setPushStatus] = useState("");
  const [pushEndpoint, setPushEndpoint] = useState<string | null>(null);
  const [scheduledPushId, setScheduledPushId] = useState<string | null>(null);

  const [busRouteStartIndex, setBusRouteStartIndex] = useState<number | null>(
    null,
  );
  const [fitVersion, setFitVersion] = useState(0);

  const [alarmTargetMs, setAlarmTargetMs] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [alarmFiring, setAlarmFiring] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [alertWarningOpen, setAlertWarningOpen] = useState(false);

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

  const backupTimerMinutes = useMemo(() => {
    if (leaveInMinutes === null) return null;

    return Math.max(1, Math.floor(leaveInMinutes));
  }, [leaveInMinutes]);

  const alarmArmed = alarmTargetMs !== null && secondsLeft !== null;

  function refitMap() {
    setFitVersion((version) => version + 1);
  }

  function unlockAudio() {
    if (!audioContextRef.current) {
      const AudioContextConstructor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;

      if (!AudioContextConstructor) return;

      audioContextRef.current = new AudioContextConstructor();
    }

    audioContextRef.current.resume();
  }

  function startSiren() {
    const ctx = audioContextRef.current;
    if (!ctx) return null;

    ctx.resume();

    const chimeCount = 4;
    const chimeGapMs = 1600;

    let stopped = false;

    function playChime() {
      if (stopped || !ctx) return;

      const now = ctx.currentTime;

      const notes = [
        { freq: 659.25, start: 0 },
        { freq: 523.25, start: 0.28 },
      ];

      notes.forEach((note) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.value = note.freq;

        gain.gain.setValueAtTime(0, now + note.start);
        gain.gain.linearRampToValueAtTime(0.22, now + note.start + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.001, now + note.start + 0.9);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now + note.start);
        osc.stop(now + note.start + 1);
      });
    }

    navigator.vibrate?.(200);
    playChime();

    let chimesPlayed = 1;

    const chimeTimer = window.setInterval(() => {
      if (chimesPlayed >= chimeCount) {
        window.clearInterval(chimeTimer);
        return;
      }

      chimesPlayed += 1;
      navigator.vibrate?.(200);
      playChime();
    }, chimeGapMs);

    return () => {
      stopped = true;
      window.clearInterval(chimeTimer);
      navigator.vibrate?.(0);
    };
  }

  async function requestWakeLock() {
    try {
      const wakeLockApi = (
        navigator as Navigator & {
          wakeLock?: {
            request: (
              type: "screen",
            ) => Promise<{ release?: () => Promise<void> | void }>;
          };
        }
      ).wakeLock;

      if (!wakeLockApi) return;

      wakeLockRef.current = await wakeLockApi.request("screen");
    } catch {
      // Ignore. Push/in-app alerts still try their best.
    }
  }

  function releaseWakeLock() {
    if (wakeLockRef.current) {
      wakeLockRef.current.release?.();
      wakeLockRef.current = null;
    }
  }

  function fireAlarm() {
    setAlarmFiring(true);
    setAlertStatus("");

    sirenStopRef.current?.();
    sirenStopRef.current = startSiren();

    if ("Notification" in window && Notification.permission === "granted") {
      try {
        new Notification("Leave now", {
          body: "Tsadie says it’s time to go.",
        });
      } catch {
        // Overlay and sound still handle the alert.
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
    setAlertWarningOpen(false);
    releaseWakeLock();
  }

  async function getPushPublicKey() {
    const res = await fetch(`${API_URL}/push/public-key`);

    if (!res.ok) {
      throw new Error("Push is not configured yet.");
    }

    const data = await res.json();

    if (!data.publicKey) {
      throw new Error("Missing push public key.");
    }

    return String(data.publicKey);
  }

  async function enablePushNotifications() {
    if (!window.isSecureContext && window.location.hostname !== "localhost") {
      setPushStatus("Push needs HTTPS. Use the installed app or live site.");
      return null;
    }

    if (!("serviceWorker" in navigator)) {
      setPushStatus("Push is not supported in this browser.");
      return null;
    }

    if (!("PushManager" in window)) {
      setPushStatus("Push is not supported in this browser.");
      return null;
    }

    if (!("Notification" in window)) {
      setPushStatus("Notifications are not supported in this browser.");
      return null;
    }

    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      setPushStatus("Push blocked. Allow notifications to use push alerts.");
      return null;
    }

    const publicKey = await getPushPublicKey();

    const registration = await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
    }

    const res = await fetch(`${API_URL}/push/subscribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subscription,
      }),
    });

    if (!res.ok) {
      throw new Error("Could not save push subscription.");
    }

    const data = await res.json();
    const endpoint = String(data.endpoint || subscription.endpoint);

    setPushEndpoint(endpoint);
    setPushStatus("Push notifications enabled.");

    return endpoint;
  }

  async function schedulePushLeaveAlert(delaySeconds: number) {
    try {
      const endpoint = pushEndpoint ?? (await enablePushNotifications());

      if (!endpoint) {
        return;
      }

      const res = await fetch(`${API_URL}/push/schedule-leave`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          endpoint,
          delaySeconds,
        }),
      });

      if (!res.ok) {
        throw new Error("Could not schedule push alert.");
      }

      const data = await res.json();

      setScheduledPushId(String(data.scheduleId || ""));
      setPushStatus("Push alert scheduled.");
    } catch {
      setPushStatus("Push unavailable. In-app alert is still running.");
    }
  }

  async function cancelScheduledPushAlert() {
    if (!scheduledPushId) return;

    try {
      await fetch(
        `${API_URL}/push/schedule/${encodeURIComponent(scheduledPushId)}`,
        {
          method: "DELETE",
        },
      );
    } catch {
      // In-app alarm cancel still works.
    } finally {
      setScheduledPushId(null);
    }
  }

  function cancelAlarm() {
    void cancelScheduledPushAlert();
    dismissAlarm();
  }

  async function setLeaveAlarm() {
    if (leaveInMinutes === null) return;

    setAlertWarningOpen(false);
    unlockAudio();

    const safeLeaveInMinutes = Math.max(0, leaveInMinutes);

    if (safeLeaveInMinutes <= 0) {
      fireAlarm();
      return;
    }

    requestWakeLock();

    const delaySeconds = Math.ceil(safeLeaveInMinutes * 60);
    const targetMs = Date.now() + delaySeconds * 1000;

    setAlarmTargetMs(targetMs);
    setSecondsLeft(delaySeconds);
    setAlertStatus("Countdown live. Push alert scheduled when available.");

    await schedulePushLeaveAlert(delaySeconds);
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
            new Error(
              "Location blocked. Open Help for steps to allow location.",
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
    void cancelScheduledPushAlert();
    dismissAlarm();

    setBusPoint(null);
    setBusEta(null);
    setUserEta(null);
    setBusRouteStartIndex(null);
    setError("");
    setAlertStatus("");
    setPushStatus("");
    setLoading(false);
    refitMap();
  }

  async function handleTapBus(clickedPoint: Point) {
    if (plannedRoute.length === 0) {
      setError("Route is still loading.");
      return;
    }

    void cancelScheduledPushAlert();
    dismissAlarm();

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    const snapped = snapPointToRoute(clickedPoint, plannedRoute);

    setBusPoint(snapped.point);
    setBusRouteStartIndex(snapped.index);
    setBusEta(null);
    setUserEta(null);
    setError("");
    setAlertStatus("");
    setPushStatus("");
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

  useEffect(() => {
    if (!helpOpen && !alertWarningOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHelpOpen(false);
        setAlertWarningOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [helpOpen, alertWarningOpen]);

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
          <button
            type="button"
            className="helpButton"
            aria-label="Open help"
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
              setHelpOpen(true);
            }}
          >
            ?
          </button>

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

        <div className="statusCard">
          <div className="statusContent">
            {error && (
              <>
                <p className="label danger">Problem</p>
                <p className="mainText">{error}</p>

                <button
                  type="button"
                  className="notifyButton"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setHelpOpen(true);
                  }}
                >
                  Open Help
                </button>
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
                <p className="helperText">
                  In-app alert now. Push notifications available when installed.
                </p>
              </>
            )}

            {!error && !loading && busEta && userEta && (
              <>
                <p className="label">Bus ETA to JCC</p>

                <div className="etaGrid">
                  <div className="etaMain">
                    <strong>{busEta.durationMinutes}</strong>
                    <span>min</span>
                  </div>

                  <div
                    className={
                      leaveInMinutes !== null && leaveInMinutes <= 0
                        ? "leaveBadge urgent"
                        : "leaveBadge"
                    }
                  >
                    <span>Leave</span>
                    <strong>
                      {leaveInMinutes !== null && leaveInMinutes <= 0
                        ? "now"
                        : `in ${leaveInMinutes} min`}
                    </strong>
                  </div>
                </div>

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

                {leaveInMinutes !== null &&
                  leaveInMinutes > 0 &&
                  !alarmArmed &&
                  !alarmFiring && (
                    <>
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
                          setAlertWarningOpen(true);
                        }}
                      >
                        Set alert
                      </button>

                      <p className="miniNotice">
                        In-app alert now. Push notifications available when
                        installed.
                      </p>

                      {backupTimerMinutes !== null && (
                        <p className="backupNotice">
                          Foolproof backup: set an iPhone timer for{" "}
                          <strong>{backupTimerMinutes} min</strong>.
                        </p>
                      )}
                    </>
                  )}

                {alarmArmed && (
                  <div className="keepOpenBanner">
                    <strong>Countdown live</strong>
                    <span>
                      You can use your phone, but return to Tsadie before the
                      timer reaches zero. Push will fire if enabled.
                    </span>
                  </div>
                )}

                {alarmArmed && (
                  <div className="alertCountdown">
                    <span>Alert in</span>
                    <strong>{formatCountdown(secondsLeft ?? 0)}</strong>
                  </div>
                )}

                {alarmArmed && backupTimerMinutes !== null && (
                  <p className="backupNotice active">
                    Foolproof backup: set an iPhone timer for{" "}
                    <strong>{backupTimerMinutes} min</strong>.
                  </p>
                )}

                {alarmArmed && (
                  <button
                    type="button"
                    className="cancelAlertButton"
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
                )}

                {alertStatus && <p className="alertStatus">{alertStatus}</p>}
                {pushStatus && <p className="alertStatus">{pushStatus}</p>}
              </>
            )}
          </div>
        </div>
      </section>

      {alertWarningOpen && (
        <div
          className="alertInfoOverlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="alert-info-title"
        >
          <div className="alertInfoModal">
            <p className="alertInfoKicker">Alert</p>
            <h2 id="alert-info-title">Tsadie keeps time</h2>

            <p className="alertInfoText">
              Tsadie runs an in-app countdown now. If notifications are allowed,
              Tsadie also schedules a push alert.
            </p>

            <div className="alertRules">
              <div>Best setup: add Tsadie to your iPhone Home Screen.</div>
              <div>Allow notifications when asked.</div>
              <div>You can use your phone while waiting.</div>
              <div>Keep the iPhone timer backup for absolute safety.</div>
            </div>

            {backupTimerMinutes !== null && (
              <div className="foolproofBox">
                <span>Foolproof backup</span>
                <strong>
                  Set an iPhone timer for {backupTimerMinutes} min
                </strong>
              </div>
            )}

            <p className="alertSoon">
              Push notifications available when installed.
            </p>

            <button
              type="button"
              className="alertPrimary"
              onClick={() => {
                void setLeaveAlarm();
              }}
            >
              Set alert
            </button>

            <button
              type="button"
              className="alertSecondary"
              onClick={() => {
                setAlertWarningOpen(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {helpOpen && (
        <div
          className="helpOverlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-title"
        >
          <div className="helpModal">
            <div className="helpHeader">
              <div>
                <p className="helpKicker">Tsadie Help</p>
                <h2 id="help-title">Setup steps</h2>
              </div>

              <button
                type="button"
                className="helpClose"
                aria-label="Close help"
                onClick={() => {
                  setHelpOpen(false);
                }}
              >
                ×
              </button>
            </div>

            <div className="helpSection">
              <h3>Allow location</h3>
              <ol>
                <li>Open the iPhone Settings app.</li>
                <li>Tap Privacy &amp; Security.</li>
                <li>Tap Location Services.</li>
                <li>Make sure Location Services is ON.</li>
                <li>Scroll down and tap Safari Websites.</li>
                <li>Choose While Using the App.</li>
                <li>Come back to Tsadie and tap the bus route again.</li>
              </ol>

              <p className="helpNote">
                If Tsadie appears as its own app in Settings, tap Tsadie, then
                tap Location, then choose While Using the App.
              </p>
            </div>

            <div className="helpSection">
              <h3>Add Tsadie to the Home Screen</h3>
              <ol>
                <li>Open Safari on the iPhone.</li>
                <li>Go to the Tsadie website.</li>
                <li>
                  Tap the Share button. It looks like a square with an arrow.
                </li>
                <li>Scroll down and tap Add to Home Screen.</li>
                <li>Tap Add.</li>
                <li>Use the Tsadie icon on the Home Screen like an app.</li>
              </ol>
            </div>

            <div className="helpSection">
              <h3>About alerts</h3>
              <ol>
                <li>In-app alerts work while Tsadie is open and running.</li>
                <li>Push alerts work after notifications are allowed.</li>
                <li>For iPhone, add Tsadie to the Home Screen first.</li>
                <li>Use the iPhone timer backup if the timing is critical.</li>
              </ol>
            </div>

            <button
              type="button"
              className="helpDone"
              onClick={() => {
                setHelpOpen(false);
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {alarmFiring && (
        <div className="alarmOverlay">
          <div className="alarmOverlayInner">
            <p className="alarmEmoji">🚌</p>
            <p className="alarmTitle">Leave now</p>
            <p className="alarmSub">Tsadie says it’s time to go.</p>

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
