// Não existe conta: a "identidade" é o nome escolhido + um id aleatório deste navegador.
// O id permite abrir várias abas com o mesmo nome sem o servidor achar que é outra pessoa.
const NAME_KEY = "furicord.name";
const CLIENT_KEY = "furicord.clientId";
const VIEW_KEY = "furicord.view";

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // navegação privada / armazenamento bloqueado: segue sem lembrar
  }
}

export const getSavedName = () => read(NAME_KEY);
export const saveName = (name) => write(NAME_KEY, name);

let clientId = null;
export function getClientId() {
  clientId ??= read(CLIENT_KEY);
  if (!clientId) {
    clientId = randomId();
    write(CLIENT_KEY, clientId);
  }
  return clientId;
}

export function getSavedView() {
  try {
    const view = JSON.parse(read(VIEW_KEY));
    return view?.type === "text" && typeof view.id === "string" ? view : null;
  } catch {
    return null;
  }
}

export function saveView(view) {
  if (view?.type === "text") write(VIEW_KEY, JSON.stringify(view));
}

export function randomId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

// Mesma regra do servidor (server/src/lib/names.js).
// Controle e invisíveis (zero-width, direção de texto, BOM), montado por código numérico.
const INVISIBLE_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]];
const INVISIBLE = new RegExp(
  `[${INVISIBLE_RANGES.map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`).join("")}]`,
  "g",
);
export function normalizeName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 32) return null;
  return name;
}
