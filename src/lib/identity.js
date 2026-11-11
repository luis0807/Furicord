// Conta sem senha: o servidor guarda nome e perfil ligados a um código de acesso
// secreto. O navegador lembra o código de cada conta que já entrou nele — por isso,
// aqui, basta digitar o nome; em outro navegador, a pessoa precisa colar o código.
const NAME_KEY = "furicord.name";
// Código da conta ativa (a última que entrou aqui). Nome antigo da chave mantido de
// propósito: quem já usava o Furicord continua com o mesmo código.
const TOKEN_KEY = "furicord.clientId";
// Códigos de todas as contas que já entraram neste navegador (a mais recente primeiro).
const KNOWN_KEY = "furicord.knownTokens";
const VIEW_KEY = "furicord.view";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;
const MAX_KNOWN = 10;

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

// Código da conta ativa. Se não houver, cria um (para quem já tinha nome salvo de
// antes das contas: a conta nasce com ele na próxima conexão).
export function getToken() {
  let token = read(TOKEN_KEY);
  if (!token || !TOKEN_PATTERN.test(token)) {
    token = generateToken();
    write(TOKEN_KEY, token);
  }
  return token;
}

export const isValidToken = (value) => TOKEN_PATTERN.test(value);

// Código novo para criar uma conta. Só é guardado quando o servidor aceitar.
export const newToken = () => generateToken();

export function getKnownTokens() {
  let list = [];
  try {
    const parsed = JSON.parse(read(KNOWN_KEY));
    if (Array.isArray(parsed)) list = parsed.filter((token) => typeof token === "string" && TOKEN_PATTERN.test(token));
  } catch {
    // lista corrompida: recomeça
  }
  // Quem entrou antes desta lista existir tem só o código ativo.
  const active = read(TOKEN_KEY);
  if (active && TOKEN_PATTERN.test(active) && !list.includes(active)) list.push(active);
  return list.slice(0, MAX_KNOWN);
}

// A conta entrou: vira a ativa e passa a ser lembrada neste navegador.
export function rememberToken(token) {
  write(TOKEN_KEY, token);
  const list = [token, ...getKnownTokens().filter((known) => known !== token)].slice(0, MAX_KNOWN);
  write(KNOWN_KEY, JSON.stringify(list));
}

// "Sair e esquecer este navegador", conta excluída ou código recusado.
export function forgetToken(token) {
  write(
    KNOWN_KEY,
    JSON.stringify(getKnownTokens().filter((known) => known !== token)),
  );
  if (read(TOKEN_KEY) === token) write(TOKEN_KEY, null);
}

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
