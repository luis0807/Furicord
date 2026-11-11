export const TYPING_TTL_MS = 3500;

const emptyChannel = { items: [], loading: false, loaded: false, hasMore: true, error: null };

export function createInitialState(savedView) {
  return {
    status: "connecting", // connecting | online | offline
    // Incrementa a cada (re)conexão: respostas de histórico pedidas antes disso são descartadas.
    generation: 0,
    self: null,
    channels: { text: [], voice: [] },
    users: [],
    voice: [],
    messages: {}, // channelId -> { items, loading, loaded, hasMore, error }
    typing: {}, // channelId -> { nome: expiraEm }
    unread: {}, // channelId -> true
    view: savedView, // { type: "text" | "voice", id }
  };
}

// ObjectIds do mesmo servidor crescem com o tempo, então ordenar pelo id = ordem de envio.
function mergeMessages(...lists) {
  const byId = new Map();
  for (const list of lists) for (const message of list) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function withoutKey(object, key) {
  if (!(key in object)) return object;
  const copy = { ...object };
  delete copy[key];
  return copy;
}

function updateChannel(state, channelId, patch) {
  const current = state.messages[channelId] ?? emptyChannel;
  return { ...state, messages: { ...state.messages, [channelId]: { ...current, ...patch } } };
}

function isViewValid(view, channels) {
  if (!view) return false;
  const list = view.type === "voice" ? channels.voice : channels.text;
  return list.some((channel) => channel.id === view.id);
}

export function chatReducer(state, action) {
  switch (action.type) {
    case "session": {
      const { self, channels, users, voice } = action.session;
      const view = isViewValid(state.view, channels)
        ? state.view
        : { type: "text", id: channels.text[0]?.id };
      // O histórico é recarregado a cada reconexão para não perder o que chegou enquanto
      // estávamos fora.
      return {
        ...state,
        status: "online",
        generation: state.generation + 1,
        self,
        channels,
        users,
        voice,
        view,
        messages: {},
        typing: {},
      };
    }

    case "disconnected":
      return { ...state, status: state.self ? "offline" : "connecting" };

    case "presence":
      return { ...state, users: action.users };

    case "renamed":
      return state.self ? { ...state, self: { ...state.self, name: action.name } } : state;

    case "voice":
      return { ...state, voice: action.voice };

    case "view": {
      const { view } = action;
      const unread = view.type === "text" ? withoutKey(state.unread, view.id) : state.unread;
      return { ...state, view, unread };
    }

    case "loadStart":
      return updateChannel(state, action.channelId, { loading: true, error: null });

    case "loadDone": {
      if (action.generation !== state.generation) return state;
      const current = state.messages[action.channelId] ?? emptyChannel;
      return updateChannel(state, action.channelId, {
        items: mergeMessages(action.messages, current.items),
        loading: false,
        loaded: true,
        hasMore: action.hasMore,
        error: null,
      });
    }

    case "loadFail":
      if (action.generation !== state.generation) return state;
      return updateChannel(state, action.channelId, { loading: false, error: action.error });

    case "message": {
      const { message } = action;
      let next = state;

      // Só acrescenta se o canal já foi (ou está sendo) carregado; senão ele vem no histórico.
      const channel = state.messages[message.channelId];
      if (channel && (channel.loaded || channel.loading)) {
        if (!channel.items.some((item) => item.id === message.id)) {
          next = updateChannel(next, message.channelId, { items: [...channel.items, message] });
        }
      }

      const isActive = state.view?.type === "text" && state.view.id === message.channelId;
      if (!isActive && message.author !== state.self?.name) {
        next = { ...next, unread: { ...next.unread, [message.channelId]: true } };
      }

      const typingHere = next.typing[message.channelId];
      if (typingHere?.[message.author]) {
        next = {
          ...next,
          typing: { ...next.typing, [message.channelId]: withoutKey(typingHere, message.author) },
        };
      }
      return next;
    }

    case "typing": {
      const channelTyping = { ...state.typing[action.channelId], [action.name]: action.until };
      return { ...state, typing: { ...state.typing, [action.channelId]: channelTyping } };
    }

    case "pruneTyping": {
      let changed = false;
      const typing = {};
      for (const [channelId, names] of Object.entries(state.typing)) {
        const kept = {};
        for (const [name, until] of Object.entries(names)) {
          if (until > action.now) kept[name] = until;
          else changed = true;
        }
        if (Object.keys(kept).length) typing[channelId] = kept;
      }
      return changed ? { ...state, typing } : state;
    }

    default:
      return state;
  }
}
