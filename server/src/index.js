import http from "node:http";
import express from "express";
import cors from "cors";
import { PORT, CORS_ORIGIN, CLOUDFLARE_TURN, ICE_SERVERS } from "./config.js";
import { getIceServers } from "./lib/ice.js";
import { connectDB } from "./db.js";
import { attachSocket } from "./socket.js";
import { notFound, errorHandler } from "./middleware/error.js";
import channelsRoutes from "./routes/channels.routes.js";
import uploadsRoutes from "./routes/uploads.routes.js";
import accountsRoutes from "./routes/accounts.routes.js";

const app = express();

// O Render fica atrás de um proxy; sem isso req.ip seria sempre o IP do proxy
// e o limite de uploads valeria para todo mundo junto.
app.set("trust proxy", 1);
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "100kb" }));

app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.get("/api/ice", async (req, res) => {
  res.set("Cache-Control", "no-store"); // credenciais TURN são temporárias
  res.json({ iceServers: await getIceServers() });
});
app.use("/api/channels", channelsRoutes);
app.use("/api/uploads", uploadsRoutes);
app.use("/api/accounts", accountsRoutes);

app.use(notFound);
app.use(errorHandler);

// Socket.IO precisa do servidor HTTP "cru" para fazer o upgrade para WebSocket.
const server = http.createServer(app);
attachSocket(server);

connectDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Furicord API rodando em http://localhost:${PORT}`);
      const staticTurn = ICE_SERVERS.some((s) => [s.urls].flat().some((url) => url.startsWith("turn")));
      if (CLOUDFLARE_TURN) console.log("Voz: TURN da Cloudflare ativado");
      else if (!staticTurn) console.warn("Voz: sem servidor TURN — quem estiver em 4G/CGNAT pode não conseguir conectar.");
    });
  })
  .catch((err) => {
    console.error("Falha ao conectar no MongoDB:", err.message);
    process.exit(1);
  });
