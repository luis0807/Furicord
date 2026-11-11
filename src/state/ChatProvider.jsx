import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { io } from "socket.io-client";
import { SERVER_URL } from "../lib/config.js";
import { fetchMessages } from "../lib/api.js";
import { getClientId, getSavedView, saveView } from "../lib/identity.js";
import { ChatContext } from "./chat-context.js";
import { TYPING_TTL_MS, chatReducer, createInitialState } from "./chatReducer.js";

const REJECTIONS = {
  NAME_TAKEN: "Esse nome já está sendo usado por alguém online agora. Escolha outro.",
  INVALID_NAME: "Nome inválido. Use de 2 a 32 caracteres.",
};

export function ChatProvider({ name, onRejected, onLogout, children }) {
  const [state, dispatch] = useReducer(chatReducer, null, () => createInitialState(getSavedView()));
  const [socket, setSocket] = useState(null);

  // Os callbacks do pai podem mudar a cada render; o socket só precisa do mais recente.
  const callbacks = useRef({ onRejected, onLogout });
  useEffect(() => {
    callbacks.current = { onRejected, onLogout };
  });

  // Atualizado durante o render (e não num efeito) de propósito: os efeitos dos filhos
  // rodam antes dos do provider, e o ChannelView chama loadMessages num efeito logo
  // depois de uma reconexão — ele precisa enxergar a `generation` nova.
  const stateRef = useRef(state);
  stateRef.current = state;
  const inflight = useRef(new Set());

  useEffect(() => {
    const options = { auth: { name, clientId: getClientId() } };
    const client = SERVER_URL ? io(SERVER_URL, options) : io(options);

    client.on("session", (session) => dispatch({ type: "session", session }));
    client.on("disconnect", () => dispatch({ type: "disconnected" }));
    client.on("connect_error", (err) => {
      // `active` = o cliente vai tentar de novo sozinho (servidor fora do ar / acordando).
      // Se não está ativo, foi o servidor que recusou a conexão (ex: nome em uso).
      if (!client.active) callbacks.current.onRejected(REJECTIONS[err.message] ?? err.message);
    });
    client.on("presence", (users) => dispatch({ type: "presence", users }));
    client.on("voice:state", (voice) => dispatch({ type: "voice", voice }));
    client.on("message:new", (message) => dispatch({ type: "message", message }));
    client.on("typing", ({ channelId, name: who }) =>
      dispatch({ type: "typing", channelId, name: who, until: Date.now() + TYPING_TTL_MS }),
    );

    setSocket(client);
    return () => {
      client.disconnect();
      setSocket(null);
    };
  }, [name]);

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

  const logout = useCallback(() => {
    socket?.disconnect();
    callbacks.current.onLogout();
  }, [socket]);

  const value = useMemo(
    () => ({ state, socket, loadMessages, sendMessage, emitTyping, setView, logout }),
    [state, socket, loadMessages, sendMessage, emitTyping, setView, logout],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
