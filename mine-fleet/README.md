# Mine Fleet Live Tracker

Step 0 scaffold:

- `backend` — Rust + Axum (minimal `GET /health`)
- `simulator` — TypeScript + `tsx` (dev loop + internal `GET /health` for Compose checks)
- `frontend` — React + TypeScript + Vite

## Run

```bash
docker compose up --build
```

- Frontend: `http://localhost:3000`
- Backend health: `http://localhost:8080/health`

## Docker base images (pinned major line)

| Service   | Image              |
| --------- | ------------------ |
| backend   | `rust:1.88-bookworm` |
| simulator | `node:22-bookworm`   |
| frontend  | `node:22-bookworm`   |

Bump these tags deliberately when upgrading toolchains.

## Compose environment (no hidden vars)

| Variable           | Service   | Purpose                                      |
| ------------------ | --------- | -------------------------------------------- |
| `RUST_LOG`         | backend   | `tracing` filter level                       |
| `BACKEND_URL`      | simulator | Base URL for future HTTP calls to backend    |
| `HEALTH_PORT`      | simulator | Port for scaffold health HTTP (`/health`)    |
| `VITE_BACKEND_URL` | frontend  | Browser-facing backend origin for later APIs |

## Repo hygiene

- `.dockerignore` per service keeps build contexts small.
- `package-lock.json` is committed so `npm ci` in Dockerfiles is reproducible.
