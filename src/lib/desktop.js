// Recursos que só existem no app de desktop (Tauri). No navegador, isDesktop = false
// e o pacote do Tauri nem é baixado.
export const isDesktop = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function getStartWithSystem() {
  const { isEnabled } = await import("@tauri-apps/plugin-autostart");
  return isEnabled();
}

export async function setStartWithSystem(value) {
  const autostart = await import("@tauri-apps/plugin-autostart");
  await (value ? autostart.enable() : autostart.disable());
  return autostart.isEnabled();
}
