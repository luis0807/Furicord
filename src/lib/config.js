// Endereço do backend (Express + Socket.IO).
// Em dev fica vazio: o Vite repassa /api e /socket.io para localhost:4000.
// Em produção (Vercel), VITE_SERVER_URL = URL do Render SEM /api no final,
// ex: https://furicord-api.onrender.com — se vier com /api, removemos aqui mesmo.
export const SERVER_URL = (import.meta.env.VITE_SERVER_URL || "")
  .trim()
  .replace(/\/+$/, "")
  .replace(/\/api$/, "");

export const apiUrl = (path) => `${SERVER_URL}/api${path}`;
export const uploadUrl = (id) => apiUrl(`/uploads/${id}`);

// Espelham os limites do servidor (server/src/config.js) para avisar antes de enviar.
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export const MAX_MESSAGE_LENGTH = 2000;
export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
