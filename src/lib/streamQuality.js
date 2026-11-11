// Qualidade da transmissão de tela. Na malha, cada pessoa da sala recebe uma cópia
// direta da sua tela, então qualidades altas multiplicam o uso do seu upload.

const STORAGE_KEY = "furicord.stream";

export const STREAM_RESOLUTIONS = [
  { id: "720", label: "720p", width: 1280, height: 720, bitrate: 2_500_000 },
  { id: "1080", label: "1080p", width: 1920, height: 1080, bitrate: 4_500_000 },
  { id: "source", label: "Original", width: null, height: null, bitrate: 8_000_000 },
];

export const STREAM_FPS = [15, 30, 60];

const DEFAULT_QUALITY = { resolution: "1080", fps: 30 };

export function normalizeQuality(value) {
  const resolution = STREAM_RESOLUTIONS.some((r) => r.id === value?.resolution) ? value.resolution : DEFAULT_QUALITY.resolution;
  const fps = STREAM_FPS.includes(value?.fps) ? value.fps : DEFAULT_QUALITY.fps;
  return { resolution, fps };
}

export function loadStreamQuality() {
  try {
    return normalizeQuality(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return { ...DEFAULT_QUALITY };
  }
}

export function saveStreamQuality(quality) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(quality));
  } catch {
    // sem armazenamento: vale só nesta sessão
  }
}

// Restrições do getDisplayMedia. Ele não aceita `min`/`exact`, só `max`/ideal.
export function videoConstraints({ resolution, fps }) {
  const res = STREAM_RESOLUTIONS.find((r) => r.id === resolution);
  const constraints = { frameRate: { ideal: fps, max: fps } };
  if (res?.width) {
    constraints.width = { max: res.width };
    constraints.height = { max: res.height };
  }
  return constraints;
}

export function maxBitrate({ resolution, fps }) {
  const base = STREAM_RESOLUTIONS.find((r) => r.id === resolution)?.bitrate ?? 4_500_000;
  if (fps >= 60) return Math.round(base * 1.6);
  if (fps <= 15) return Math.round(base * 0.6);
  return base;
}

// Quando a conexão com alguém passa pelo servidor de retransmissão (TURN), a tela
// vai para essa pessoa numa qualidade econômica: o TURN tem franquia mensal de dados
// e a transmissão de tela é o que mais gasta (cerca de 0,5 GB por hora assim, contra
// 2 a 6 GB por hora na qualidade cheia).
export const RELAY_MAX_BITRATE = 1_200_000;
export const RELAY_MAX_FPS = 20;

// "detail" prioriza nitidez (texto, código); "motion" prioriza fluidez (jogos, vídeo).
export const contentHintFor = ({ fps }) => (fps >= 60 ? "motion" : "detail");
