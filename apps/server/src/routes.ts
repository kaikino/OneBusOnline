import { type Request, type Response, Router } from "express";
import { z } from "zod";
import type { ObaService } from "./obaService.js";
import { mergeAllCachedStopLists, stopListCacheBackend } from "./stopListCache.js";

const snapshotBboxQuery = z
  .object({
    minLat: z.coerce.number(),
    minLon: z.coerce.number(),
    maxLat: z.coerce.number(),
    maxLon: z.coerce.number(),
  })
  .optional();

export async function stopsSnapshot(req: Request, res: Response): Promise<void> {
  try {
    const parsed = snapshotBboxQuery.safeParse(
      req.query.minLat !== undefined ? req.query : undefined
    );
    const bbox = parsed.success ? parsed.data : undefined;
    const stops = await mergeAllCachedStopLists(bbox);
    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
    res.json({ stops, stopListCache: stopListCacheBackend() });
  } catch (e) {
    res.status(500).json({
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

const nearQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  radius: z.coerce.number().min(50).max(5000).default(400),
  q: z.string().optional(),
});

const bboxQuery = z.object({
  minLat: z.coerce.number(),
  minLon: z.coerce.number(),
  maxLat: z.coerce.number(),
  maxLon: z.coerce.number(),
  q: z.string().optional(),
  cacheOnly: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((v) => v === true || v === "1" || v === "true"),
});

const searchQuery = z.object({
  q: z.string().min(1).max(200),
  lat: z.coerce.number().optional(),
  lon: z.coerce.number().optional(),
});

const arrivalsQuery = z.object({
  minutesAfter: z.coerce.number().int().min(1).optional(),
  minutesBefore: z.coerce.number().int().min(0).max(120).optional(),
});

export function apiRoutes(service: ObaService): Router {
  const r = Router();

  r.get("/stops/snapshot", stopsSnapshot);

  r.get("/health", async (_req: Request, res: Response) => {
    try {
      const body = await service.health();
      res.setHeader("Cache-Control", "no-store");
      res.json(body);
    } catch (e) {
      res.status(500).json({
        ok: false,
        obaConfigured: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  r.get("/agencies/coverage", async (_req: Request, res: Response) => {
    const data = await service.agenciesCoverage();
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(data);
  });

  r.get("/stops/near", async (req: Request, res: Response) => {
    const parsed = nearQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const data = await service.stopsNear({
      lat: parsed.data.lat,
      lon: parsed.data.lon,
      radius: parsed.data.radius,
      query: parsed.data.q,
    });
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    res.json(data);
  });

  r.get("/stops/bbox", async (req: Request, res: Response) => {
    const parsed = bboxQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const { minLat, minLon, maxLat, maxLon } = parsed.data;
    if (minLat >= maxLat || minLon >= maxLon) {
      res.status(400).json({ error: "Invalid bbox ordering" });
      return;
    }
    const data = await service.stopsBbox(
      {
        minLat,
        minLon,
        maxLat,
        maxLon,
        query: parsed.data.q,
      },
      { cacheOnly: parsed.data.cacheOnly === true }
    );
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    res.json(data);
  });

  r.get("/stops/search", async (req: Request, res: Response) => {
    const parsed = searchQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const origin =
      parsed.data.lat !== undefined && parsed.data.lon !== undefined
        ? { lat: parsed.data.lat, lon: parsed.data.lon }
        : undefined;
    const data = await service.searchStops(parsed.data.q, origin);
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
    res.json(data);
  });

  r.get("/routes/:id/stops", async (req: Request, res: Response) => {
    const rawId = req.params.id;
    const routeId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!routeId) {
      res.status(400).json({ error: "Missing route id" });
      return;
    }
    try {
      const data = await service.stopsForRoute(routeId);
      res.setHeader(
        "Cache-Control",
        "public, max-age=3600, stale-while-revalidate=86400"
      );
      res.json(data);
    } catch (e) {
      res.status(502).json({
        error: e instanceof Error ? e.message : String(e),
      });
    }
  });

  r.get("/stops/:id/arrivals", async (req: Request, res: Response) => {
    const rawId = req.params.id;
    const stopId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!stopId) {
      res.status(400).json({ error: "Missing stop id" });
      return;
    }
    const parsed = arrivalsQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.flatten() });
      return;
    }
    const data = await service.arrivalsForStop(stopId, {
      minutesAfter: parsed.data.minutesAfter,
      minutesBefore: parsed.data.minutesBefore,
    });
    res.setHeader("Cache-Control", "public, max-age=15");
    res.json(data);
  });

  return r;
}
