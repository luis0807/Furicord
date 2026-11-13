export const PORT = Number(process.env.PORT) || 4000;
export const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/furicord";

// Origens do frontend que podem chamar a API, separadas por vírgula
// (ex: https://furicord.vercel.app). Vazio = libera qualquer origem — só para dev.
export const CORS_ORIGIN = parseOrigins(process.env.CORS_ORIGIN);

// Servidores STUN/TURN usados pela voz e pela transmissão de tela (WebRTC), em JSON.
// Só STUN resolve a maioria das redes domésticas; para 4G/CGNAT/redes corporativas
// é preciso um TURN. Ex:
// [{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:host:3478","username":"u","credential":"s"}]
export const ICE_SERVERS = parseIceServers(process.env.ICE_SERVERS);

// TURN da Cloudflare (recomendado): o servidor gera credenciais temporárias sozinho.
// Painel da Cloudflare -> Realtime -> TURN Server -> criar chave: copie o Turn Token ID
// e o API Token. Com os dois preenchidos, ICE_SERVERS é usado só se a Cloudflare falhar.
export const CLOUDFLARE_TURN =
  process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_API_TOKEN
    ? { keyId: process.env.CLOUDFLARE_TURN_KEY_ID.trim(), apiToken: process.env.CLOUDFLARE_TURN_API_TOKEN.trim() }
    : null;

// Teto mensal do TURN da Cloudflare, em GB. A franquia grátis é de 1.000 GB por mês;
// o padrão fica abaixo para sobrar margem. Ao chegar nele, o TURN é desligado até o
// mês virar (quem conecta direto continua falando normalmente).
export const TURN_MONTHLY_LIMIT_GB = Number(process.env.TURN_MONTHLY_LIMIT_GB) > 0 ? Number(process.env.TURN_MONTHLY_LIMIT_GB) : 900;

// Alertas de consumo do TURN, em GB, separados por vírgula. Ao passar de cada um, o
// servidor avisa no log e o app mostra uma faixa de aviso para quem está online.
export const TURN_ALERT_GB = (process.env.TURN_ALERT_GB || "500,700")
  .split(",")
  .map(Number)
  .filter((gb) => gb > 0 && gb < TURN_MONTHLY_LIMIT_GB)
  .sort((a, b) => a - b);

// Opcional: deixa o servidor conferir o uso oficial do mês na Cloudflare, em vez de
// confiar só na conta feita pelos navegadores. O token precisa da permissão
// "Account Analytics: Read" (é outro token, não o da chave TURN).
export const CLOUDFLARE_ANALYTICS =
  process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_ANALYTICS_TOKEN
    ? { accountId: process.env.CLOUDFLARE_ACCOUNT_ID.trim(), apiToken: process.env.CLOUDFLARE_ANALYTICS_TOKEN.trim() }
    : null;

// Contas que veem o painel "Servidor de voz" (consumo do TURN por dia, por pessoa,
// por tipo de conexão), separadas por vírgula. Ex: ADMIN_NAMES=Furico
// Vale o nome atual da conta: se ela trocar de nome, atualize aqui.
export const ADMIN_NAMES = (process.env.ADMIN_NAMES || "")
  .split(",")
  .map((name) => name.trim().toLocaleLowerCase("pt-BR"))
  .filter(Boolean);

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_ATTACHMENTS = 10;
// Voz em malha: cada pessoa envia áudio/tela para todas as outras, então o upload
// cresce com o tamanho da sala. Acima disso a qualidade cai bastante.
export const MAX_VOICE_PEERS = 8;

function parseOrigins(value) {
  const list = (value || "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return list.length ? list : true;
}

function parseIceServers(value) {
  const fallback = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length) return parsed;
  } catch {
    // cai no aviso abaixo
  }
  console.warn("ICE_SERVERS inválido (precisa ser um array JSON). Usando só o STUN do Google.");
  return fallback;
}
