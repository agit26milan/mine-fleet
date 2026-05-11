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

The Simulator is a standalone Node.js process that fires telemetry over HTTP.
The Backend owns all authoritative state in memory and never calls back into
the Simulator. The Frontend is a pure SSE consumer — the only time it writes
to the backend is when fetching seed history (`GET /vehicles/{id}/history`)
on the first drill-down.

---

## How to Run

**Prerequisites (exact versions tested):**

| Tool                  | Version |
|-----------------------|---------|
| Rust                  | 1.95.0  |
| Node                  | 24.12.0 |
| Docker                | 27+     |
| Docker Compose plugin | v2.x    |

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

Compose starts the backend first, waits for its health check to pass, then
brings up the simulator and frontend. Cold build takes around 2 minutes on
first run because of Rust compilation; subsequent builds are fast thanks to
cached volumes.

---

## Stack Decisions

### Axum over Actix Web

The main reason to go with Axum 0.8 on top of Tokio is how well its extractor
model fits the Rust type system. Adding a new extractor — say, `JsonBody<T>` —
only requires implementing `FromRequest`. No macros needed. Actix leans on its
own actor system and `web::Data`, which adds indirection that isn't really
justified for a small stateless service like this. Axum's tower middleware stack
is also much easier to reason about and test without needing to spin up actors.

At 10× scale, Axum itself isn't the problem — it's already async and
non-blocking. The bottleneck would be `RwLock` contention on `FleetState` when
hundreds of trucks are posting at the same time. At that point, sharding the
`HashMap` by truck-ID prefix (DashMap is an easy win here) or fronting the
ingest path with a message queue (Kafka or NATS) and pushing state into Redis
would be the move.

---

### SSE over WebSocket

`GET /events` returns a persistent `text/event-stream`. The data flow here is
strictly one-way — the backend pushes, the browser reads. WebSocket adds a
bidirectional handshake, per-frame overhead, and ping/pong keepalives for
absolutely no benefit. SSE is natively supported in every modern browser via
`EventSource`, auto-reconnects on disconnect, and works transparently through
HTTP/1.1 proxies without any special configuration. Debugging is also much
simpler — `curl -N` and you're done.

At 10× scale, SSE doesn't fan-out well across multiple backend instances
because each client has to stay pinned to one. The fix there is to swap the
`broadcast::Sender` for a pub/sub layer like Redis Streams or NATS JetStream
so every backend instance can subscribe — clients can then land on any instance.

---

### `broadcast::Sender` for SSE fan-out

There's one `tokio::sync::broadcast::Sender<SseEvent>` in `AppState`; each SSE
client gets a `Receiver` clone. The nice thing about `broadcast` here is that
it clones the Arc'd message once per send rather than once per receiver, so
there's no unnecessary copying between clients. The channel is bounded to 256
slots, which gives you natural backpressure: a slow client doesn't block fast
ones, it just drops the oldest messages — totally fine for live telemetry where
a slightly stale marker position doesn't matter, because the next update is
seconds away anyway. Lagged receivers get logged, not panicked.

At 10× scale, a 256-slot in-process channel doesn't survive a backend restart
or horizontal scale-out. You'd replace it with a durable external bus and keep
the in-process channel only as a local fan-out buffer per instance.

---

### Zustand over Redux

Redux needs actions, reducers, selectors, and a Provider — around 150 lines of
boilerplate for a store this simple. Zustand is a single `create()` call,
mutates state directly inside actions (Immer is optional), and subscribes with
a selector hook that only re-renders when the relevant slice actually changes.
For a real-time dashboard that updates the store 10 times per second, that
reduced re-render surface really does matter in practice. Zustand's `setState`
is also easy to call from outside React — useful in `useEffect` cleanup paths —
which Redux tends to discourage.

If the project grew into microfrontends or needed SSR, Zustand would start
showing its limits. The right move at that point: keep Zustand for local UI
state, move the authoritative fleet data into a React Query or SWR cache backed
by REST snapshots, and use SSE only as an invalidation signal.

---

### Leaflet over Mapbox

`react-leaflet` 5 wrapping Leaflet.js for the live map. Leaflet is open-source,
requires no API key, has no per-tile-request billing, and doesn't phone home.
The tile layer is swappable to any WMTS source — OpenStreetMap, ESRI, whatever
— without touching a single line of code. Mapbox GL JS is objectively better
for 3D terrain and vector tiles, but those features aren't needed here, and the
licensing overhead isn't worth it. There's also a practical reason: Leaflet's
imperative `marker.setLatLng()` API lets you move markers without triggering
React re-renders at all, which is the core pattern inside `TruckMarker.tsx`.

Past roughly 500 DOM markers, Leaflet starts to struggle under SVG overhead.
If it ever gets there, the right upgrade is MapLibre GL — the open-source
Mapbox GL fork, GPU-rendered, handles thousands of points, still no API key
required.

---

### JSON over Protobuf

`serde_json` everywhere, `application/json` on all endpoints. At 5 trucks × 2
Hz, payload size is genuinely irrelevant — we're talking ~300 bytes per message.
JSON is human-readable, trivially debuggable with `curl`, and requires no
codegen. The schema lives once in `types.rs` and is manually mirrored in
`types.ts`; it's a small surface, so drift risk is low.

At 500 trucks × 2 Hz (1000 msg/s), Protobuf starts making sense: binary
encoding saves 60–70% on payload size and zero-copy deserialization becomes
meaningful. The migration path is straightforward — add a
`content-type: application/x-protobuf` branch in the ingest handler, keep JSON
as a fallback, and migrate clients incrementally.

---

## AI Usage Log

### What was delegated to AI

- Initial scaffold for all three Dockerfiles and `docker-compose.yml`
- `health::classify()` rule implementations, including the OverRev 5-second window logic
- The React-Leaflet imperative marker update pattern in `TruckMarker.tsx`
- Vitest fake-timer test structure for SSE reconnect behavior
- State count aggregation in `FleetSummaryPanel`
- Scrubber and ring buffer logic in `DrillDownPanel`

### What was written or rewritten by hand

**`state.rs` lock discipline.** The AI's first version wrapped the entire
`update_vehicle` body inside the write lock, including the call to
`health::classify()`. Rewrote it to release the lock before classification —
`classify` is a pure function and has no business holding a write lock.

**`JsonBody<T>` custom extractor.** The initial attempt pulled in `#[async_trait]`
from the `async-trait` crate, which isn't in `Cargo.toml`, and typed the method
signature as `async fn from_request(req: Request<Body>, ...)` using a raw `Body`
type that conflicts with Axum 0.8's type alias. Rewrote it using native async fn
in traits (Rust 1.75+).

**`historyByTruck` ring buffer in Zustand.** The AI generated a pattern that
called `useFleetStore.getState()` inside a `useEffect` dependency array, which
caused an infinite render loop. Rewrote it using a stable ref.

All commit messages and this README were also written by hand.

### A concrete case where the AI got it wrong

**The `#[async_trait]` import in `api.rs`.**

When asked to add a custom `FromRequest` extractor, the AI produced:

```rust
use axum::async_trait;   // ← does not exist
#[async_trait]
impl<T, S> FromRequest<S> for JsonBody<T> { ... }
```

`async_trait` is a proc-macro crate that has to be declared in `Cargo.toml`.
It's not re-exported by Axum. On top of that, the AI wrote the method signature
as `async fn from_request(req: Request<Body>, ...)` using the raw `Body` type,
but Axum 0.8 exposes `Request` as `axum::extract::Request` — a type alias that
already has the body baked in. The fix was simple: drop the `async_trait` import
entirely (Rust 1.75+ handles async fn in traits natively), remove the explicit
`<Body>` parameter, and the whole thing compiled cleanly.

---

## What's Next

Three things that were deliberately left out:

**Authentication and multi-user sessions.** Right now the SSE endpoint is open
to anyone on the network. In a real mine, each operator dashboard would
authenticate via JWT and the backend would filter the SSE stream per role —
dispatch sees all trucks, a haul driver sees only their own vehicle. Left it out
because it would require a user store, token issuance, and middleware that would
roughly double the backend surface area without adding any observable behavior
to the demo.

**Persistent telemetry storage.** History is capped at 300 in-memory snapshots
per truck and disappears on backend restart. A time-series database —
TimescaleDB, InfluxDB, or even SQLite with WAL — would enable replay across
restarts and longer-term trend analysis. Skipped it because the goal was
something that runs clean from `docker compose up`; adding a database means a
fourth service, migrations, and connection pooling.

**Geofence alerts.** The health classifier currently only looks at raw telemetry
values: RPM, speed, fuel. A production system would also check whether a truck
has left its designated haul corridor or entered a blast exclusion zone, which
requires a polygon definition file and a point-in-polygon check on every
incoming message. The rule engine is already structured as a pure function, so
this is the natural place to extend it — but defining realistic geofence
polygons requires actual knowledge of the mine layout, and that's not something
a synthetic simulator can provide.
