import { Server } from "socket.io";
import { CORS_ORIGIN, MAX_ATTACHMENTS, MAX_MESSAGE_LENGTH, MAX_VOICE_PEERS } from "./config.js";
import { TEXT_CHANNELS, VOICE_CHANNELS, findTextChannel, findVoiceChannel } from "./channels.js";
import { Message, serializeMessage } from "./models/Message.js";
import { Upload } from "./models/Upload.js";
import { isObjectId } from "./lib/http.js";
import { createRateLimiter } from "./lib/rateLimit.js";
import { nameKey, normalizeName } from "./lib/names.js";

/*
 * Eventos (cliente -> servidor)
 *   message:send { channelId, content, attachmentIds }   -> ack { ok, message } | { error }
 *   typing       { channelId }
 *   voice:join   { channelId, sid, muted, deafened, sharing } -> ack { ok, peers } | { error }
 *   voice:update { muted?, deafened?, sharing? }
 *   voice:leave
 *   rtc:signal   { to, data }   (oferta/resposta/candidato ICE, repassado sem olhar o conteúdo)
 *
 * Eventos (servidor -> cliente)
 *   session      { self, channels, users, voice }   (logo após conectar/reconectar)
 *   presence     [{ name }]
 *   voice:state  [{ id, sid, name, channelId, muted, deafened, sharing }]
 *   message:new  message
 *   typing       { channelId, name }
 *   rtc:signal   { from, data }
 *
 * Estado de presença e voz fica só em memória: se o servidor reiniciar, todo mundo
 * reconecta sozinho e o estado se reconstrói.
 */
export function attachSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: CORS_ORIGIN },
    maxHttpBufferSize: 256 * 1024,
  });

  // Nome em minúsculas -> dono. O mesmo nome pode estar em várias abas (sockets),
  // desde que seja o mesmo navegador (clientId salvo no localStorage).
  const users = new Map();
  // socket.id -> participante de voz. Cada aba conta como um participante.
  const voice = new Map();

  const allowMessage = createRateLimiter({ windowMs: 5000, max: 5 });

  const listUsers = () =>
    [...users.values()]
      .map((user) => ({ name: user.name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const listVoice = () => [...voice.values()];
  const broadcastPresence = () => io.emit("presence", listUsers());
  const broadcastVoice = () => io.emit("voice:state", listVoice());

  // Sem login: o "cadastro" é só escolher um nome que ninguém online esteja usando.
  io.use((socket, next) => {
    const name = normalizeName(socket.handshake.auth?.name);
    const rawClientId = socket.handshake.auth?.clientId;
    const clientId = typeof rawClientId === "string" ? rawClientId.slice(0, 64) : "";
    if (!name) return next(new Error("INVALID_NAME"));
    if (!clientId) return next(new Error("INVALID_CLIENT"));

    const key = nameKey(name);
    const owner = users.get(key);
    if (owner && owner.clientId !== clientId) return next(new Error("NAME_TAKEN"));

    // Registra já aqui para outro socket com o mesmo nome não passar no meio do caminho.
    if (owner) owner.sockets.add(socket.id);
    else users.set(key, { name, clientId, sockets: new Set([socket.id]) });

    Object.assign(socket.data, { name: owner?.name ?? name, key, isNewUser: !owner });
    next();
  });

  io.on("connection", (socket) => {
    const { name, key } = socket.data;
    const reply = (ack) => (typeof ack === "function" ? ack : () => {});

    socket.emit("session", {
      self: { id: socket.id, name },
      channels: { text: TEXT_CHANNELS, voice: VOICE_CHANNELS },
      users: listUsers(),
      voice: listVoice(),
    });
    if (socket.data.isNewUser) broadcastPresence();

    socket.on("message:send", async (payload, ack) => {
      const respond = reply(ack);
      try {
        const channel = findTextChannel(payload?.channelId);
        if (!channel) return respond({ error: "Canal não encontrado" });

        const content = typeof payload.content === "string" ? payload.content.trim() : "";
        if (content.length > MAX_MESSAGE_LENGTH) {
          return respond({ error: `Mensagem muito longa (máx. ${MAX_MESSAGE_LENGTH} caracteres)` });
        }

        const ids = Array.isArray(payload.attachmentIds)
          ? [...new Set(payload.attachmentIds.filter(isObjectId))].slice(0, MAX_ATTACHMENTS)
          : [];
        if (!content && ids.length === 0) return respond({ error: "Mensagem vazia" });

        if (!allowMessage(key)) {
          return respond({ error: "Calma! Você está mandando mensagens rápido demais." });
        }

        const uploads = ids.length
          ? await Upload.find({ _id: { $in: ids } }, { data: 0 }).lean()
          : [];
        const byId = new Map(uploads.map((upload) => [String(upload._id), upload]));
        const attachments = ids
          .map((id) => byId.get(id))
          .filter(Boolean)
          .map((upload) => ({
            upload: upload._id,
            name: upload.name,
            contentType: upload.contentType,
            size: upload.size,
            width: upload.width,
            height: upload.height,
          }));
        if (!content && attachments.length === 0) {
          return respond({ error: "As imagens não foram encontradas. Tente anexar de novo." });
        }

        const doc = await Message.create({ channelId: channel.id, author: name, content, attachments });
        const message = serializeMessage(doc);
        io.emit("message:new", message);
        respond({ ok: true, message });
      } catch (err) {
        console.error("Erro ao salvar mensagem:", err);
        respond({ error: "Não foi possível enviar a mensagem" });
      }
    });

    socket.on("typing", (payload) => {
      const channel = findTextChannel(payload?.channelId);
      if (channel) socket.broadcast.emit("typing", { channelId: channel.id, name });
    });

    // --- Voz -------------------------------------------------------------------
    // O servidor não toca em áudio nem vídeo: só diz quem está em cada sala e repassa
    // as mensagens de negociação do WebRTC. A mídia vai direto de navegador para navegador.

    socket.on("voice:join", (payload, ack) => {
      const respond = reply(ack);
      const channel = findVoiceChannel(payload?.channelId);
      if (!channel) return respond({ error: "Canal de voz não encontrado" });

      // `sid` identifica esta entrada na sala. Se a pessoa sair e voltar, muda,
      // e os outros sabem que precisam descartar a conexão antiga.
      const sid = typeof payload.sid === "string" ? payload.sid.slice(0, 64) : "";
      if (!sid) return respond({ error: "Sessão de voz inválida" });

      const peers = listVoice().filter((p) => p.channelId === channel.id && p.id !== socket.id);
      if (peers.length >= MAX_VOICE_PEERS) {
        return respond({ error: `A sala está cheia (máx. ${MAX_VOICE_PEERS} pessoas)` });
      }

      voice.set(socket.id, {
        id: socket.id,
        sid,
        name,
        channelId: channel.id,
        muted: Boolean(payload.muted),
        deafened: Boolean(payload.deafened),
        sharing: Boolean(payload.sharing),
      });
      respond({ ok: true, peers });
      broadcastVoice();
    });

    socket.on("voice:update", (patch) => {
      const entry = voice.get(socket.id);
      if (!entry || !patch) return;
      for (const field of ["muted", "deafened", "sharing"]) {
        if (typeof patch[field] === "boolean") entry[field] = patch[field];
      }
      broadcastVoice();
    });

    socket.on("voice:leave", () => {
      if (voice.delete(socket.id)) broadcastVoice();
    });

    socket.on("rtc:signal", (payload) => {
      const from = voice.get(socket.id);
      const to = voice.get(payload?.to);
      if (!from || !to || from.channelId !== to.channelId || !payload.data) return;
      io.to(to.id).emit("rtc:signal", { from: socket.id, data: payload.data });
    });

    socket.on("disconnect", () => {
      if (voice.delete(socket.id)) broadcastVoice();

      const owner = users.get(key);
      if (!owner) return;
      owner.sockets.delete(socket.id);
      if (owner.sockets.size === 0) {
        users.delete(key);
        broadcastPresence();
      }
    });
  });

  return io;
}
