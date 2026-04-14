# Deployment

```bash
npm install
npm run build
npm start -w @onebus/server
```

Serve `apps/web/dist` from the same origin with `/api` routed to the server. To host them on different origins instead, build the web app with `VITE_API_BASE_URL` set and start the server with `CORS_ORIGIN` listing the web origin.

| Variable             | Required    | Description                                                      |
| -------------------- | ----------- | ---------------------------------------------------------------- |
| `ONEBUSAWAY_API_KEY` | Yes         | OneBusAway application key.                                      |
| `OBA_BASE_URL`       | Recommended | Regional API host, e.g. `https://api.pugetsound.onebusaway.org`. |
| `PORT`               | No          | API port, default `3001`.                                        |
