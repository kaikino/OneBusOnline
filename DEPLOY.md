# Deployment

## Architecture

This monorepo deploys as a **single Vercel project**:

- **Frontend** (`apps/web`): static Vite + PWA build, served from `apps/web/dist`.
- **Backend** (`api/index.ts`): Vercel serverless function that exports the Express BFF.
  Routes under `/api/*` are handled by the function; everything else falls through to the SPA.
- **Redis** (Upstash, Railway, etc.): required for caching in serverless (no persistent in-process memory).

The same codebase also supports traditional long-running Node deployment (see "Traditional hosting" below).

## Vercel deployment (recommended)

### 1. Create an Upstash Redis database

1. Go to [console.upstash.com](https://console.upstash.com) → **Create Database**.
2. Copy the **Redis URL** (starts with `rediss://`).

### 2. Deploy to Vercel

1. Push the repo to GitHub.
2. In [vercel.com](https://vercel.com), **Import** the GitHub repo.
3. Vercel will detect `vercel.json` — no framework overrides needed.
4. Add these **Environment Variables** in the Vercel dashboard:

   | Variable               | Value                                      |
   | ---------------------- | ------------------------------------------ |
   | `ONEBUSAWAY_API_KEY`   | Your OBA API key                           |
   | `OBA_BASE_URL`         | `https://api.pugetsound.onebusaway.org`    |
   | `REDIS_URL`            | `rediss://default:xxx@host:6380`           |

5. Click **Deploy**.

The `vercel.json` configures:
- Build: `npm run build -w @onebus/shared && npm run build -w @onebus/web`
- Output: `apps/web/dist`
- Rewrites: `/api/*` → serverless function, everything else → SPA `index.html`

### 3. Custom domain

In Vercel project settings → **Domains**, add your domain.
Point your DNS (e.g., GoDaddy) CNAME to `cname.vercel-dns.com`.

## Environment variables

### Serverless / API

| Variable                         | Required         | Description                                                                |
| -------------------------------- | ---------------- | -------------------------------------------------------------------------- |
| `ONEBUSAWAY_API_KEY`             | Yes              | OBA application key.                                                       |
| `OBA_BASE_URL`                   | Recommended      | Regional API base URL, e.g. `https://api.pugetsound.onebusaway.org`.       |
| `REDIS_URL`                      | Yes (serverless) | Redis connection string. Required for serverless; strongly recommended for traditional hosting. |
| `CACHE_STOPS_TTL_SEC`            | No               | Stop-list cache TTL in seconds (default `600`).                            |
| `CACHE_ARRIVALS_TTL_SEC`         | No               | Arrivals cache TTL in seconds (default `25`).                              |
| `ARRIVALS_MINUTES_AFTER_DEFAULT` | No               | Default "minutes after now" for arrivals (default `120`).                  |
| `ARRIVALS_MINUTES_BEFORE_DEFAULT`| No               | Default "minutes before now" (default `15`, max `120`).                    |

### Frontend build (`apps/web`)

| Variable                        | Required | Description                                                                                           |
| ------------------------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `VITE_API_BASE_URL`             | No       | Leave empty on Vercel (same origin). Only set if the API is on a different domain.                    |
| `VITE_ARRIVALS_MINUTES_AFTER`   | No       | Arrivals window "after now" (default `120`).                                                          |
| `VITE_ARRIVALS_MINUTES_BEFORE`  | No       | Arrivals window "before now" (default `15`).                                                          |
| `VITE_ARRIVALS_EXTEND_STEP_MIN` | No       | Minutes added per "Show arrivals further ahead" tap (default `120`).                                  |

`VITE_*` variables are baked into the client bundle at build time.

## Traditional hosting

The server can still run as a long-running Node.js process:

```bash
npm install
npm run build
node apps/server/dist/index.js
```

Set `PORT` (default `3001`) and `CORS_ORIGIN` for cross-origin setups.
Serve `apps/web/dist` from a CDN or reverse proxy.

## Local development

```bash
cp .env.example .env    # fill in values
npm install
npm run dev             # starts BFF + Vite dev server concurrently
```

The Vite dev server proxies `/api` to `http://localhost:3001`.

## PWA

- The service worker precaches static assets; `/api/*` uses a network-only strategy.
- Icons are configured in `apps/web/vite.config.ts`.

## Arrival colors

| Punctuality        | Color  | Meaning                                        |
| ------------------ | ------ | ---------------------------------------------- |
| `on_time`          | Green  | Real-time, deviation within ±90 seconds        |
| `early`            | Orange | Real-time, deviation < −90 seconds             |
| `late`             | Red    | Real-time, deviation > +90 seconds             |
| `scheduled_only`   | Gray   | No reliable real-time deviation                |
