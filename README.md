# OneBusOnline

A mobile-first PWA for [OneBusAway](https://onebusaway.org/) transit data: stops on a map and real-time arrivals.

- `apps/web`: React, Vite, Leaflet, TanStack Query, Tailwind.
- `apps/server`: Express API that holds the OneBusAway key, normalizes responses and caches them in Redis.
- `packages/shared`: types and bounding-box helpers used by both.

## Development

Requires Node.js 20+ and a OneBusAway API key.

```bash
cp .env.example .env   # set ONEBUSAWAY_API_KEY and OBA_BASE_URL
npm install
npm run dev
```

The API runs on port 3001 and the web app on 5173, with `/api` proxied to the API.

## Deployment

See [DEPLOY.md](DEPLOY.md).
