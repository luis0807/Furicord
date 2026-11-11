import { Server } from "socket.io";
import { CORS_ORIGIN, MAX_ATTACHMENTS, MAX_MESSAGE_LENGTH, MAX_VOICE_PEERS } from "./config.js";
import { TEXT_CHANNELS, VOICE_CHANNELS, findTextChannel, findVoiceChannel } from "./channels.js";
import { Message, serializeMessage } from "./models/Message.js";
import { Upload } from "./models/Upload.js";
import { User, isDuplicateKey } from "./models/User.js";
import { isObjectId } from "./lib/http.js";
import { createRateLimiter } from "./lib/rateLimit.js";
import { nameKey, normalizeName } from "./lib/names.js";
import { messageProfile, sanitizeProfile } from "./lib/profile.js";
import { cleanToken, clientIp, hashToken } from "./lib/accounts.js";

/*
 * Conexão: auth { token, name?, profile? }
 *   token   = código de acesso secreto deste navegador (a "conta", sem senha)
 *   name    = nome escolhido; só usado para criar a conta na primeira vez
 *   profile = perfil antigo que estava só no navegador (migra para a conta nova)
 *   Erros: INVALID_TOKEN, UNKNOWN_CODE, INVALID_NAME, NAME_TAKEN, TOO_MANY_SIGNUPS, SERVER_ERROR
 *
 * Eventos (cliente -> servidor)
 *   message:send { channelId, content, attachmentIds }   -> ack { ok, message } | { error }
 *   typing       { channelId }
 *   voice:join   { channelId, sid, muted, deafened, sharing } -> ack { ok, peers } | { error }
 *   voice:update { muted?, deafened?, sharing? }
 *   voice:leave
 *   rtc:signal   { to, data }   (oferta/resposta/candidato ICE, repassado sem olhar o conteúdo)
 *   profile:update profile      -> ack { ok, profile } | { error }
 *   account:rename { name }     -> ack { ok, name } | { error }
 *   account:delete              -> ack { ok } | { error }
 *
 * Eventos (servidor -> cliente)
 *   session      { self: { id, name, isNew }, channels, users, voice }   (após conectar/reconectar)
 *   account:renamed { name }    (para todas as abas da conta)
 *   account:deleted             (para as outras abas, antes de desconectar)
 *   presence     [{ name, profile }]
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

  // Quem está online: nome em minúsculas -> { userId, name, sockets, profile }.
  // A mesma conta pode estar em várias abas (sockets) ao mesmo tempo.
  const users = new Map();
  // socket.id -> participante de voz. Cada aba conta como um participante.
  const voice = new Map();

  const allowMessage = createRateLimiter({ windowMs: 5000, max: 5 });
  const allowProfile = createRateLimiter({ windowMs: 10_000, max: 5 });
  const allowRename = createRateLimiter({ windowMs: 60_000, max: 3 });
  // Contas novas por IP: impede reservar um monte de nomes num script.
  const allowSignup = createRateLimiter({ windowMs: 60 * 60_000, max: 20 });

  const listUsers = () =>
    [...users.values()]
      .map((user) => ({ name: user.name, profile: user.profile ?? null }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const listVoice = () => [...voice.values()];
  const broadcastPresence = () => io.emit("presence", listUsers());
  const broadcastVoice = () => io.emit("voice:state", listVoice());

  // Identifica quem está chegando. Com conta (código já conhecido), vale o nome
  // salvo no banco. Sem conta, cria uma — e o nome fica reservado para este navegador.
  io.use(async (socket, next) => {
    try {
      const auth = socket.handshake.auth ?? {};
      const token = cleanToken(auth.token);
      if (!token) return next(new Error("INVALID_TOKEN"));
      const tokenHash = hashToken(token);

      let account = await User.findOne({ tokenHash }).lean();
      let isNew = false;

      if (!account) {
        // Entrou só com o código (outro aparelho) e ele não existe.
        if (auth.name == null) return next(new Error("UNKNOWN_CODE"));
        const name = normalizeName(auth.name);
        if (!name) return next(new Error("INVALID_NAME"));
        if (await User.exists({ nameKey: nameKey(name) })) return next(new Error("NAME_TAKEN"));
        if (!allowSignup(clientIp(socket))) return next(new Error("TOO_MANY_SIGNUPS"));
        try {
          const doc = await User.create({
            name,
            nameKey: nameKey(name),
            tokenHash,
            profile: sanitizeProfile(auth.profile),
          });
          account = doc.toObject();
          isNew = true;
        } catch (err) {
          if (!isDuplicateKey(err)) throw err;
          // Outra aba deste navegador criou a conta no mesmo instante — ou alguém levou o nome.
          account = await User.findOne({ tokenHash }).lean();
          if (!account) return next(new Error("NAME_TAKEN"));
        }
      } else if (!account.profile && auth.profile) {
        // Conta sem perfil: aproveita o que ainda estava guardado só no navegador.
        const profile = sanitizeProfile(auth.profile);
        await User.updateOne({ _id: account._id }, { $set: { profile } });
        account.profile = profile;
      }

      User.updateOne({ _id: account._id }, { $set: { lastSeenAt: new Date() } }).catch(() => {});

      // Só anota quem é. Entrar na lista de online fica para o "connection": se a aba
      // fechar enquanto esperávamos o banco, o Socket.IO descarta a conexão sem
      // disparar "disconnect" e ela viraria um fantasma online para sempre.
      Object.assign(socket.data, {
        userId: String(account._id),
        name: account.name,
        key: account.nameKey,
        profile: account.profile ?? null,
        isNew,
      });
      next();
    } catch (err) {
      console.error("Erro ao identificar conexão:", err);
      next(new Error("SERVER_ERROR"));
    }
  });

  io.on("connection", (socket) => {
    // Nome e chave são lidos de socket.data a cada evento (e não guardados em
    // constantes) porque a pessoa pode trocar de nome com a conexão aberta.
    const me = () => users.get(socket.data.key);
    // A função de resposta chega como último argumento — ou como o primeiro, se o
    // cliente não mandou dados (ex: account:delete). Pega a que existir.
    const reply = (...args) => args.findLast((arg) => typeof arg === "function") ?? (() => {});

    const online = me();
    if (online) online.sockets.add(socket.id);
    else {
      users.set(socket.data.key, {
        userId: socket.data.userId,
        name: socket.data.name,
        sockets: new Set([socket.id]),
        profile: socket.data.profile,
      });
    }

    socket.emit("session", {
      self: { id: socket.id, name: socket.data.name, isNew: socket.data.isNew },
      channels: { text: TEXT_CHANNELS, voice: VOICE_CHANNELS },
      users: listUsers(),
      voice: listVoice(),
    });
    broadcastPresence();

    socket.on("profile:update", async (payload, ack) => {
      const respond = reply(payload, ack);
      const owner = me();
      if (!owner) return respond({ error: "Sessão inválida. Recarregue a página." });
      if (!allowProfile(socket.data.key)) return respond({ error: "Calma! Espere alguns segundos para salvar de novo." });

      const profile = sanitizeProfile(payload);
      if (!profile) return respond({ error: "Perfil inválido" });
      try {
        await User.updateOne({ _id: socket.data.userId }, { $set: { profile } });
      } catch (err) {
        console.error("Erro ao salvar perfil:", err);
        return respond({ error: "Não foi possível salvar o perfil. Tente de novo." });
      }
      owner.profile = profile;
      respond({ ok: true, profile });
      broadcastPresence();
    });

    socket.on("account:rename", async (payload, ack) => {
      const respond = reply(payload, ack);
      const owner = me();
      if (!owner) return respond({ error: "Sessão inválida. Recarregue a página." });
      const name = normalizeName(payload?.name);
      if (!name) return respond({ error: "Use de 2 a 32 caracteres." });
      if (!allowRename(socket.data.userId)) return respond({ error: "Calma! Espere um minuto para trocar de novo." });

      const oldKey = socket.data.key;
      const key = nameKey(name);
      try {
        // O índice único de nameKey garante que ninguém mais tem esse nome.
        await User.updateOne({ _id: socket.data.userId }, { $set: { name, nameKey: key } });
      } catch (err) {
        if (isDuplicateKey(err)) return respond({ error: "Esse nome já pertence a outra pessoa." });
        console.error("Erro ao trocar nome:", err);
        return respond({ error: "Não foi possível trocar o nome. Tente de novo." });
      }

      // Leva a conta (todas as abas, inclusive na voz) para o nome novo.
      users.delete(oldKey);
      owner.name = name;
      users.set(key, owner);
      for (const id of owner.sockets) {
        const tab = io.sockets.sockets.get(id);
        if (tab) Object.assign(tab.data, { name, key });
        const inVoice = voice.get(id);
        if (inVoice) inVoice.name = name;
        io.to(id).emit("account:renamed", { name });
      }
      respond({ ok: true, name });
      broadcastPresence();
      broadcastVoice();
    });

    socket.on("account:delete", async (payload, ack) => {
      const respond = reply(payload, ack);
      const owner = me();
      if (!owner) return respond({ error: "Sessão inválida. Recarregue a página." });
      try {
        await User.deleteOne({ _id: socket.data.userId });
      } catch (err) {
        console.error("Erro ao excluir conta:", err);
        return respond({ error: "Não foi possível excluir a conta. Tente de novo." });
      }
      respond({ ok: true });
      // Derruba todas as abas desta conta; o nome fica livre para outra pessoa.
      for (const id of [...owner.sockets]) {
        const tab = io.sockets.sockets.get(id);
        if (!tab) continue;
        if (id !== socket.id) tab.emit("account:deleted");
        tab.disconnect();
      }
    });

    socket.on("message:send", async (payload, ack) => {
      const respond = reply(payload, ack);
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

        if (!allowMessage(socket.data.key)) {
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

        const doc = await Message.create({
          channelId: channel.id,
          author: socket.data.name,
          authorProfile: messageProfile(me()?.profile),
          content,
          attachments,
        });
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
      if (channel) socket.broadcast.emit("typing", { channelId: channel.id, name: socket.data.name });
    });

    // --- Voz -------------------------------------------------------------------
    // O servidor não toca em áudio nem vídeo: só diz quem está em cada sala e repassa
    // as mensagens de negociação do WebRTC. A mídia vai direto de navegador para navegador.

    socket.on("voice:join", (payload, ack) => {
      const respond = reply(payload, ack);
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
        name: socket.data.name,
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

      const owner = me();
      if (!owner) return;
      owner.sockets.delete(socket.id);
      if (owner.sockets.size === 0) {
        users.delete(socket.data.key);
        broadcastPresence();
      }
    });
  });

  return io;
}
