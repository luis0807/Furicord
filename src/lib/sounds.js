// Efeitos sonoros sintetizados na hora com Web Audio: nenhum arquivo para baixar e
// nenhum som de terceiros. Cada efeito é uma sequência curta de notas.

const STORAGE_KEY = "furicord.sounds";
const MASTER_VOLUME = 0.22;
// O mesmo som pedido várias vezes seguidas (ex: rajada de mensagens) toca uma vez só.
const MIN_GAP_MS = 250;

// at = quando começa (s), freq = Hz, dur = duração (s), to = desliza até essa frequência.
const SOUNDS = {
  message: [
    { at: 0, freq: 987.77, dur: 0.14 },
    { at: 0.08, freq: 1318.51, dur: 0.26 },
  ],
  connect: [
    { at: 0, freq: 523.25, dur: 0.16, type: "triangle" },
    { at: 0.08, freq: 659.25, dur: 0.16, type: "triangle" },
    { at: 0.16, freq: 783.99, dur: 0.3, type: "triangle" },
  ],
  disconnect: [
    { at: 0, freq: 783.99, dur: 0.16, type: "triangle" },
    { at: 0.08, freq: 659.25, dur: 0.16, type: "triangle" },
    { at: 0.16, freq: 523.25, dur: 0.3, type: "triangle" },
  ],
  userJoin: [
    { at: 0, freq: 659.25, dur: 0.14 },
    { at: 0.09, freq: 880, dur: 0.24 },
  ],
  userLeave: [
    { at: 0, freq: 880, dur: 0.14 },
    { at: 0.09, freq: 659.25, dur: 0.24 },
  ],
  mute: [{ at: 0, freq: 700, to: 480, dur: 0.1 }],
  unmute: [{ at: 0, freq: 480, to: 700, dur: 0.1 }],
  deafen: [
    { at: 0, freq: 520, to: 360, dur: 0.09 },
    { at: 0.1, freq: 400, to: 280, dur: 0.12 },
  ],
  undeafen: [
    { at: 0, freq: 280, to: 400, dur: 0.09 },
    { at: 0.1, freq: 360, to: 520, dur: 0.12 },
  ],
  streamStart: [
    { at: 0, freq: 392, to: 784, dur: 0.22, type: "triangle", gain: 0.35 },
    { at: 0.16, freq: 1174.66, dur: 0.28 },
  ],
  streamStop: [
    { at: 0, freq: 784, to: 392, dur: 0.22, type: "triangle", gain: 0.35 },
    { at: 0.16, freq: 523.25, dur: 0.26 },
  ],
};

let context = null;
let master = null;
let enabled = readEnabled();
// Ensurdecido: só tocam os sons pedidos com { always: true } (o retorno dos botões).
let silenced = false;
const lastPlayed = new Map();
const listeners = new Set();

export function playSound(name, { always = false } = {}) {
  const notes = SOUNDS[name];
  if (!enabled || !notes || (silenced && !always)) return;

  const now = performance.now();
  if (now - (lastPlayed.get(name) ?? -Infinity) < MIN_GAP_MS) return;
  lastPlayed.set(name, now);

  const audio = getContext();
  // Sem um clique na página o navegador mantém o áudio suspenso. Melhor perder este
  // som do que acumular vários e tocar todos juntos quando destravar.
  if (!audio || audio.state !== "running") {
    audio?.resume().catch(() => {});
    return;
  }

  const start = audio.currentTime + 0.01;
  for (const note of notes) playNote(audio, start + note.at, note);
  if (import.meta.env.DEV) console.debug("[som]", name);
}

export const getSoundsEnabled = () => enabled;

export function setSoundsEnabled(value) {
  enabled = Boolean(value);
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // navegação privada: vale só até fechar a aba
  }
  for (const listener of listeners) listener();
}

export function subscribeSounds(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSoundsSilenced(value) {
  silenced = Boolean(value);
}

function readEnabled() {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function getContext() {
  if (!context) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    context = new AudioContextClass();
    master = context.createGain();
    master.gain.value = MASTER_VOLUME;
    master.connect(context.destination);
  }
  return context;
}

function playNote(audio, at, { freq, to, dur, type = "sine", gain = 0.5 }) {
  const osc = audio.createOscillator();
  const env = audio.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, at + dur);
  // Ataque rápido e queda suave: evita o "clique" de ligar/desligar o som seco.
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(gain, at + 0.008);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(env).connect(master);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

// Destrava o áudio no primeiro clique/tecla, para os sons que chegam depois
// (mensagens, gente entrando na sala) já poderem tocar.
if (typeof window !== "undefined") {
  const unlock = () => {
    getContext()?.resume().catch(() => {});
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}
