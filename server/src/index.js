import http from "node:http";
import express from "express";
import cors from "cors";
import { PORT, CORS_ORIGIN, CLOUDFLARE_TURN, ICE_SERVERS } from "./config.js";
import { revokeTurnCredential } from "./lib/ice.js";
import { startTurnBudget, turnAlert, turnStatus } from "./lib/turnBudget.js";
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
// Quanto da franquia mensal do TURN já foi usada (só números, sem credenciais).
app.get("/api/turn", (req, res) => {
  res.set("Cache-Control", "no-store");
  res.json(CLOUDFLARE_TURN ? turnStatus() : { enabled: false });
});
app.use("/api/channels", channelsRoutes);
app.use("/api/uploads", uploadsRoutes);
app.use("/api/accounts", accountsRoutes);

app.use(notFound);
app.use(errorHandler);

// Socket.IO precisa do servidor HTTP "cru" para fazer o upgrade para WebSocket.
const server = http.createServer(app);
const io = attachSocket(server);

connectDB()
  .then(() =>
    startTurnBudget({
      onBlocked: () => {
        revokeTurnCredential();
        io.emit("turn:limit"); // os navegadores encerram o que passava pelo TURN
      },
      // Passou de 500 GB, de 700 GB ou do limite: faixa de aviso para quem está online.
      onAlert: () => io.emit("turn:alert", turnAlert()),
    }),
  )
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
