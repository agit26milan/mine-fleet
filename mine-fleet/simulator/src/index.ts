import http, { type IncomingMessage, type ServerResponse } from "node:http";

import type { LoadStatus, Telemetry, TruckState } from "./types.js";

const BACKEND_URL = (process.env.BACKEND_URL ?? "http://localhost:8080").replace(/\/$/, "");
const TELEMETRY_URL = `${BACKEND_URL}/telemetry`;
const HEALTH_PORT = Number(process.env.HEALTH_PORT ?? "9090");

/** One full cycle: Loading → Hauling → Crushing → Returning → Idle (seconds). */
const CYCLE_MS =
  30_000 + 60_000 + 20_000 + 45_000 + 15_000;

type PhaseDef = { state: TruckState; durationMs: number };

const PHASES: PhaseDef[] = [
  { state: "Loading", durationMs: 30_000 },
  { state: "Hauling", durationMs: 60_000 },
  { state: "Crushing", durationMs: 20_000 },
  { state: "Returning", durationMs: 45_000 },
  { state: "Idle", durationMs: 15_000 },
];

/** Starting phase offsets so each truck begins in a different operational state. */
const TRUCK_CONFIG: {
  id: string;
  phaseOffsetMs: number;
  baseLat: number;
  baseLon: number;
  routeDx: number;
  routeDy: number;
}[] = [
  {
    id: "truck-1",
    phaseOffsetMs: 0,
    baseLat: -8.5,
    baseLon: 115.2,
    routeDx: 0.0008,
    routeDy: 0.0003,
  },
  {
    id: "truck-2",
    phaseOffsetMs: 30_000,
    baseLat: -8.501,
    baseLon: 115.201,
    routeDx: -0.0005,
    routeDy: 0.0007,
  },
  {
    id: "truck-3",
    phaseOffsetMs: 90_000,
    baseLat: -8.499,
    baseLon: 115.198,
    routeDx: 0.0006,
    routeDy: -0.0004,
  },
  {
    id: "truck-4",
    phaseOffsetMs: 110_000,
    baseLat: -8.502,
    baseLon: 115.203,
    routeDx: 0.0004,
    routeDy: 0.0006,
  },
  {
    id: "truck-5",
    phaseOffsetMs: 155_000,
    baseLat: -8.4985,
    baseLon: 115.1995,
    routeDx: -0.0007,
    routeDy: -0.0002,
  },
];

type TruckRuntime = {
  config: (typeof TRUCK_CONFIG)[number];
  fuelPct: number;
  /** truck-3: emit frozen coords during Crushing dropout window. */
  lastEmittedLat: number;
  lastEmittedLon: number;
  emissionsSinceStart: number;
};

function randBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function jitter(coord: number): number {
  return coord + (Math.random() - 0.5) * 2 * 0.0001;
}

function cyclePosition(elapsedMs: number, phaseOffsetMs: number): number {
  let x = (elapsedMs + phaseOffsetMs) % CYCLE_MS;
  if (x < 0) x += CYCLE_MS;
  return x;
}

function phaseAt(cyclePosMs: number): {
  state: TruckState;
  phaseStartMs: number;
  indexInCycle: number;
  progressInPhase: number;
} {
  let cursor = 0;
  for (let i = 0; i < PHASES.length; i++) {
    const end = cursor + PHASES[i].durationMs;
    if (cyclePosMs < end) {
      const phaseLocal = cyclePosMs - cursor;
      const progress = phaseLocal / PHASES[i].durationMs;
      return {
        state: PHASES[i].state,
        phaseStartMs: cursor,
        indexInCycle: i,
        progressInPhase: progress,
      };
    }
    cursor = end;
  }
  const last = PHASES.length - 1;
  return {
    state: PHASES[last].state,
    phaseStartMs: cursor - PHASES[last].durationMs,
    indexInCycle: last,
    progressInPhase: 1,
  };
}

/** Position along route from cycle progress [0,1). */
function routeLatLon(
  cfg: (typeof TRUCK_CONFIG)[number],
  cycleProgress01: number,
): { lat: number; lon: number } {
  const t = cycleProgress01 * Math.PI * 2;
  const lat = cfg.baseLat + Math.sin(t) * 0.0009 + cfg.routeDy * cycleProgress01;
  const lon = cfg.baseLon + Math.cos(t * 0.7) * 0.0009 + cfg.routeDx * cycleProgress01;
  return { lat, lon };
}

function buildTelemetry(rt: TruckRuntime, cyclePosMs: number): Telemetry {
  const { state, progressInPhase } = phaseAt(cyclePosMs);
  const cycleProgress01 = cyclePosMs / CYCLE_MS;

  let speed_kmh = 0;
  let rpm = 800;
  let load_status: LoadStatus = "Empty";

  switch (state) {
    case "Loading":
      speed_kmh = randBetween(0, 5);
      rpm = Math.round(randBetween(800, 1200));
      load_status = progressInPhase >= 0.75 ? "Loaded" : "Empty";
      break;
    case "Hauling":
      speed_kmh = randBetween(15, 40);
      rpm = Math.round(randBetween(1800, 2400));
      load_status = "Loaded";
      rt.fuelPct -= 0.02 * 0.5;
      break;
    case "Crushing":
      speed_kmh = randBetween(0, 5);
      rpm = Math.round(randBetween(1000, 1400));
      load_status = progressInPhase >= 0.5 ? "Empty" : "Loaded";
      break;
    case "Returning":
      speed_kmh = randBetween(20, 45);
      rpm = Math.round(randBetween(1600, 2200));
      load_status = "Empty";
      rt.fuelPct -= 0.015 * 0.5;
      break;
    case "Idle":
      speed_kmh = 0;
      rpm = Math.round(randBetween(600, 800));
      load_status = "Empty";
      break;
  }

  rt.fuelPct = Math.max(5, Math.min(100, rt.fuelPct));

  const { lat: simLat, lon: simLon } = routeLatLon(rt.config, cycleProgress01);
  let lat = jitter(simLat);
  let lon = jitter(simLon);

  const inCrushing = state === "Crushing";
  const crushingPhaseStart = PHASES[0]!.durationMs + PHASES[1]!.durationMs;
  const msIntoCrushing =
    inCrushing ? cyclePosMs - crushingPhaseStart : -1;
  const crushingDropout =
    rt.config.id === "truck-3" &&
    inCrushing &&
    msIntoCrushing >= 0 &&
    msIntoCrushing < 10_000;

  if (crushingDropout) {
    lat = rt.lastEmittedLat;
    lon = rt.lastEmittedLon;
  } else {
    rt.lastEmittedLat = lat;
    rt.lastEmittedLon = lon;
  }

  /* Single-sample spike (~3100 rpm): not sustained → backend OverRev stays off. */
  if (rt.config.id === "truck-5" && rt.emissionsSinceStart > 8 && Math.random() < 1 / 100) {
    rpm = 3100;
  }

  rt.emissionsSinceStart += 1;

  return {
    truck_id: rt.config.id,
    timestamp: new Date().toISOString(),
    lat,
    lon,
    speed_kmh,
    rpm,
    load_status,
    fuel_pct: Math.round(rt.fuelPct * 100) / 100,
  };
}

function postTelemetry(body: Telemetry): void {
  void fetch(TELEMETRY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch((err: unknown) => {
    process.stderr.write(`[simulator] POST failed: ${String(err)}\n`);
  });
}

const runtimes: TruckRuntime[] = TRUCK_CONFIG.map((cfg) => ({
  config: cfg,
  fuelPct: randBetween(70, 95),
  lastEmittedLat: cfg.baseLat,
  lastEmittedLon: cfg.baseLon,
  emissionsSinceStart: 0,
}));

const startedAt = Date.now();

const tick = (): void => {
  const elapsed = Date.now() - startedAt;
  for (const rt of runtimes) {
    const cyclePos = cyclePosition(elapsed, rt.config.phaseOffsetMs);
    const tel = buildTelemetry(rt, cyclePos);
    postTelemetry(tel);
  }
};

const server = http
  .createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("ok");
      return;
    }
    res.writeHead(404);
    res.end();
  })
  .listen(HEALTH_PORT, "0.0.0.0", () => {
    process.stdout.write(
      `[simulator] health on :${HEALTH_PORT}, telemetry → ${TELEMETRY_URL} @ 2 Hz × 5 trucks\n`,
    );
  });

const interval = setInterval(tick, 500);
tick();

const shutdown = (): void => {
  clearInterval(interval);
  server.close(() => {
    process.stdout.write("[simulator] shutdown\n");
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 2000).unref();
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
