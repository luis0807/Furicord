import { apiUrl } from "./config.js";

async function request(path, options) {
  const response = await fetch(apiUrl(path), options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Erro na requisição (${response.status})`);
  return data;
}

export function fetchMessages(channelId, before) {
  const query = before ? `?before=${encodeURIComponent(before)}` : "";
  return request(`/channels/${encodeURIComponent(channelId)}/messages${query}`);
}

export async function fetchIceServers() {
  try {
    // Com prazo: o servidor gratuito pode estar acordando, e sem isso a entrada na
    // sala ficaria em "Conectando…" esperando. Sem resposta, entra só com STUN.
    const data = await request("/ice", { signal: AbortSignal.timeout(8000) });
    return data.iceServers;
  } catch {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

// Confere se o nome está livre, já entrou neste navegador (um dos `tokens`) ou tem
// outro dono.
export function checkName(name, tokens, signal) {
  return request("/accounts/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, tokens }),
    signal,
  });
}

export function uploadImage(file, { width, height } = {}) {
  const form = new FormData();
  if (width) form.append("width", String(width));
  if (height) form.append("height", String(height));
  form.append("file", file, file.name || "imagem.png");
  return request("/uploads", { method: "POST", body: form });
}
