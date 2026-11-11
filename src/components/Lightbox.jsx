import { useEffect } from "react";
import { ExternalLink, X } from "lucide-react";
import { uploadUrl } from "../lib/config.js";
import { formatBytes } from "../lib/format.js";
import { IconButton } from "./ui.jsx";

export default function Lightbox({ image, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const url = uploadUrl(image.id);
  const stop = (event) => event.stopPropagation();

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={image.name} onClick={onClose}>
      <img src={url} alt={image.name} onClick={stop} />
      <div className="lightbox-bar" onClick={stop}>
        <span className="lightbox-name">
          {image.name}
          {image.size ? ` · ${formatBytes(image.size)}` : ""}
        </span>
        <a href={url} target="_blank" rel="noopener noreferrer">
          <ExternalLink size={16} /> Abrir original
        </a>
        <IconButton label="Fechar" onClick={onClose}>
          <X />
        </IconButton>
      </div>
    </div>
  );
}
