import crypto from "node:crypto";

// O código de acesso é aleatório e longo (≥ 120 bits), então um SHA-256 simples
// basta — não é uma senha escolhida por gente, que precisaria de bcrypt.
export const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const TOKEN = /^[A-Za-z0-9_-]{20,128}$/;
export const cleanToken = (value) => (typeof value === "string" && TOKEN.test(value) ? value : null);

// IP de quem conectou, só para limitar cadastros em massa (fica em memória, nunca
// é gravado). Atrás do proxy do Render, vale o último IP que ele acrescentou em
// X-Forwarded-For — mesma regra do `trust proxy 1` do Express.
export function clientIp(socket) {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",").at(-1).trim();
  return socket.handshake.address;
}
