import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { APIError, NotFoundError } from "onebusaway-sdk";
import { ZodError } from "zod";
import { obaConfigured } from "./oba.js";
import { routes } from "./routes.js";

if (!obaConfigured) {
  console.warn("ONEBUSAWAY_API_KEY not set: only health and cached stops are available");
}

const corsOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.flatten() });
    return;
  }
  if (err instanceof NotFoundError) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  console.error(err);
  if (err instanceof APIError) {
    res.status(502).json({ error: "OneBusAway request failed" });
    return;
  }
  res.status(500).json({ error: "Internal server error" });
};

const app = express();
app.use(
  cors({ origin: corsOrigins.length > 0 ? corsOrigins : process.env.NODE_ENV !== "production" }),
);
app.use("/api/v1", routes);
app.use(handleError);

export default app;
