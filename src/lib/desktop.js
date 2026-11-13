// Recursos que só existem no app de desktop (Tauri). No navegador, isDesktop = false
// e o pacote do Tauri nem é baixado.
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
export const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

// "latest" sempre aponta para o release mais novo do GitHub, desde que o arquivo
// anexado lá tenha exatamente este nome.
export const DESKTOP_DOWNLOAD_URL =
  "https://github.com/luis0807/Furicord/releases/latest/download/Furicord-setup.exe";

export async function getStartWithSystem() {
  const { isEnabled } = await import("@tauri-apps/plugin-autostart");
  return isEnabled();
}

export async function setStartWithSystem(value) {
  const autostart = await import("@tauri-apps/plugin-autostart");
  await (value ? autostart.enable() : autostart.disable());
  return autostart.isEnabled();
}
