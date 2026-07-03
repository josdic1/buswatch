import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import webpush from "web-push";
import { Pool } from "pg";
import crypto from "crypto";

dotenv.config();

const app = express();

const PORT = Number(process.env.PORT || 3001);

const FRONTEND_URL = process.env.FRONTEND_URL || "*";
const ALLOWED_ORIGINS = FRONTEND_URL.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || "";
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:admin@example.com";

const DATABASE_URL = process.env.DATABASE_URL || "";

const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
    })
  : null;

type PushSubscriptionBody = {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

function hasPushConfig() {
  return Boolean(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);
}

function hasDb() {
  return Boolean(pool);
}

if (hasPushConfig()) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  }),
);

app.use(express.json({ limit: "1mb" }));

function toNumber(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

async function initDb() {
  if (!pool) {
    console.warn(
      "DATABASE_URL is missing. ETA works, but push scheduling will not.",
    );
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      endpoint TEXT PRIMARY KEY,
      subscription JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS scheduled_pushes (
      id TEXT PRIMARY KEY,
      endpoint TEXT NOT NULL REFERENCES push_subscriptions(endpoint) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      url TEXT NOT NULL DEFAULT '/',
      tag TEXT NOT NULL DEFAULT 'tsadie-leave-now',
      send_at TIMESTAMPTZ NOT NULL,
      claimed_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      cancelled_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS scheduled_pushes_due_idx
    ON scheduled_pushes(send_at)
    WHERE sent_at IS NULL
      AND cancelled_at IS NULL
      AND failed_at IS NULL;
  `);
}

async function sendPushToSubscription(
  subscription: PushSubscriptionBody,
  payload: {
    title: string;
    body: string;
    url?: string;
    tag?: string;
  },
) {
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url || "/",
        tag: payload.tag || "tsadie-leave-now",
      }),
    );

    return {
      ok: true,
      error: "",
      expired: false,
    };
  } catch (error) {
    const maybeError = error as {
      statusCode?: number;
      message?: string;
      body?: string;
    };

    const expired =
      maybeError.statusCode === 404 || maybeError.statusCode === 410;

    return {
      ok: false,
      expired,
      error:
        maybeError.body || maybeError.message || "Unknown push delivery error",
    };
  }
}

async function processDuePushes() {
  if (!pool || !hasPushConfig()) return;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const due = await client.query<{
      id: string;
      endpoint: string;
      title: string;
      body: string;
      url: string;
      tag: string;
      subscription: PushSubscriptionBody;
    }>(`
      SELECT
        scheduled_pushes.id,
        scheduled_pushes.endpoint,
        scheduled_pushes.title,
        scheduled_pushes.body,
        scheduled_pushes.url,
        scheduled_pushes.tag,
        push_subscriptions.subscription
      FROM scheduled_pushes
      JOIN push_subscriptions
        ON push_subscriptions.endpoint = scheduled_pushes.endpoint
      WHERE scheduled_pushes.send_at <= NOW()
        AND scheduled_pushes.sent_at IS NULL
        AND scheduled_pushes.cancelled_at IS NULL
        AND scheduled_pushes.failed_at IS NULL
        AND (
          scheduled_pushes.claimed_at IS NULL
          OR scheduled_pushes.claimed_at < NOW() - INTERVAL '5 minutes'
        )
      ORDER BY scheduled_pushes.send_at ASC
      LIMIT 25
      FOR UPDATE SKIP LOCKED;
    `);

    const ids = due.rows.map((row) => row.id);

    if (ids.length > 0) {
      await client.query(
        `
          UPDATE scheduled_pushes
          SET claimed_at = NOW()
          WHERE id = ANY($1::text[]);
        `,
        [ids],
      );
    }

    await client.query("COMMIT");

    for (const row of due.rows) {
      const result = await sendPushToSubscription(row.subscription, {
        title: row.title,
        body: row.body,
        url: row.url,
        tag: row.tag,
      });

      if (result.ok) {
        await pool.query(
          `
            UPDATE scheduled_pushes
            SET sent_at = NOW()
            WHERE id = $1;
          `,
          [row.id],
        );
        continue;
      }

      await pool.query(
        `
          UPDATE scheduled_pushes
          SET failed_at = NOW(), last_error = $2
          WHERE id = $1;
        `,
        [row.id, result.error],
      );

      if (result.expired) {
        await pool.query(
          `
            DELETE FROM push_subscriptions
            WHERE endpoint = $1;
          `,
          [row.endpoint],
        );
      }
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("Push worker failed:", error);
  } finally {
    client.release();
  }
}

app.get("/health", async (req, res) => {
  let dbConnected = false;

  if (pool) {
    try {
      await pool.query("SELECT 1");
      dbConnected = true;
    } catch {
      dbConnected = false;
    }
  }

  res.json({
    status: "ok",
    app: "DEENYWHEREUAT API",
    pushConfigured: hasPushConfig(),
    dbConfigured: hasDb(),
    dbConnected,
  });
});

app.get("/push/public-key", (req, res) => {
  if (!hasPushConfig()) {
    res.status(500).json({
      error:
        "Push is not configured. Add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.",
    });
    return;
  }

  res.json({
    publicKey: VAPID_PUBLIC_KEY,
  });
});

app.post("/push/subscribe", async (req, res) => {
  if (!pool) {
    res.status(500).json({
      error: "DATABASE_URL is missing. Push subscriptions cannot be saved.",
    });
    return;
  }

  if (!hasPushConfig()) {
    res.status(500).json({
      error: "Push is not configured on the server.",
    });
    return;
  }

  const subscription = req.body.subscription as
    | PushSubscriptionBody
    | undefined;

  if (
    !subscription?.endpoint ||
    !subscription.keys?.p256dh ||
    !subscription.keys?.auth
  ) {
    res.status(400).json({
      error: "Valid push subscription is required.",
    });
    return;
  }

  await pool.query(
    `
      INSERT INTO push_subscriptions (endpoint, subscription, updated_at)
      VALUES ($1, $2::jsonb, NOW())
      ON CONFLICT (endpoint)
      DO UPDATE SET
        subscription = EXCLUDED.subscription,
        updated_at = NOW();
    `,
    [subscription.endpoint, JSON.stringify(subscription)],
  );

  res.json({
    ok: true,
    endpoint: subscription.endpoint,
  });
});

app.post("/push/test", async (req, res) => {
  if (!pool) {
    res.status(500).json({
      error: "DATABASE_URL is missing.",
    });
    return;
  }

  const endpoint = String(req.body.endpoint || "");

  const result = await pool.query<{
    subscription: PushSubscriptionBody;
  }>(
    `
      SELECT subscription
      FROM push_subscriptions
      WHERE endpoint = $1;
    `,
    [endpoint],
  );

  const subscription = result.rows[0]?.subscription;

  if (!subscription) {
    res.status(404).json({
      error: "Push subscription not found. Enable push first.",
    });
    return;
  }

  const sent = await sendPushToSubscription(subscription, {
    title: "Tsadie test",
    body: "Push notifications are working.",
    url: "/",
    tag: "tsadie-test",
  });

  res.json({
    ok: sent.ok,
    error: sent.error || undefined,
  });
});

app.post("/push/schedule-leave", async (req, res) => {
  if (!pool) {
    res.status(500).json({
      error: "DATABASE_URL is missing.",
    });
    return;
  }

  const endpoint = String(req.body.endpoint || "");
  const delaySeconds = toNumber(req.body.delaySeconds);

  if (
    delaySeconds === null ||
    delaySeconds < 0 ||
    delaySeconds > 24 * 60 * 60
  ) {
    res.status(400).json({
      error: "delaySeconds must be a number between 0 and 86400.",
    });
    return;
  }

  const subscriptionCheck = await pool.query(
    `
      SELECT endpoint
      FROM push_subscriptions
      WHERE endpoint = $1;
    `,
    [endpoint],
  );

  if (subscriptionCheck.rowCount === 0) {
    res.status(404).json({
      error: "Push subscription not found. Enable push first.",
    });
    return;
  }

  const reminderPlan = [
    {
      offsetSeconds: 0,
      title: "Leave now",
      body: "Tsadie says it’s time to go.",
      tag: "tsadie-leave-now-1",
    },
    {
      offsetSeconds: 45,
      title: "Still time to leave",
      body: "Second reminder: head out now.",
      tag: "tsadie-leave-now-2",
    },
    {
      offsetSeconds: 90,
      title: "Final reminder",
      body: "Last Tsadie reminder. Go now.",
      tag: "tsadie-leave-now-3",
    },
  ];

  const scheduled = reminderPlan.map((reminder) => ({
    id: crypto.randomUUID(),
    sendAt: new Date(
      Date.now() + Math.round((delaySeconds + reminder.offsetSeconds) * 1000),
    ),
    ...reminder,
  }));

  for (const reminder of scheduled) {
    await pool.query(
      `
        INSERT INTO scheduled_pushes (
          id,
          endpoint,
          title,
          body,
          url,
          tag,
          send_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7);
      `,
      [
        reminder.id,
        endpoint,
        reminder.title,
        reminder.body,
        "/",
        reminder.tag,
        reminder.sendAt,
      ],
    );
  }

  res.json({
    ok: true,
    scheduleIds: scheduled.map((reminder) => reminder.id),
    delaySeconds: Math.round(delaySeconds),
    reminders: scheduled.map((reminder) => ({
      id: reminder.id,
      title: reminder.title,
      sendAt: reminder.sendAt.toISOString(),
    })),
  });
});

app.delete("/push/schedule/:scheduleId", async (req, res) => {
  if (!pool) {
    res.status(500).json({
      error: "DATABASE_URL is missing.",
    });
    return;
  }

  const scheduleId = req.params.scheduleId;

  await pool.query(
    `
      UPDATE scheduled_pushes
      SET cancelled_at = NOW()
      WHERE id = $1
        AND sent_at IS NULL
        AND cancelled_at IS NULL;
    `,
    [scheduleId],
  );

  res.json({
    ok: true,
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

async function start() {
  await initDb();

  app.listen(PORT, () => {
    console.log(`DEENYWHEREUAT API running on http://localhost:${PORT}`);
  });

  windowlessPushWorker();
}

function windowlessPushWorker() {
  void processDuePushes();

  setInterval(() => {
    void processDuePushes();
  }, 10_000);
}

start().catch((error) => {
  console.error("API failed to start:", error);
  process.exit(1);
});
