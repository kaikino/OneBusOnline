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
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | For notifications | Web Push keys from `npx web-push generate-vapid-keys`. |
| `VAPID_SUBJECT`      | For notifications | Contact for push services, e.g. `mailto:you@example.com`. |
| `QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY` | For notifications | From the Upstash console's QStash page. |
| `QSTASH_URL`         | Sometimes   | QStash API host, if the console shows a regional one. |
| `APP_URL`            | Off Vercel  | Public origin QStash calls back, e.g. `https://onebus.example`. Vercel's production domain is used by default. |

## Bus notifications

Reminders set on the Saved page arrive as Web Push notifications, even with the app closed. Android works in Chrome; iPhone needs iOS 16.4+ with the app added to the Home Screen.

Nothing polls. When a reminder is saved, the server queues a single [QStash](https://upstash.com/docs/qstash) message for its next notification time. When QStash delivers it to `/api/v1/notify/wake`, the server checks the live arrival once: a late bus moves the notification once to match, otherwise it's sent and the next day's message is queued. That's usually one message per reminder per day.

Reminders are kept in Redis, which is required in production. In local development without `QSTASH_TOKEN`, wake-ups run on in-process timers instead, so notifications work without an Upstash account (QStash can't reach `localhost`).

## Any Node host

```bash
npm install
npm run build
npm start -w @onebus/server
```

Serve `apps/web/dist` from the same origin with `/api` routed to the server. To host them on different origins instead, build the web app with `VITE_API_BASE_URL` set and start the server with `CORS_ORIGIN` listing the web origin.
