import { useLayoutEffect, useRef, useState } from "react";
import { CirclePlus, LoaderCircle, SendHorizontal, TriangleAlert, X } from "lucide-react";
import { useChat } from "../state/chat-context.js";
import { ALLOWED_IMAGE_TYPES, MAX_ATTACHMENTS, MAX_MESSAGE_LENGTH } from "../lib/config.js";
import { listNames } from "../lib/format.js";
import { cls } from "../lib/cls.js";
import { IconButton } from "./ui.jsx";

const TYPING_THROTTLE_MS = 2500;

export default function Composer({ channel, attachments }) {
  const { state, sendMessage, emitTyping } = useChat();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const lastTypingAt = useRef(0);

  // Cresce com o texto até um limite (depois rola por dentro).
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [text]);

  const tooLong = text.length > MAX_MESSAGE_LENGTH;
  const hasContent = text.trim().length > 0 || attachments.readyIds.length > 0;
  const canSend = hasContent && !tooLong && !sending && !attachments.uploading && state.status === "online";

  async function submit() {
    if (!canSend) return;
    setSending(true);
    setError(null);
    const result = await sendMessage(channel.id, text.trim(), attachments.readyIds);
    setSending(false);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setText("");
    attachments.clear();
    attachments.dismissNotice();
    textareaRef.current?.focus();
  }

  function handleKeyDown(event) {
    // Enter envia, Shift+Enter quebra linha. isComposing: não envia no meio de um acento/IME.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function handleChange(event) {
    setText(event.target.value);
    const now = Date.now();
    if (event.target.value && now - lastTypingAt.current > TYPING_THROTTLE_MS) {
      lastTypingAt.current = now;
      emitTyping(channel.id);
    }
  }

  function handlePaste(event) {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (files.length) {
      event.preventDefault();
      attachments.add(files);
    }
  }

  const notice = error ?? attachments.notice;

  return (
    <div className="composer-wrap">
      {notice && (
        <div className="composer-notice" role="alert">
          <TriangleAlert size={16} />
          <span>{notice}</span>
          <IconButton
            label="Fechar aviso"
            onClick={() => {
              setError(null);
              attachments.dismissNotice();
            }}
          >
            <X />
          </IconButton>
        </div>
      )}

      <div className="composer">
        {attachments.items.length > 0 && (
          <div className="composer-attachments">
            {attachments.items.map((item) => (
              <div key={item.key} className="attachment-preview">
                <img src={item.previewUrl} alt="" />
                {item.status === "uploading" && (
                  <div className="attachment-preview-overlay" aria-label="Enviando">
                    <LoaderCircle className="spin" />
                  </div>
                )}
                <button
                  type="button"
                  className="attachment-remove"
                  onClick={() => attachments.remove(item.key)}
                  aria-label={`Remover ${item.name}`}
                >
                  <X size={14} />
                </button>
                <span className="attachment-preview-name">{item.name}</span>
              </div>
            ))}
          </div>
        )}

        <div className="composer-row">
          <IconButton
            label="Anexar imagem"
            onClick={() => fileInputRef.current?.click()}
            disabled={attachments.items.length >= MAX_ATTACHMENTS}
          >
            <CirclePlus />
          </IconButton>
          <input
            ref={fileInputRef}
            type="file"
            accept={ALLOWED_IMAGE_TYPES.join(",")}
            multiple
            hidden
            onChange={(event) => {
              attachments.add(event.target.files);
              event.target.value = "";
            }}
          />
          <textarea
            ref={textareaRef}
            className="composer-input"
            rows={1}
            value={text}
            placeholder={`Conversar em #${channel.name}`}
            aria-label={`Mensagem para #${channel.name}`}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
          <IconButton label="Enviar" onClick={submit} disabled={!canSend} className="send-button">
            {sending ? <LoaderCircle className="spin" /> : <SendHorizontal />}
          </IconButton>
        </div>
      </div>

      <div className="composer-footer">
        <TypingIndicator channelId={channel.id} />
        {text.length > MAX_MESSAGE_LENGTH - 200 && (
          <span className={cls("char-count", tooLong && "is-over")}>{MAX_MESSAGE_LENGTH - text.length}</span>
        )}
      </div>
    </div>
  );
}

function TypingIndicator({ channelId }) {
  const { state } = useChat();
  const names = Object.keys(state.typing[channelId] ?? {}).filter((name) => name !== state.self?.name);

  return (
    <div className="typing" aria-live="polite">
      {names.length > 0 && (
        <>
          <span className="typing-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {names.length > 3 ? (
            <span>Várias pessoas estão digitando…</span>
          ) : (
            <span>
              <strong>{listNames(names)}</strong> {names.length === 1 ? "está" : "estão"} digitando…
            </span>
          )}
        </>
      )}
    </div>
  );
}
