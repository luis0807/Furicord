import { useSyncExternalStore } from "react";
import { RefreshCw, X } from "lucide-react";
import { dismissUpdatePrompt, getUpdateState, installUpdate, subscribeUpdate } from "../lib/updater.js";

const useUpdate = () => useSyncExternalStore(subscribeUpdate, getUpdateState);

const installingLabel = (progress) => `Atualizando… ${progress ?? 0}%`;

// Popup no canto da tela quando sai uma versão nova do app.
export function UpdatePrompt() {
  const { update, status, progress, error, dismissed } = useUpdate();
  if (!update || (dismissed && status !== "installing")) return null;
  const installing = status === "installing";

  return (
    <div className="update-toast" role="status" aria-live="polite">
      <div className="update-toast-header">
        <RefreshCw size={18} />
        <strong>Nova versão do Furicord</strong>
        {!installing && (
          <button type="button" className="update-toast-close" onClick={dismissUpdatePrompt} aria-label="Fechar">
            <X size={16} />
          </button>
        )}
      </div>
      <p>
        Da v{update.currentVersion} para a v{update.version}. O app fecha e abre de novo sozinho para terminar a
        atualização.
      </p>
      {error && <p className="form-error">{error}</p>}
      <div className="button-row">
        <button type="button" className="button-primary" onClick={installUpdate} disabled={installing}>
          {installing ? installingLabel(progress) : "Atualizar agora"}
        </button>
        {!installing && (
          <button type="button" className="button-ghost" onClick={dismissUpdatePrompt}>
            Depois
          </button>
        )}
      </div>
    </div>
  );
}

// Botão no topo: fica lá enquanto houver atualização, mesmo depois de fechar o popup.
export function UpdateAppButton() {
  const { update, status, progress } = useUpdate();
  if (!update) return null;
  const installing = status === "installing";

  return (
    <button
      type="button"
      className="download-app"
      onClick={installUpdate}
      disabled={installing}
      title={`Atualizar o Furicord para a versão ${update.version}`}
    >
      <RefreshCw size={16} className={installing ? "spin" : undefined} />
      <span className="download-app-label">{installing ? installingLabel(progress) : "Atualizar app"}</span>
    </button>
  );
}
