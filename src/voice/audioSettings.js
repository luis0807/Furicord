// Preferências de áudio deste aparelho: microfone e alto-falante escolhidos, volumes
// e quem você silenciou ou deixou mais alto. Ficam só aqui (não vão para o servidor):
// os outros continuam ouvindo tudo normalmente.

const STORAGE_KEY = "furicord.audio";

export const MAX_VOLUME = 2; // 200%

// "" = o dispositivo padrão do sistema.
export const DEFAULT_AUDIO = Object.freeze({
  inputDeviceId: "",
  outputDeviceId: "",
  inputVolume: 1,
  outputVolume: 1,
  users: Object.freeze({}), // nome -> { volume, muted }
});

const DEFAULT_USER = Object.freeze({ volume: 1, muted: false });

export function clampVolume(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(MAX_VOLUME, Math.max(0, number)) : fallback;
}

export function normalizeAudioSettings(value) {
  const users = {};
  if (value?.users && typeof value.users === "object") {
    for (const [name, entry] of Object.entries(value.users)) {
      const user = { volume: clampVolume(entry?.volume), muted: entry?.muted === true };
      // Quem está no padrão não precisa ficar guardado.
      if (user.volume !== 1 || user.muted) users[name] = user;
    }
  }
  return {
    inputDeviceId: typeof value?.inputDeviceId === "string" ? value.inputDeviceId : "",
    outputDeviceId: typeof value?.outputDeviceId === "string" ? value.outputDeviceId : "",
    inputVolume: clampVolume(value?.inputVolume),
    outputVolume: clampVolume(value?.outputVolume),
    users,
  };
}

export function userAudio(settings, name) {
  return settings.users[name] ?? DEFAULT_USER;
}

// Volume final com que a voz de alguém toca para você (0 = não toca).
export function voiceVolume(settings, name) {
  const user = userAudio(settings, name);
  return user.muted ? 0 : user.volume * settings.outputVolume;
}

export function withUserAudio(settings, name, patch) {
  const users = { ...settings.users, [name]: { ...userAudio(settings, name), ...patch } };
  return normalizeAudioSettings({ ...settings, users });
}

// --- Store ---------------------------------------------------------------------

let settings = load();
const listeners = new Set();

export const getAudioSettings = () => settings;

export function subscribeAudioSettings(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateAudioSettings(patch) {
  commit(normalizeAudioSettings({ ...settings, ...patch }));
}

export function updateUserAudio(name, patch) {
  commit(withUserAudio(settings, name, patch));
}

function commit(next) {
  settings = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // sem armazenamento: vale só até fechar
  }
  for (const listener of listeners) listener();
}

function load() {
  try {
    return normalizeAudioSettings(JSON.parse(localStorage.getItem(STORAGE_KEY)));
  } catch {
    return normalizeAudioSettings(DEFAULT_AUDIO);
  }
}
