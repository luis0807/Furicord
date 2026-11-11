import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SERVER_URL } from "../lib/config.js";
import { fetchMessages } from "../lib/api.js";
import { getSavedView, getToken, rememberToken, saveView } from "../lib/identity.js";
import { playSound } from "../lib/sounds.js";
import { clearLegacyProfile, takeLegacyProfile } from "../lib/profile.js";
import { ChatContext, ProfilesContext } from "./chat-context.js";
import { TYPING_TTL_MS, chatReducer, createInitialState } from "./chatReducer.js";

const REJECTIONS = {
  NAME_TAKEN: "Esse nome já tem dono. Se for você, cole o seu código de acesso.",
  INVALID_NAME: "Nome inválido. Use de 2 a 32 caracteres.",
  UNKNOWN_CODE: "Código de acesso não encontrado. Confira se copiou ele inteiro.",
  INVALID_TOKEN: "Código de acesso inválido. Confira se copiou ele inteiro.",
  TOO_MANY_SIGNUPS: "Muitas contas criadas desta rede agora há pouco. Tente de novo mais tarde.",
  SERVER_ERROR: "O servidor teve um problema para te identificar. Tente de novo em instantes.",
};

function rejectionMessage(err, login) {
  if (err.message === "NAME_MISMATCH") {
    const account = err.data?.name ?? "outra conta";
    return login.token
      ? `Esse código de acesso é da conta “${account}”, não de “${login.name}”.`
      : `Este navegador está conectado à conta “${account}”. Entre com esse nome.`;
  }
  // Colou um código para um nome com dono e o servidor não reconheceu: código errado.
  if (err.message === "NAME_TAKEN" && login.token) {
    return `Código de acesso incorreto para “${login.name}”. Confira se copiou ele inteiro.`;
  }
  return REJECTIONS[err.message] ?? err.message;
}

// `login`: veja App.jsx. Ele só muda quando a pessoa entra ou sai, e é isso que
// recria a conexão.
export function ChatProvider({ login, onIdentity, onRejected, onLogout, children }) {
  const [state, dispatch] = useReducer(chatReducer, null, () => createInitialState(getSavedView()));
  const [socket, setSocket] = useState(null);

  // Os callbacks do pai podem mudar a cada render; o socket só precisa do mais recente.
  const callbacks = useRef({ onIdentity, onRejected, onLogout });
  useEffect(() => {
    callbacks.current = { onIdentity, onRejected, onLogout };
  });

  // Atualizado durante o render (e não num efeito) de propósito: os efeitos dos filhos
  // rodam antes dos do provider, e o ChannelView chama loadMessages num efeito logo
  // depois de uma reconexão — ele precisa enxergar a `generation` nova.
  const stateRef = useRef(state);
  stateRef.current = state;
  const inflight = useRef(new Set());

  useEffect(() => {
    const legacyProfile = takeLegacyProfile();
    // O código (novo, lembrado ou colado) só é gravado neste navegador depois que o
    // servidor aceitar — um código errado não pode bagunçar o que já estava salvo.
    const auth = { token: login.token ?? getToken(), name: login.name };
    if (login.resume) auth.resume = true;
    if (legacyProfile) auth.profile = legacyProfile;
    const options = { auth };
    const client = SERVER_URL ? io(SERVER_URL, options) : io(options);

    client.on("session", (session) => {
      rememberToken(auth.token); // daqui para frente, nesta conta basta digitar o nome
      if (auth.profile) clearLegacyProfile(); // o perfil antigo já virou o da conta
      // Reconexões automáticas daqui para frente: o nome pode mudar (trocar nome),
      // então o servidor só precisa reconhecer o código.
      client.auth = { token: auth.token, name: session.self.name, resume: true };
      // Quem manda no nome é o servidor (pode ter mudado em outro aparelho).
      callbacks.current.onIdentity(session.self.name);
      dispatch({ type: "session", session });
    });
    client.on("disconnect", () => dispatch({ type: "disconnected" }));
    client.on("connect_error", (err) => {
      // `active` = o cliente vai tentar de novo sozinho (servidor fora do ar / acordando).
      // Se não está ativo, foi o servidor que recusou a conexão (ex: nome de outra pessoa).
      if (!client.active) callbacks.current.onRejected(rejectionMessage(err, login), err.message);
    });
    client.on("account:renamed", ({ name }) => {
      callbacks.current.onIdentity(name);
      dispatch({ type: "renamed", name });
    });
    client.on("account:deleted", () => {
      callbacks.current.onRejected("Esta conta foi excluída (em outra aba ou outro aparelho).", "DELETED");
    });
    client.on("presence", (users) => dispatch({ type: "presence", users }));
    client.on("voice:state", (voice) => dispatch({ type: "voice", voice }));
    client.on("turn:alert", (alert) => dispatch({ type: "turnAlert", alert }));
    client.on("message:new", (message) => {
      // Igual ao Discord: não toca se você está olhando para esse canal agora.
      const { self, view } = stateRef.current;
      const watching = view?.type === "text" && view.id === message.channelId && document.hasFocus();
      if (message.author !== self?.name && !watching) playSound("message");
      dispatch({ type: "message", message });
    });
    client.on("typing", ({ channelId, name: who }) =>
      dispatch({ type: "typing", channelId, name: who, until: Date.now() + TYPING_TTL_MS }),
    );

    setSocket(client);
    return () => {
      client.disconnect();
      setSocket(null);
    };
  }, [login]);

  // "Fulano está digitando…" some sozinho se a pessoa parar de digitar.
  const hasTyping = Object.keys(state.typing).length > 0;
  useEffect(() => {
    if (!hasTyping) return;
    const timer = setInterval(() => dispatch({ type: "pruneTyping", now: Date.now() }), 1000);
    return () => clearInterval(timer);
  }, [hasTyping]);

  const loadMessages = useCallback(async (channelId, { older = false } = {}) => {
    const { messages, generation } = stateRef.current;
    const channel = messages[channelId];
    // Vários eventos de scroll podem chegar antes do próximo render: evita pedir duas vezes.
    const key = `${generation}:${channelId}`;
    if (inflight.current.has(key)) return;
    if (older && (!channel?.loaded || !channel.hasMore || !channel.items.length)) return;

    inflight.current.add(key);
    dispatch({ type: "loadStart", channelId });
    try {
      const before = older ? channel.items[0].id : undefined;
      const result = await fetchMessages(channelId, before);
      dispatch({ type: "loadDone", channelId, generation, messages: result.messages, hasMore: result.hasMore });
    } catch (err) {
      dispatch({ type: "loadFail", channelId, generation, error: err.message });
    } finally {
      inflight.current.delete(key);
    }
  }, []);

  const sendMessage = useCallback(
    async (channelId, content, attachmentIds = []) => {
      if (!socket?.connected) return { error: "Sem conexão com o servidor" };
      try {
        return await socket.timeout(10_000).emitWithAck("message:send", { channelId, content, attachmentIds });
      } catch {
        return { error: "O servidor não respondeu. Tente de novo." };
      }
    },
    [socket],
  );

  const emitTyping = useCallback((channelId) => socket?.emit("typing", { channelId }), [socket]);

  const setView = useCallback((view) => {
    saveView(view);
    dispatch({ type: "view", view });
  }, []);

  // { forget: true } = "Sair e esquecer este navegador": aqui, a próxima entrada nesta
  // conta vai pedir o código de acesso. Sem isso, basta digitar o nome para voltar.
  const logout = useCallback(
    ({ forget = false } = {}) => {
      socket?.disconnect();
      callbacks.current.onLogout({ forget });
    },
    [socket],
  );

  // Desiste de entrar (ex: servidor demorando para acordar): volta para a tela de
  // entrada sem esquecer a conta deste navegador, ao contrário do logout.
  const cancelLogin = useCallback(() => {
    socket?.disconnect();
    callbacks.current.onRejected(null, "CANCELLED");
  }, [socket]);

  // Pedidos que mexem na conta (perfil, nome, exclusão): o servidor salva no banco.
  const request = useCallback(
    async (event, payload) => {
      if (!socket?.connected) return { error: "Sem conexão com o servidor. Tente de novo em instantes." };
      try {
        return await socket.timeout(10_000).emitWithAck(event, payload);
      } catch {
        return { error: "O servidor não respondeu. Tente de novo." };
      }
    },
    [socket],
  );

  const updateProfile = useCallback((profile) => request("profile:update", profile), [request]);
  const renameAccount = useCallback((name) => request("account:rename", { name }), [request]);
  const deleteAccount = useCallback(async () => {
    const result = await request("account:delete");
    if (result?.ok) {
      socket?.disconnect();
      callbacks.current.onLogout({ forget: true }); // a conta não existe mais
    }
    return result;
  }, [request, socket]);

  const value = useMemo(
    () => ({
      state,
      socket,
      loadMessages,
      sendMessage,
      emitTyping,
      setView,
      logout,
      cancelLogin,
      updateProfile,
      renameAccount,
      deleteAccount,
    }),
    [
      state,
      socket,
      loadMessages,
      sendMessage,
      emitTyping,
      setView,
      logout,
      cancelLogin,
      updateProfile,
      renameAccount,
      deleteAccount,
    ],
  );

  const profiles = useMemo(
    () => new Map(state.users.map((user) => [user.name, user.profile ?? null])),
    [state.users],
  );

  return (
    <ChatContext.Provider value={value}>
      <ProfilesContext.Provider value={profiles}>{children}</ProfilesContext.Provider>
    </ChatContext.Provider>
  );
}
