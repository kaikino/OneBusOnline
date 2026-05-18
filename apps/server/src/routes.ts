import { type RequestHandler, Router } from "express";
import { z } from "zod";
import { cacheEnabled, cachedStops } from "./cache.js";
import {
  arrivalsForStop,
  obaConfigured,
  routeShape,
  routeVehicles,
  searchStops,
  stopsInBbox,
} from "./oba.js";

const bboxQuery = z
  .object({
    minLat: z.coerce.number().min(-90).max(90),
    minLon: z.coerce.number().min(-180).max(180),
    maxLat: z.coerce.number().min(-90).max(90),
    maxLon: z.coerce.number().min(-180).max(180),
  })
  .refine((b) => b.minLat < b.maxLat && b.minLon < b.maxLon, "Invalid bbox ordering");

const searchQuery = z.object({
  q: z.string().trim().min(1).max(200),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lon: z.coerce.number().min(-180).max(180).optional(),
});

const arrivalsQuery = z.object({
  minutesAfter: z.coerce.number().int().min(1).max(1440).default(120),
  minutesBefore: z.coerce.number().int().min(0).max(120).default(15),
});

const requireOba: RequestHandler = (_req, res, next) => {
  if (obaConfigured) return next();
  res.status(503).json({ error: "Server missing ONEBUSAWAY_API_KEY" });
};

export const routes = Router();

routes.get("/health", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, obaConfigured, cacheEnabled });
});

routes.get("/stops/snapshot", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=120");
  res.json(await cachedStops());
});

routes.use(requireOba);

routes.get("/stops/bbox", async (req, res) => {
  const bbox = bboxQuery.parse(req.query);
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  res.json(await stopsInBbox(bbox));
});

routes.get("/stops/search", async (req, res) => {
  const { q, lat, lon } = searchQuery.parse(req.query);
  const origin = lat !== undefined && lon !== undefined ? { lat, lon } : undefined;
  res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
  res.json(await searchStops(q, origin));
});

routes.get("/stops/:id/arrivals", async (req, res) => {
  const { minutesAfter, minutesBefore } = arrivalsQuery.parse(req.query);
  res.set("Cache-Control", "public, max-age=15");
  res.json(await arrivalsForStop(req.params.id, minutesAfter, minutesBefore));
});

routes.get("/routes/:id/shape", async (req, res) => {
  res.set("Cache-Control", "public, max-age=3600, stale-while-revalidate=86400");
  res.json(await routeShape(req.params.id));
});

routes.get("/routes/:id/vehicles", async (req, res) => {
  res.set("Cache-Control", "public, max-age=10");
  res.json(await routeVehicles(req.params.id));
});
