// Notificações do sistema para mensagens novas. No app de desktop, o plugin do Tauri
// troca o `Notification` do navegador pelo do Windows, então o código é o mesmo.

const STORAGE_KEY = "furicord.notifications";
const MODE_KEY = "furicord.notifications.mode";
const MAX_BODY = 140;

export const notificationsSupported = typeof window !== "undefined" && "Notification" in window;

let enabled = readEnabled();
let mode = readMode(); // "all" | "mentions"
const listeners = new Set();

export const getNotificationsEnabled = () => enabled;
export const getNotificationMode = () => mode;

export function setNotificationMode(value) {
  mode = value === "mentions" ? "mentions" : "all";
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // navegação privada: vale só até fechar a aba
  }
  for (const listener of listeners) listener();
}

export function subscribeNotifications(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Ligar pede permissão ao navegador; devolve false se ela foi negada.
export async function setNotificationsEnabled(value) {
  if (value && !(await requestPermission())) return false;
  enabled = Boolean(value);
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // navegação privada: vale só até fechar a aba
  }
  for (const listener of listeners) listener();
  return true;
}

export function notifyMessage(message, channelName, onClick, { mention = false, everyone = false } = {}) {
  if (!enabled || !notificationsSupported || Notification.permission !== "granted") return;
  if (mode === "mentions" && !mention) return;

  const count = message.attachments?.length ?? 0;
  const text = message.content?.trim() || (count === 1 ? "Enviou um anexo" : `Enviou ${count} anexos`);
  const body = text.length > MAX_BODY ? `${text.slice(0, MAX_BODY - 1)}…` : text;

  try {
    const title = everyone
      ? `${message.author} mencionou @everyone em #${channelName}`
      : mention
        ? `${message.author} mencionou você em #${channelName}`
        : `${message.author} em #${channelName}`;
    const notification = new Notification(title, {
      body,
      // Várias mensagens no mesmo canal: fica só a mais recente. Menção não é substituída.
      tag: mention ? `mention-${message.id}` : message.channelId,
      silent: true, // o som de mensagem do Furicord já toca (se estiver ligado)
    });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  } catch {
    // Android/Chrome só aceita notificação via service worker: segue sem ela
  }
}

async function requestPermission() {
  if (!notificationsSupported) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

function readMode() {
  try {
    return localStorage.getItem(MODE_KEY) === "mentions" ? "mentions" : "all";
  } catch {
    return "all";
  }
}

function readEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}
