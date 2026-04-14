# OneBusOnline

PWA and Express backend-for-frontend for [OneBusAway](https://onebusaway.org/) stops, map, and arrivals. The browser talks only to this repo’s API; the API holds your OBA key and calls OneBusAway.

## Prerequisites

- Node.js 20+
- `ONEBUSAWAY_API_KEY` and (recommended) `OBA_BASE_URL` for your region

## Local development

```bash
cp .env.example .env
# Set ONEBUSAWAY_API_KEY and OBA_BASE_URL in .env

npm install
npm run dev
```

From the repo root, `npm run dev` runs the API on port **3001** and the Vite app on **5173**, with `/api` proxied to the API.

After `@onebus/shared` has been built once, you can skip rebuilding it on each start:

```bash
npm run dev:simple
```

## Deployment

See [DEPLOY.md](DEPLOY.md).