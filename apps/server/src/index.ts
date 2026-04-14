import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import { obaConfigured } from "./oba.js";
import { routes } from "./routes.js";

if (!obaConfigured) {
  console.warn("ONEBUSAWAY_API_KEY not set: only the health check is available");
}

const port = Number(process.env.PORT ?? 3001);
const corsOrigins = (process.env.CORS_ORIGIN ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const handleError: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: err.flatten() });
    return;
  }
  console.error(err);
  res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
};

const app = express();
app.use(
  cors({ origin: corsOrigins.length > 0 ? corsOrigins : process.env.NODE_ENV !== "production" }),
);
app.use("/api/v1", routes);
app.use(handleError);

app.listen(port, () => {
  console.log(`OneBusOnline API listening on http://localhost:${port}`);
});
