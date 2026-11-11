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
