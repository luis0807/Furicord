import { CLOUDFLARE_TURN, ICE_SERVERS } from "../config.js";

/*
 * Servidores STUN/TURN entregues aos navegadores para a voz e a tela.
 *
 * STUN só descobre o endereço público de cada um; se a rede não deixa os dois
 * navegadores se falarem direto (4G, CGNAT, Wi-Fi corporativo), é o TURN que repassa
 * o áudio/vídeo. Com CLOUDFLARE_TURN_KEY_ID + CLOUDFLARE_TURN_API_TOKEN, o servidor
 * gera credenciais temporárias do TURN da Cloudflare (a chave secreta nunca vai para
 * o navegador). Sem isso, usa ICE_SERVERS (fixo, qualquer provedor) ou só STUN.
 */

const TTL_SECONDS = 24 * 60 * 60;
// Renova bem antes de vencer: quem entra numa sala fica com a credencial que recebeu.
const RENEW_BEFORE_MS = 6 * 60 * 60 * 1000;

let cached = null; // { iceServers, expiresAt }
let pending = null;

export async function getIceServers() {
  if (!CLOUDFLARE_TURN) return ICE_SERVERS;
  if (cached && cached.expiresAt - Date.now() > RENEW_BEFORE_MS) return cached.iceServers;

  pending ??= fetchCloudflare()
    .then((iceServers) => {
      cached = { iceServers, expiresAt: Date.now() + TTL_SECONDS * 1000 };
      return iceServers;
    })
    .catch((err) => {
      console.error("Não foi possível gerar credenciais TURN na Cloudflare:", err.message);
      // Credencial antiga ainda válida > nada; sem nenhuma, cai no STUN/ICE_SERVERS.
      return cached && cached.expiresAt > Date.now() ? cached.iceServers : ICE_SERVERS;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

async function fetchCloudflare() {
  const { keyId, apiToken } = CLOUDFLARE_TURN;
  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const list = Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers];
  const iceServers = list
    .filter((server) => server?.urls)
    .map((server) => ({
      ...server,
      // A porta 53 costuma ser bloqueada pelos navegadores/redes e só atrasa a conexão.
      urls: [server.urls].flat().filter((url) => !/:53(\?|$)/.test(url)),
    }))
    .filter((server) => server.urls.length > 0);
  if (!iceServers.some((server) => server.urls.some((url) => url.startsWith("turn")))) {
    throw new Error("resposta sem servidores TURN");
  }
  return iceServers;
}
