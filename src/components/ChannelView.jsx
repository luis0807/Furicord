import { useEffect, useRef, useState } from "react";
import { Hash, ImagePlus } from "lucide-react";
import { useChat } from "../state/chat-context.js";
import ChannelHeader from "./ChannelHeader.jsx";
import MessageList from "./MessageList.jsx";
import Composer from "./Composer.jsx";
import Lightbox from "./Lightbox.jsx";
import { useAttachments } from "./useAttachments.js";

const hasFiles = (event) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

export default function ChannelView({ channel, layout }) {
  const { state, loadMessages } = useChat();
  const entry = state.messages[channel.id];
  const attachments = useAttachments();
  const [dragging, setDragging] = useState(false);
  const [openImage, setOpenImage] = useState(null);
  const dragDepth = useRef(0);

  // Carrega o histórico ao abrir o canal (e de novo depois de uma reconexão,
  // quando o cache é limpo).
  const needsLoad = state.status === "online" && !entry;
  useEffect(() => {
    if (needsLoad) loadMessages(channel.id);
  }, [needsLoad, channel.id, loadMessages]);

  // dragenter/dragleave disparam para cada elemento filho: contamos a profundidade
  // para o aviso não piscar.
  const dropHandlers = {
    onDragEnter: (event) => {
      if (!hasFiles(event)) return;
      dragDepth.current += 1;
      setDragging(true);
    },
    onDragLeave: (event) => {
      if (!hasFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    },
    onDragOver: (event) => {
      if (hasFiles(event)) event.preventDefault();
    },
    onDrop: (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      attachments.add(event.dataTransfer.files);
    },
  };

  return (
    <section className="channel-view" {...dropHandlers}>
      <ChannelHeader icon={<Hash />} title={channel.name} topic={channel.topic} layout={layout} />
      <MessageList
        channel={channel}
        entry={entry}
        onOpenImage={setOpenImage}
        onLoadOlder={() => loadMessages(channel.id, { older: true })}
        onRetry={() => loadMessages(channel.id)}
      />
      <Composer channel={channel} attachments={attachments} />

      {dragging && (
        <div className="drop-overlay">
          <ImagePlus size={40} />
          Solte para enviar em #{channel.name}
        </div>
      )}
      {openImage && <Lightbox image={openImage} onClose={() => setOpenImage(null)} />}
    </section>
  );
}
