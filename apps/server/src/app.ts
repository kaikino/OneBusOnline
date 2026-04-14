import cors from "cors";
import express, { type NextFunction, type Request, type Response, Router } from "express";
import "express-async-errors";
import { createObaClient, isObaConfigured } from "./obaClient.js";
import { ObaService } from "./obaService.js";
import { apiRoutes, stopsSnapshot } from "./routes.js";
import { stopListCacheBackend } from "./stopListCache.js";

function corsOrigin(): string | string[] | boolean {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (raw) {
    return raw.split(",").map((s) => s.trim());
  }
  if (process.env.NODE_ENV !== "production") {
    return true;
  }
  return false;
}

const app = express();
app.use(
  cors({
    origin: corsOrigin(),
    credentials: true,
  })
);
app.use(express.json());

app.get("/", (_req, res) => {
  res.type("text").send("OneBusOnline BFF — use /api/v1/health");
});

if (isObaConfigured()) {
  const service = new ObaService(createObaClient());
  app.use("/api/v1", apiRoutes(service));
} else {
  console.warn("ONEBUSAWAY_API_KEY not set — only /api/v1/health is available");
  const fallback = Router();
  fallback.get("/stops/snapshot", stopsSnapshot);
  fallback.get("/health", (_req, res) => {
    res.json({
      ok: true,
      obaConfigured: false,
      stopListCache: stopListCacheBackend(),
    });
  });
  const blockOba: express.RequestHandler = (_req, res) => {
    res.status(503).json({
      error: "Server missing ONEBUSAWAY_API_KEY",
    });
  };
  fallback.use(blockOba);
  app.use("/api/v1", fallback);
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[bff] API error:", err);
  if (res.headersSent) return;
  const message = err instanceof Error ? err.message : String(err);
  res.status(500).json({ error: message });
});

export default app;
