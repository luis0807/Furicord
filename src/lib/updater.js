// Atualização do app de desktop (Tauri). O conteúdo vem do site e já se atualiza
// sozinho; isto cuida só do app em si (ícone, bandeja, plugins), publicado pelo
// GitHub Actions como release assinado. No navegador, nada aqui roda.
import { isDesktop } from "./desktop.js";

const CHECK_EVERY_MS = 30 * 60 * 1000;

// status: "idle" | "available" | "installing"
let state = { update: null, status: "idle", progress: null, error: null, dismissed: false };
const listeners = new Set();

function set(patch) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export const getUpdateState = () => state;

export function subscribeUpdate(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

let started = false;

export function startUpdateChecks() {
  if (!isDesktop || started) return;
  started = true;
  checkNow();
  setInterval(checkNow, CHECK_EVERY_MS);
}

async function checkNow() {
  if (state.status === "installing") return;
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    // Versão nova (ou mais nova que a já avisada): o popup volta a aparecer.
    if (update && update.version !== state.update?.version) {
      set({ update, status: "available", error: null, dismissed: false });
    }
  } catch (err) {
    console.warn("[atualização] não foi possível verificar:", err);
  }
}

export const dismissUpdatePrompt = () => set({ dismissed: true });

export async function installUpdate() {
  const { update } = state;
  if (!update || state.status === "installing") return;
  set({ status: "installing", progress: 0, error: null });
  try {
    let total = 0;
    let downloaded = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      if (event.event === "Progress" && total) {
        downloaded += event.data.chunkLength;
        set({ progress: Math.min(99, Math.round((downloaded / total) * 100)) });
      }
    });
    // No Windows o instalador já fecha e reabre o app; isto cobre os outros casos.
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (err) {
    console.warn("[atualização] falhou:", err);
    set({ status: "available", progress: null, error: "Não foi possível atualizar. Tente de novo." });
  }
}
