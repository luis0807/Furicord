import { Download } from "lucide-react";
import { cls } from "../lib/cls.js";
import { DESKTOP_DOWNLOAD_URL, isDesktop, isWindows } from "../lib/desktop.js";

// Dentro do app ou fora do Windows não há o que baixar.
export const canDownloadApp = !isDesktop && isWindows;

export default function DownloadAppButton({ label = "Baixar app", className }) {
  if (!canDownloadApp) return null;
  return (
    <a
      className={cls("download-app", className)}
      href={DESKTOP_DOWNLOAD_URL}
      download
      title="Baixar o Furicord para Windows"
    >
      <Download size={16} />
      <span className="download-app-label">{label}</span>
    </a>
  );
}
