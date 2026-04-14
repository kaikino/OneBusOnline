# Deployment

## Layout

- **`apps/web`**: production build is static files (Vite + PWA). Serve `apps/web/dist` as the site root behind HTTPS.
- `apps/server`: long-running Node process for the REST API. Only the server uses `ONEBUSAWAY_API_KEY`.

## Environment variables

### API (`apps/server`)


| Variable                 | Required             | Description                                                                                                                           |
| ------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ONEBUSAWAY_API_KEY`     | Yes (production)     | OBA application key.                                                                                                                  |
| `OBA_BASE_URL`           | Strongly recommended | Regional API base URL (no path), e.g. `https://api.pugetsound.onebusaway.org`. The SDK also reads `ONEBUSAWAY_SDK_BASE_URL` if unset. |
| `CORS_ORIGIN`            | Yes (production)     | Comma-separated allowed web origins for the SPA (e.g. `https://app.example.com`). In development, CORS is permissive when unset.      |
| `PORT`                   | No                   | Listen port (default `3001`).                                                                                                         |
| `CACHE_STOPS_TTL_SEC`    | No                   | Stop-list cache TTL in seconds (default `600`). Applies to Redis and in-memory backends.                                                 |
| `CACHE_ARRIVALS_TTL_SEC` | No                   | Arrivals cache TTL in seconds (default `25`, in-process only).                                                                        |
| `REDIS_URL`              | No                   | If set, stop lists (near / bbox / search) are cached in Redis and survive API restarts. Omit to use in-memory cache only.              |


### Frontend build (`apps/web`)


| Variable            | Required         | Description                                                                                                                                             |
| ------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL` | Yes (production) | Public base URL of the API **without** a trailing slash, e.g. `https://api.example.com`. Leave empty locally so `/api` is proxied during `npm run dev`. |


Set `VITE_`* at **build time** (they are baked into the client bundle).

## Build

From the repository root:

```bash
npm install
npm run build
```

Outputs:

- `apps/web/dist` — deploy as static assets.
- `apps/server/dist` — run with Node, e.g. `node apps/server/dist/index.js` after `npm run build -w @onebus/server`.

Minimal API-only build (from root, workspaces installed):

```bash
npm run build -w @onebus/shared && npm run build -w @onebus/server && node apps/server/dist/index.js
```

In a monorepo, install dependencies from the **repository root** so `@onebus/shared` resolves; then build shared before server.

## CORS

In production, `CORS_ORIGIN` must list the exact origin(s) of the deployed SPA. Wildcards are not enabled by default.

## PWA

- The service worker precaches static assets; `/api/`* is fetched with a network-only strategy so arrival data is not cached by the SW.
- Icons are configured in `apps/web/vite.config.ts` (`manifest.icons`).

## Arrival colors

Behavior matches `punctuality` on each arrival (see `apps/server/src/normalize.ts` and `@onebus/shared`):

- **Green (`on_time`)**: real-time data and schedule deviation within ±90 seconds.
- **Blue (`early`)**: real-time and deviation < −90 seconds.
- **Red (`late`)**: real-time and deviation > +90 seconds.
- **Gray (`scheduled_only`)**: no reliable real-time deviation for coloring.

