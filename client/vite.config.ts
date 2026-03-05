import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vitejs.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Tauri expects a fixed port
  server: {
    port: 1420,
    strictPort: true,
    host: "localhost",
    // Proxy API calls to the Docker stack during development
    proxy: {
      "/api": "http://localhost:80",
      "/hls": "http://localhost:80",
      "/ingest": "http://localhost:80",
    },
  },

  // Environment variables exposed to the renderer
  envPrefix: ["VITE_", "TAURI_"],
}));
