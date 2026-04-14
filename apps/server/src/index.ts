import "./loadEnv.js";
import app from "./app.js";
import { closeStopListCache, stopListCacheBackend } from "./stopListCache.js";

const PORT = Number(process.env.PORT ?? 3001);

const server = app.listen(PORT, () => {
  console.log(
    `OneBusOnline server http://localhost:${PORT} (stop cache: ${stopListCacheBackend()})`
  );
});
server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(
      `[bff] Port ${PORT} is already in use.\n` +
        `  Stop the other process, or set PORT=3002 in .env\n` +
        `  Find PID (macOS):  lsof -nP -iTCP:${PORT} | grep LISTEN\n` +
        `  Then:            kill <PID>`
    );
    process.exit(1);
    return;
  }
  console.error("[bff] HTTP server error:", err);
  process.exit(1);
});

function shutdown(signal: string) {
  console.log(`[bff] ${signal} — closing`);
  void closeStopListCache().finally(() => {
    server.close(() => process.exit(0));
  });
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
