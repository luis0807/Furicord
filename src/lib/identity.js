// Conta sem senha: o servidor guarda nome e perfil ligados a um código de acesso
// secreto que fica neste navegador. Quem tem o código entra como a pessoa — por isso
// ele só sai daqui quando ela mesma copia (Configurações > Conta).
const NAME_KEY = "furicord.name";
// Nome antigo da chave mantido de propósito: quem já usava o Furicord continua com o
// mesmo código e o nome passa a ser dele na próxima conexão.
const TOKEN_KEY = "furicord.clientId";
const VIEW_KEY = "furicord.view";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

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

export function getToken() {
  let token = read(TOKEN_KEY);
  if (!token || !TOKEN_PATTERN.test(token)) {
    token = generateToken();
    write(TOKEN_KEY, token);
  }
  return token;
}

export const isValidToken = (value) => TOKEN_PATTERN.test(value);
export const setToken = (token) => write(TOKEN_KEY, token);
export const clearToken = () => write(TOKEN_KEY, null);

// 24 bytes aleatórios (192 bits). getRandomValues funciona até fora de HTTPS,
// ao contrário de randomUUID.
function generateToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
