import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Em dev, o front e a API parecem estar na mesma origem: o Vite repassa /api e
// /socket.io (incluindo o WebSocket) para o Express em localhost:4000. Por isso
// VITE_SERVER_URL fica vazio no desenvolvimento.
export default defineConfig({
  plugins: [react()],
  // Pacotes do Tauri são importados sob demanda (só no app de desktop). Sem isto, o
  // servidor de desenvolvimento os prepara tarde e responde 504 na primeira vez.
  optimizeDeps: {
    include: [
      "@tauri-apps/api/app",
      "@tauri-apps/api/core",
      "@tauri-apps/plugin-autostart",
      "@tauri-apps/plugin-process",
      "@tauri-apps/plugin-updater",
    ],
  },
  // Commit do deploy (o Vercel informa no build); "local" fora dele.
  define: {
    __SITE_COMMIT__: JSON.stringify((process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7) || "local"),
  },
  server: {
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/socket.io": { target: "http://localhost:4000", changeOrigin: true, ws: true },
    },
  },
});
