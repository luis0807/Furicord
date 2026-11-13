import { Server } from "socket.io";
import { ADMIN_NAMES, CORS_ORIGIN, MAX_ATTACHMENTS, MAX_MESSAGE_LENGTH, MAX_VOICE_PEERS } from "./config.js";
import { TEXT_CHANNELS, VOICE_CHANNELS, findTextChannel, findVoiceChannel } from "./channels.js";
import { Message, serializeMessage } from "./models/Message.js";
import { Upload } from "./models/Upload.js";
import { User, isDuplicateKey } from "./models/User.js";
import { isObjectId } from "./lib/http.js";
import { createRateLimiter } from "./lib/rateLimit.js";
import { nameKey, normalizeName } from "./lib/names.js";
import { messageProfile, sanitizeProfile } from "./lib/profile.js";
import { cleanToken, clientIp, hashToken } from "./lib/accounts.js";
import { getIceConfig } from "./lib/ice.js";
import { addConnectionPath, addTurnUsage, turnAlert, turnStats } from "./lib/turnBudget.js";

// Lista de membros: quantas contas offline ficam guardadas e quantas aparecem.
const MAX_LOADED_ACCOUNTS = 1000;
const MAX_OFFLINE_LISTED = 200;
// De quanto em quanto tempo a lista é conferida com o banco (contas excluídas,
// criadas ou renomeadas fora deste servidor).
const REFRESH_MS = 30_000;
// Avisos de uso do TURN: o máximo que um navegador pode declarar de uma vez.
const TURN_REPORT_MAX_MS = 2 * 60_000;
const TURN_REPORT_MAX_BPS = 40_000_000;

/*
 * Conexão: auth { token, name?, resume?, profile? }
 *   token   = código de acesso secreto deste navegador (a "conta", sem senha)
 *   name    = nome digitado. Sem conta: cria a conta com ele. Com conta: precisa
 *             ser o nome dela (senão NAME_MISMATCH, com err.data.name = nome da conta)
 *   resume  = reconexão automática (nome salvo): não confere o nome, que pode ter
 *             mudado em outro aparelho
 *   profile = perfil antigo que estava só no navegador (migra para a conta nova)
 *   Erros: INVALID_TOKEN, UNKNOWN_CODE, INVALID_NAME, NAME_TAKEN, NAME_MISMATCH,
 *          TOO_MANY_SIGNUPS, SERVER_ERROR
 *
 * Eventos (cliente -> servidor)
 *   message:send { channelId, content, attachmentIds }   -> ack { ok, message } | { error }
 *   typing       { channelId }
 *   voice:join   { channelId, sid, muted, deafened, sharing } -> ack { ok, peers } | { error }
 *   voice:update { muted?, deafened?, sharing? }
 *   voice:leave
 *   ice:get      -> ack { iceServers, turnLimited } | { error }
 *   turn:usage   { bytes, screen }   (bytes recebidos pelo TURN desde o último aviso; screen = parte da tela)
 *   rtc:path     { path }    (uma conexão de voz se estabeleceu: "local" | "direct" | "relay")
 *   turn:stats   -> ack { ...turnStats() } | { error }   (só contas em ADMIN_NAMES)
 *   rtc:signal   { to, data }   (oferta/resposta/candidato ICE, repassado sem olhar o conteúdo)
 *   profile:update profile      -> ack { ok, profile } | { error }
 *   account:rename { name }     -> ack { ok, name } | { error }
 *   account:delete              -> ack { ok } | { error }
 *
 * Eventos (servidor -> cliente)
 *   session      { self: { id, name, isNew, isAdmin }, channels, users, voice, turnAlert }   (após conectar/reconectar)
 *   turn:alert   { month, usedGB, limitGB, alertGB, blocked }   (consumo do TURN passou de um alerta)
 *   turn:limit                  (limite mensal do TURN atingido: encerrar o que passa por ele)
 *   account:renamed { name }    (para todas as abas da conta)
 *   account:deleted             (para as outras abas, ou se a conta for excluída fora daqui)
 *   presence     [{ name, profile, online }]   (contas online e as offline mais recentes)
 *   voice:state  [{ id, sid, name, channelId, muted, deafened, sharing }]
 *   message:new  message
 *   typing       { channelId, name }
 *   rtc:signal   { from, data }
 *
 * Estado de presença e voz fica só em memória: se o servidor reiniciar, todo mundo
 * reconecta sozinho e o estado se reconstrói. A lista de offline vem do banco.
 */
export function attachSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: CORS_ORIGIN },
    maxHttpBufferSize: 256 * 1024,
  });

  // Quem está online: nome em minúsculas -> { userId, name, sockets, profile }.
  // A mesma conta pode estar em várias abas (sockets) ao mesmo tempo.
  const users = new Map();
  // Quem não está online: nome em minúsculas -> { name, profile, lastSeenAt }.
  // Vem do banco (refreshMembers) e é mantido aqui entre uma conferência e outra.
  let offline = new Map();
  // Contas excluídas aqui durante uma conferência do banco: a leitura pode ter sido
  // feita antes da exclusão e não pode trazê-las de volta.
  const deletedKeys = new Set();
  // socket.id -> participante de voz. Cada aba conta como um participante.
  const voice = new Map();

  const allowMessage = createRateLimiter({ windowMs: 5000, max: 5 });
  const allowProfile = createRateLimiter({ windowMs: 10_000, max: 5 });
  const allowRename = createRateLimiter({ windowMs: 60_000, max: 3 });
  // Contas novas por IP: impede reservar um monte de nomes num script.
  const allowSignup = createRateLimiter({ windowMs: 60 * 60_000, max: 20 });
  // Avisos de "conexão estabelecida" (só estatística): uma sala cheia gera poucos.
  const allowPathReport = createRateLimiter({ windowMs: 60_000, max: 30 });
  const allowStats = createRateLimiter({ windowMs: 10_000, max: 5 });

  const byName = (a, b) => a.name.localeCompare(b.name, "pt-BR");
  // Todos online + os offline vistos mais recentemente (para a lista não crescer sem fim).
  const listUsers = () => [
    ...[...users.values()].map((user) => ({ name: user.name, profile: user.profile ?? null, online: true })).sort(byName),
    ...[...offline.values()]
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, MAX_OFFLINE_LISTED)
      .map((user) => ({ name: user.name, profile: user.profile ?? null, online: false }))
      .sort(byName),
  ];
  const listVoice = () => [...voice.values()];
  const broadcastPresence = () => io.emit("presence", listUsers());
  const broadcastVoice = () => io.emit("voice:state", listVoice());

  // Confere a lista de membros com o banco. Necessário porque contas podem ser
  // criadas, renomeadas ou excluídas fora deste processo: pelo site publicado (outro
  // servidor usando o mesmo banco) ou direto no painel do MongoDB.
  let refreshing = null;
  const refreshMembers = () => {
    refreshing ??= (async () => {
      deletedKeys.clear();
      const docs = await User.find({}, { name: 1, nameKey: 1, profile: 1, lastSeenAt: 1 })
        .sort({ lastSeenAt: -1 })
        .limit(MAX_LOADED_ACCOUNTS)
        .lean();
      const onlineIds = [...users.values()].map((user) => user.userId);
      const alive = new Set(
        (await User.find({ _id: { $in: onlineIds } }, { _id: 1 }).lean()).map((doc) => String(doc._id)),
      );

      const before = JSON.stringify(listUsers());
      const next = new Map();
      for (const doc of docs) {
        if (users.has(doc.nameKey) || deletedKeys.has(doc.nameKey)) continue;
        next.set(doc.nameKey, { name: doc.name, profile: doc.profile ?? null, lastSeenAt: doc.lastSeenAt?.getTime() ?? 0 });
      }
      offline = next;

      // Conta excluída em outro lugar com alguém online nela: derruba as abas.
      for (const owner of users.values()) {
        if (!onlineIds.includes(owner.userId) || alive.has(owner.userId)) continue;
        owner.deleted = true;
        for (const id of [...owner.sockets]) {
          const tab = io.sockets.sockets.get(id);
          if (!tab) continue;
          tab.emit("account:deleted");
          tab.disconnect();
        }
      }

      if (JSON.stringify(listUsers()) !== before) broadcastPresence();
    })()
      .catch((err) => console.error("Erro ao conferir a lista de membros:", err))
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  };
  const firstLoad = refreshMembers(); // as primeiras conexões esperam por ela
  setInterval(refreshMembers, REFRESH_MS).unref();

  // Identifica quem está chegando. Com conta (código já conhecido), vale o nome
  // salvo no banco. Sem conta, cria uma — e o nome fica reservado para este navegador.
  io.use(async (socket, next) => {
    try {
      await firstLoad; // só espera de verdade logo que o servidor liga
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
      } else if (!auth.resume && auth.name != null && nameKey(normalizeName(auth.name) ?? "") !== account.nameKey) {
        // Entrada digitada: o nome tem que ser o da conta deste código.
        const err = new Error("NAME_MISMATCH");
        err.data = { name: account.name };
        return next(err);
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
    const isAdmin = () => ADMIN_NAMES.includes(socket.data.key);

    const online = me();
    if (online) online.sockets.add(socket.id);
    else {
      offline.delete(socket.data.key);
      users.set(socket.data.key, {
        userId: socket.data.userId,
        name: socket.data.name,
        sockets: new Set([socket.id]),
        profile: socket.data.profile,
      });
    }

    socket.emit("session", {
      self: { id: socket.id, name: socket.data.name, isNew: socket.data.isNew, isAdmin: isAdmin() },
      channels: { text: TEXT_CHANNELS, voice: VOICE_CHANNELS },
      users: listUsers(),
      voice: listVoice(),
      turnAlert: turnAlert(), // consumo do TURN já passou de um alerta? (ou null)
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
      owner.deleted = true; // ao desconectar, não vai para a lista de offline
      deletedKeys.add(socket.data.key);
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

    // Servidores STUN/TURN para a chamada. As credenciais do TURN são temporárias.
    socket.on("ice:get", async (payload, ack) => {
      const respond = reply(payload, ack);
      try {
        respond(await getIceConfig());
      } catch {
        respond({ error: "Não foi possível obter os servidores de voz" });
      }
    });

    // O navegador avisa quantos bytes recebeu pelo TURN desde o último aviso.
    socket.on("turn:usage", (payload) => {
      if (!voice.has(socket.id)) return;
      const now = Date.now();
      const elapsed = Math.min(now - (socket.data.turnReportAt ?? now - TURN_REPORT_MAX_MS), TURN_REPORT_MAX_MS);
      socket.data.turnReportAt = now;
      // Teto por aviso: um número absurdo (bug ou má-fé) não desliga o TURN de todos.
      const ceiling = (TURN_REPORT_MAX_BPS / 8) * (elapsed / 1000);
      const bytes = Math.min(Number(payload?.bytes) || 0, ceiling);
      if (bytes > 0) addTurnUsage(bytes, { userId: socket.data.userId, screen: Number(payload?.screen) || 0 });
    });

    // Por onde uma conexão de voz passou. Só um dos dois lados avisa (ver VoiceEngine).
    socket.on("rtc:path", (payload) => {
      if (!voice.has(socket.id) || !allowPathReport(socket.id)) return;
      addConnectionPath(payload?.path);
    });

    // Painel "Servidor de voz": consumo do TURN em detalhes.
    socket.on("turn:stats", async (payload, ack) => {
      const respond = reply(payload, ack);
      if (!isAdmin()) return respond({ error: "Só administradores veem este painel." });
      if (!allowStats(socket.id)) return respond({ error: "Calma! Espere alguns segundos para atualizar de novo." });
      try {
        respond(await turnStats());
      } catch (err) {
        console.error("Erro ao montar as estatísticas do TURN:", err);
        respond({ error: "Não foi possível carregar as estatísticas. Tente de novo." });
      }
    });

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
        if (!owner.deleted) {
          const lastSeenAt = Date.now();
          offline.set(socket.data.key, { name: owner.name, profile: owner.profile ?? null, lastSeenAt });
          User.updateOne({ _id: owner.userId }, { $set: { lastSeenAt: new Date(lastSeenAt) } }).catch(() => {});
        }
        broadcastPresence();
      }
    });
  });

  return io;
}
