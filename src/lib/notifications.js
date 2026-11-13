// Notificações do sistema para mensagens novas. No app de desktop, o plugin do Tauri
// troca o `Notification` do navegador pelo do Windows, então o código é o mesmo.

const STORAGE_KEY = "furicord.notifications";
const MAX_BODY = 140;

export const notificationsSupported = typeof window !== "undefined" && "Notification" in window;

let enabled = readEnabled();
const listeners = new Set();

export const getNotificationsEnabled = () => enabled;

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

export function notifyMessage(message, channelName, onClick) {
  if (!enabled || !notificationsSupported || Notification.permission !== "granted") return;

  const count = message.attachments?.length ?? 0;
  const text = message.content?.trim() || (count === 1 ? "Enviou um anexo" : `Enviou ${count} anexos`);
  const body = text.length > MAX_BODY ? `${text.slice(0, MAX_BODY - 1)}…` : text;

  try {
    const notification = new Notification(`${message.author} em #${channelName}`, {
      body,
      tag: message.channelId, // várias mensagens no mesmo canal: fica só a mais recente
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

function readEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}
