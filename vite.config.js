import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Em dev, o front e a API parecem estar na mesma origem: o Vite repassa /api e
// /socket.io (incluindo o WebSocket) para o Express em localhost:4000. Por isso
// VITE_SERVER_URL fica vazio no desenvolvimento.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/socket.io": { target: "http://localhost:4000", changeOrigin: true, ws: true },
    },
  },
});
