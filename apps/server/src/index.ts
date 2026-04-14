import app from "./app.js";
import { closeCache } from "./cache.js";

const port = Number(process.env.PORT ?? 3001);

const server = app.listen(port, () => {
  console.log(`OneBusOnline API listening on http://localhost:${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(async () => {
      await closeCache();
      process.exit(0);
    });
  });
}
