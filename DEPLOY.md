# Deployment

The repo deploys as a single Vercel project:

- `apps/web` builds to static files served from `apps/web/dist`.
- `api/index.ts` exports the Express app as a serverless function that handles `/api/*`.
- Redis (Upstash or similar) holds the cache, since serverless functions keep no memory between requests.

## Vercel

1. Create a Redis database and copy its URL (`rediss://...`).
2. Import the repo in Vercel. `vercel.json` already configures the build, output directory and rewrites.
3. Set the environment variables below and deploy.

| Variable             | Required    | Description                                                      |
| -------------------- | ----------- | ---------------------------------------------------------------- |
| `ONEBUSAWAY_API_KEY` | Yes         | OneBusAway application key.                                      |
| `OBA_BASE_URL`       | Recommended | Regional API host, e.g. `https://api.pugetsound.onebusaway.org`. |
| `REDIS_URL`          | Recommended | Redis connection string. Without it every request hits OBA.      |
| `VITE_CARTO_API_KEY` | Recommended | CARTO Basemaps key, read at build time. Without it map tiles are watermarked. |

## Any Node host

```bash
npm install
npm run build
npm start -w @onebus/server
```

Serve `apps/web/dist` from the same origin with `/api` routed to the server. To host them on different origins instead, build the web app with `VITE_API_BASE_URL` set and start the server with `CORS_ORIGIN` listing the web origin.
