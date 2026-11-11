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
    const data = await request("/ice");
    return data.iceServers;
  } catch {
    return [{ urls: "stun:stun.l.google.com:19302" }];
  }
}

export function uploadImage(file, { width, height } = {}) {
  const form = new FormData();
  if (width) form.append("width", String(width));
  if (height) form.append("height", String(height));
  form.append("file", file, file.name || "imagem.png");
  return request("/uploads", { method: "POST", body: form });
}
