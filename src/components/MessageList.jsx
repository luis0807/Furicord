import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Hash, ImageOff, LoaderCircle } from "lucide-react";
import { useChat } from "../state/chat-context.js";
import { uploadUrl } from "../lib/config.js";
import { formatDay, formatTime, formatTimestamp, isSameDay } from "../lib/format.js";
import { cls } from "../lib/cls.js";
import { Avatar } from "./ui.jsx";

const GROUP_WINDOW_MS = 7 * 60 * 1000;
const NEAR_BOTTOM_PX = 120;
const LOAD_OLDER_PX = 300;
const EMPTY = [];

const isNearBottom = (el) => el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;

export default function MessageList({ channel, entry, onOpenImage, onLoadOlder, onRetry }) {
  const { state } = useChat();
  const selfName = state.self?.name;
  const items = entry?.items ?? EMPTY;
  const scrollRef = useRef(null);
  const contentRef = useRef(null);
  // Medidas da última renderização, para decidir como rolar depois da próxima.
  const metrics = useRef({ first: null, last: null, scrollHeight: 0, scrollTop: 0, atBottom: true });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = metrics.current;
    const first = items[0]?.id ?? null;
    const last = items.at(-1)?.id ?? null;

    if (last && !prev.last) {
      // Primeiro carregamento: começa no fim, como todo chat.
      el.scrollTop = el.scrollHeight;
    } else if (prev.first && first !== prev.first && last === prev.last) {
      // Mensagens antigas entraram em cima: mantém o que estava na tela no mesmo lugar.
      el.scrollTop = prev.scrollTop + (el.scrollHeight - prev.scrollHeight);
    } else if (last !== prev.last && (prev.atBottom || items.at(-1)?.author === selfName)) {
      // Mensagem nova: só desce se você já estava no fim (ou se foi você que mandou).
      el.scrollTop = el.scrollHeight;
    }

    metrics.current = { first, last, scrollHeight: el.scrollHeight, scrollTop: el.scrollTop, atBottom: isNearBottom(el) };
  }, [items, selfName]);

  // Se a tela é alta e as mensagens não chegam a criar rolagem, busca mais antigas.
  useEffect(() => {
    const el = scrollRef.current;
    if (entry?.loaded && entry.hasMore && !entry.loading && !entry.error && el.scrollHeight <= el.clientHeight) {
      onLoadOlder();
    }
  });

  // Composer crescendo, "digitando…" aparecendo, janela redimensionada: se estava no
  // fim, continua no fim.
  useEffect(() => {
    const el = scrollRef.current;
    const observer = new ResizeObserver(() => {
      if (metrics.current.atBottom) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, []);

  function handleScroll() {
    const el = scrollRef.current;
    Object.assign(metrics.current, {
      scrollTop: el.scrollTop,
      scrollHeight: el.scrollHeight,
      atBottom: isNearBottom(el),
    });
    if (el.scrollTop < LOAD_OLDER_PX && entry?.loaded && entry.hasMore && !entry.loading && !entry.error) {
      onLoadOlder();
    }
  }

  const initialLoading = !entry?.loaded && !entry?.error;

  return (
    <div className="message-scroller" ref={scrollRef} onScroll={handleScroll}>
      <div className="message-content" ref={contentRef}>
        {entry?.loaded && !entry.hasMore && (
          <div className="channel-welcome">
            <div className="channel-welcome-icon">
              <Hash size={36} />
            </div>
            <h2>Bem-vindo(a) a #{channel.name}!</h2>
            <p>Este é o começo do canal #{channel.name}.</p>
          </div>
        )}

        {entry?.loading && (
          <div className={cls("list-loading", initialLoading && "is-initial")}>
            <LoaderCircle size={20} className="spin" />
            {initialLoading && <span>Carregando mensagens…</span>}
          </div>
        )}

        {entry?.error && (
          <div className="list-error" role="alert">
            Não foi possível carregar as mensagens ({entry.error}).
            <button type="button" className="link-button" onClick={entry.loaded ? onLoadOlder : onRetry}>
              Tentar de novo
            </button>
          </div>
        )}

        {items.map((message, index) => {
          const prev = items[index - 1];
          const newDay = !prev || !isSameDay(prev.createdAt, message.createdAt);
          const grouped =
            !newDay &&
            prev.author === message.author &&
            new Date(message.createdAt) - new Date(prev.createdAt) < GROUP_WINDOW_MS;
          return (
            <Fragment key={message.id}>
              {newDay && (
                <div className="day-divider" role="separator">
                  {formatDay(message.createdAt)}
                </div>
              )}
              <MessageItem message={message} grouped={grouped} selfName={selfName} onOpenImage={onOpenImage} />
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}

const MessageItem = memo(function MessageItem({ message, grouped, selfName, onOpenImage }) {
  const mentioned =
    selfName && message.author !== selfName && message.content.toLocaleLowerCase("pt-BR").includes(`@${selfName.toLocaleLowerCase("pt-BR")}`);

  return (
    <article className={cls("message", grouped && "is-grouped", mentioned && "is-mentioned")}>
      {grouped ? (
        <time className="message-hover-time" dateTime={message.createdAt}>
          {formatTime(message.createdAt)}
        </time>
      ) : (
        <Avatar name={message.author} size={40} className="message-avatar" />
      )}
      <div className="message-body">
        {!grouped && (
          <header className="message-header">
            <span className="message-author">{message.author}</span>
            <time
              className="message-time"
              dateTime={message.createdAt}
              title={new Date(message.createdAt).toLocaleString("pt-BR")}
            >
              {formatTimestamp(message.createdAt)}
            </time>
          </header>
        )}
        {message.content && <div className="message-text">{linkify(message.content)}</div>}
        {message.attachments.length > 0 && (
          <div className="message-attachments">
            {message.attachments.map((attachment) => (
              <ImageAttachment key={attachment.id} attachment={attachment} onOpen={onOpenImage} />
            ))}
          </div>
        )}
      </div>
    </article>
  );
});

function ImageAttachment({ attachment, onOpen }) {
  const [failed, setFailed] = useState(false);
  const size = fitInside(attachment.width, attachment.height, 400, 300);

  if (failed) {
    return (
      <div className="attachment-missing">
        <ImageOff size={18} /> {attachment.name}
      </div>
    );
  }

  return (
    <button
      type="button"
      className={cls("attachment-image", size && "has-size")}
      style={size ? { width: size.width, aspectRatio: `${attachment.width} / ${attachment.height}` } : undefined}
      onClick={() => onOpen(attachment)}
      title={attachment.name}
    >
      <img
        src={uploadUrl(attachment.id)}
        alt={attachment.name}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
      />
    </button>
  );
}

function fitInside(width, height, maxWidth, maxHeight) {
  if (!width || !height) return null;
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// Transforma URLs em links clicáveis. Todo o resto vira texto puro (nada de HTML).
const URL_PATTERN = /https?:\/\/[^\s<]+[^\s<.,:;"')\]!?]/g;

function linkify(text) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(
      <a key={match.index} href={match[0]} target="_blank" rel="noopener noreferrer">
        {match[0]}
      </a>,
    );
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}
