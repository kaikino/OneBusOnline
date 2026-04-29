import { VitePWA } from "vite-plugin-pwa";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/icon.png", "robots.txt"],
      manifest: {
        name: "OneBusOnline",
        short_name: "OneBusOnline",
        description:
          "Puget Sound & greater Seattle area bus routes, schedules, and real-time arrivals—OneBusAway",
        theme_color: "#0f172a",
        background_color: "#0f172a",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        icons: [
          {
            src: "/icons/icon.png",
            sizes: "256x256",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon.png",
            sizes: "256x256",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "NetworkOnly",
          },
        ],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    host: true,
    headers: {
      "Permissions-Policy": "geolocation=(self)",
    },
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
});
