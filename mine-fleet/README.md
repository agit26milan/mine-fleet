# Mine Fleet Live Tracker

Real-time fleet dashboard for an open-pit mine: 5 haul trucks, live GPS map,
health alerts, and a history scrubber — all running from a single
`docker compose up`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Simulator (TypeScript, separate process)                       │
│  5 trucks × 2 Hz → POST /telemetry                             │
└──────────────────────────┬──────────────────────────────────────┘
                           │  HTTP POST /telemetry
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Backend  (Rust · Axum 0.8 · Tokio)                            │
│                                                                 │
│  POST /telemetry ──► FleetState (Arc<RwLock<HashMap>>)          │
│                           │                                     │
│                           ├──► health::classify()  (pure fn)    │
│                           │                                     │
│                           └──► broadcast::Sender<SseEvent>      │
│                                       │                         │
│  GET  /fleet  ◄── FleetSnapshot       │                         │
│  GET  /vehicles/{id}/history ◄──      │                         │
│  GET  /events  ──────────────────────►│ SSE stream              │
└───────────────────────────────────────┼─────────────────────────┘
                                        │  text/event-stream
                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│  Frontend  (React 18 · TypeScript · Vite · Zustand)            │
│                                                                 │
│  useFleetSse ──► EventSource /events                            │
│       │  batch 100ms                                            │
│       ▼                                                         │
│  fleetStore (Zustand) ──► FleetMap (Leaflet, imperative API)    │
│                       ──► FleetSummaryPanel                     │
│                       ──► DrillDownPanel + history scrubber     │
└─────────────────────────────────────────────────────────────────┘
```

The Simulator is a standalone Node.js process that emits telemetry via HTTP.
The Backend holds all authoritative state in memory; it never calls the
Simulator. The Frontend is a pure SSE consumer — it only writes to the backend
when fetching seed history (`GET /vehicles/{id}/history`) on first drill-down.

---

## How to Run

**Prerequisites (exact versions tested):**

| Tool   | Version |
|--------|---------|
| Rust   | 1.95.0  |
| Node   | 24.12.0 |
| Docker | 27+     |
| Docker Compose plugin | v2.x |

**Start everything:**

```bash
git clone <repo-url>
cd mine-fleet
docker compose up --build
```

- Frontend: http://localhost:3000
- Backend health: http://localhost:8080/health
- SSE stream: `curl -N http://localhost:8080/events`
- Fleet snapshot: `curl http://localhost:8080/fleet`

Compose starts the backend first, waits for its health check, then starts the
simulator and frontend. Cold build (~2 min on first run due to Rust
compilation; subsequent builds are fast via cached volumes).

---

## Stack Decisions

### Axum over Actix Web

**What:** Axum 0.8 as the HTTP framework, layered on Tokio.

**Why over Actix Web:** Axum's extractor model composes with the Rust type
system — adding a new extractor (e.g., `JsonBody<T>`) requires no macros, only
a `FromRequest` impl. Actix relies heavily on its own actor system and
`web::Data`, which adds indirection. For a small, stateless telemetry service,
Axum's tower middleware stack is simpler to reason about and test without
spinning up actors.

**At 10× scale:** Axum's story doesn't change much — it's already async and
non-blocking. The bottleneck would shift to `RwLock` contention on `FleetState`
with hundreds of trucks posting simultaneously. At that point: shard the
`HashMap` by truck-ID prefix (e.g., `DashMap`) or front the ingest with a
message queue (Kafka/NATS) and move state into Redis.

---

### SSE over WebSocket

**What:** `GET /events` returns a persistent `text/event-stream`.

**Why over WebSocket:** The data flow is strictly unidirectional —
backend pushes, browser reads. WebSocket adds a bidirectional handshake,
per-frame framing, and ping/pong keepalives for no benefit here. SSE is
supported natively in every modern browser via `EventSource`, auto-reconnects
on disconnect, and works transparently through HTTP/1.1 proxies. The `curl -N`
debugging story is also much simpler.

**At 10× scale:** SSE doesn't fan-out well across multiple backend instances
(each client must be pinned to one instance). At scale, replace the
`broadcast::Sender` with a pub/sub layer (Redis Streams, NATS JetStream) and
have every backend instance subscribe — clients can then connect to any
instance.

---

### `broadcast::Sender` for SSE fan-out

**What:** A single `tokio::sync::broadcast::Sender<SseEvent>` in `AppState`;
each SSE client holds a `Receiver` clone.

**Why:** Zero copying between clients — `broadcast` clones the Arc'd message
once per send, not once per receiver. Bounded capacity (256 slots) gives
natural backpressure: a slow client doesn't block fast ones, it just loses the
oldest messages (acceptable for live telemetry — a slightly stale marker
position is fine; what matters is the next update arrives quickly). Lagged
receivers are detected and logged, not panicked.

**At 10× scale:** A 256-slot in-process channel doesn't survive a backend
restart or horizontal scale-out. Replace with a durable external bus; keep the
in-process channel only as a local fan-out buffer per instance.

---

### Zustand over Redux

**What:** Zustand 5 as the client-side fleet state store.

**Why over Redux:** Redux requires actions, reducers, selectors, and a
`Provider` — ~150 lines of boilerplate for a store this simple. Zustand is a
single `create()` call, mutates state directly inside actions (Immer-optional),
and reads with a selector hook that only re-renders if the slice changes.
For a real-time dashboard where the store is updated 10 times/second, the
reduced re-render surface matters. Zustand's `setState` is also easy to call
from outside React (e.g., in `useEffect` cleanup paths), which Redux discourages.

**At 10× scale:** Zustand doesn't scale to shared state across microfrontends
or server-side rendering. At that point: keep Zustand for local UI state,
move authoritative fleet data to a React Query / SWR cache backed by REST
snapshots, and use SSE only for invalidation signals.

---

### Leaflet over Mapbox

**What:** `react-leaflet` 5 wrapping Leaflet.js for the live map.

**Why over Mapbox:** Leaflet is open-source with no API key, no per-tile-request
billing, and no SDK phone-home. The tile layer can be swapped to any WMTS
source (OpenStreetMap, ESRI) without code changes. Mapbox GL JS is superior for
3D terrain, vector tiles, and custom styling, but those features aren't needed
here. Leaflet's imperative `marker.setLatLng()` API also makes it easy to move
markers without triggering React re-renders, which is the core pattern in
`TruckMarker.tsx`.

**At 10× scale:** Leaflet starts to struggle past ~500 DOM markers (SVG
overhead). Switch to MapLibre GL (open-source Mapbox GL fork) with a
`GeoJSON` source — GPU-rendered, handles thousands of points, still no API key.

---

### JSON over Protobuf

**What:** `serde_json` for all wire encoding; `application/json` everywhere.

**Why over Protobuf:** At 5 trucks × 2 Hz, payload size is irrelevant
(~300 bytes/message). JSON is human-readable, trivially debuggable with `curl`,
and requires no codegen step. The schema is defined once in `types.rs` and
manually mirrored in `types.ts` — a small surface, low drift risk.

**At 10× scale:** 500 trucks × 2 Hz = 1000 msg/s. At that volume, Protobuf
binary encoding (60–70% size reduction) and zero-copy deserialization become
worth the codegen complexity. The migration path: add a
`content-type: application/x-protobuf` branch in the ingest handler, keep JSON
as fallback, migrate clients incrementally.

---

## AI Usage Log

### What was delegated to AI

- Initial scaffold for all three Dockerfiles and `docker-compose.yml`
- `health::classify()` rule implementations (OverRev 5-second window logic)
- React-Leaflet marker imperative update pattern (`TruckMarker.tsx`)
- Vitest fake-timer test structure for SSE reconnect
- `FleetSummaryPanel` state count aggregation
- `DrillDownPanel` scrubber + ring buffer logic

### What was written / rewritten by hand

- `state.rs` lock discipline — the AI initially wrapped the entire
  `update_vehicle` body inside the write lock, holding it while calling
  `health::classify()`. Rewrote to release the lock before classification,
  since `classify` is a pure function that doesn't need the lock.
- `JsonBody<T>` custom extractor — the AI's first attempt used
  `#[async_trait]` from the `async-trait` crate which is not in `Cargo.toml`,
  and also passed `Request<Body>` with an explicit body type that conflicts with
  Axum 0.8's type alias. Rewrote using native Rust 1.75+ async fn in trait.
- Zustand `historyByTruck` ring buffer — the AI generated a pattern that
  called `useFleetStore.getState()` inside a `useEffect` dependency array,
  causing an infinite render loop. Rewrote using a stable ref to avoid the
  cycle.
- All commit messages and this README.

### Concrete case where AI was wrong

**The `#[async_trait]` import in `api.rs`.**

When asked to add a custom `FromRequest` extractor, the AI wrote:

```rust
use axum::async_trait;   // ← does not exist
#[async_trait]
impl<T, S> FromRequest<S> for JsonBody<T> { ... }
```

`async_trait` is a proc-macro crate that must be listed in `Cargo.toml`, not a
re-export from Axum. Additionally, the AI typed the method signature as
`async fn from_request(req: Request<Body>, ...)` using the raw `Body` type,
but Axum 0.8 re-exports `Request` as `axum::extract::Request` (a type alias
that already has the body baked in). The fix: removed the `async_trait` import
entirely (Rust 1.75+ supports async fn in traits natively), dropped the
explicit `<Body>` parameter, and the code compiled cleanly.

---

## What's Next

Three things consciously not shipped:

1. **Authentication / multi-user sessions.** The SSE endpoint is open to anyone
   on the network. In a real mine, each operator dashboard would authenticate
   with a JWT and the backend would filter the SSE stream per role (e.g.,
   dispatch sees all trucks; a haul driver sees only their own). Not shipped
   because it would require a user store, token issuance, and middleware that
   would double the backend surface area without adding any observable behaviour
   to the demo.

2. **Persistent telemetry store.** History is capped at 300 in-memory snapshots
   per truck and lost on backend restart. A time-series database (TimescaleDB,
   InfluxDB, or even SQLite with WAL) would enable replay across restarts and
   long-term trend analysis. Not shipped because the constraint was "runs from
   `docker compose up`" with minimal infrastructure; adding a DB adds a fourth
   service, migrations, and connection pooling.

3. **Geofence alerts.** The health classifier currently operates purely on
   telemetry values (RPM, speed, fuel). A production system would also check
   whether a truck has left its designated haul corridor or entered a blast
   exclusion zone — this requires a polygon definition file and a point-in-
   polygon test per telemetry message. The rule engine is already structured as
   a pure function, so this is the natural next extension; it was left out
   because defining realistic geofence polygons requires domain knowledge of the
   mine layout that isn't available in a synthetic simulator.
