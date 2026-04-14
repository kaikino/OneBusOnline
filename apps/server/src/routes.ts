import { type Request, type Response, Router } from "express";
import { z } from "zod";
import type { ObaService } from "./obaService.js";

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
});

const searchQuery = z.object({
  q: z.string().min(1).max(200),
  lat: z.coerce.number().optional(),
  lon: z.coerce.number().optional(),
});

export function apiRoutes(service: ObaService): Router {
  const r = Router();

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
    const data = await service.stopsBbox({
      minLat,
      minLon,
      maxLat,
      maxLon,
      query: parsed.data.q,
    });
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

  r.get("/stops/:id/arrivals", async (req: Request, res: Response) => {
    const rawId = req.params.id;
    const stopId = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!stopId) {
      res.status(400).json({ error: "Missing stop id" });
      return;
    }
    const minutesAfter = req.query.minutesAfter
      ? Number(req.query.minutesAfter)
      : undefined;
    const minutesBefore = req.query.minutesBefore
      ? Number(req.query.minutesBefore)
      : undefined;
    const data = await service.arrivalsForStop(stopId, {
      minutesAfter,
      minutesBefore,
    });
    res.setHeader("Cache-Control", "public, max-age=15");
    res.json(data);
  });

  return r;
}
