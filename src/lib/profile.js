// Perfil visual de cada pessoa. Fica salvo na conta, no servidor (formato validado
// em server/src/lib/profile.js), que repassa para quem está online.

const STORAGE_KEY = "furicord.profile";
export const MAX_BIO_LENGTH = 190;

export const EMPTY_PROFILE = Object.freeze({
  avatarId: null,
  bannerId: null,
  bannerColor: null,
  themeColors: null, // [cor de cima, cor de baixo] do cartão de perfil
  bio: "",
  nameStyle: { font: null, effect: null, colors: [] },
  decoration: null, // enfeite em volta do avatar
  effect: null, // animação por cima do cartão de perfil
  nameplate: null, // fundo do nome na lista de membros
});

// Os ids vão para o servidor, que só aceita a-z, 0-9 e hífen.
export const NAME_FONTS = [
  { id: null, label: "Padrão", family: null },
  { id: "bungee", label: "Bungee", family: "'Bungee', sans-serif" },
  { id: "pacifico", label: "Pacifico", family: "'Pacifico', cursive" },
  { id: "pixel", label: "Pixel", family: "'Pixelify Sans', monospace" },
  { id: "orbitron", label: "Orbitron", family: "'Orbitron', sans-serif" },
  { id: "creepster", label: "Terror", family: "'Creepster', cursive" },
  { id: "marker", label: "Marcador", family: "'Permanent Marker', cursive" },
  { id: "righteous", label: "Righteous", family: "'Righteous', sans-serif" },
];

// `colors`: quantas cores o efeito usa (0 = ignora as cores escolhidas).
export const NAME_EFFECTS = [
  { id: null, label: "Cor sólida", colors: 1 },
  { id: "gradient", label: "Gradiente", colors: 2 },
  { id: "shimmer", label: "Brilho animado", colors: 2 },
  { id: "glow", label: "Aura", colors: 2 },
  { id: "neon", label: "Neon", colors: 2 },
  { id: "rainbow", label: "Arco-íris", colors: 0 },
];

export const DECORATIONS = [
  { id: null, label: "Nenhuma" },
  { id: "chamas", label: "Chamas" },
  { id: "orbita", label: "Órbita" },
  { id: "neon", label: "Neon" },
  { id: "arco-iris", label: "Arco-íris" },
  { id: "brilhos", label: "Brilhos" },
  { id: "gelo", label: "Gelo" },
  { id: "coroa", label: "Coroa" },
];

export const PROFILE_EFFECTS = [
  { id: null, label: "Nenhum" },
  { id: "brasas", label: "Brasas" },
  { id: "neve", label: "Neve" },
  { id: "estrelas", label: "Estrelas" },
  { id: "bolhas", label: "Bolhas" },
  { id: "aurora", label: "Aurora" },
];

export const NAMEPLATES = [
  { id: null, label: "Nenhuma" },
  { id: "por-do-sol", label: "Pôr do sol" },
  { id: "oceano", label: "Oceano" },
  { id: "galaxia", label: "Galáxia" },
  { id: "floresta", label: "Floresta" },
  { id: "synthwave", label: "Synthwave" },
  { id: "lava", label: "Lava" },
];

export const PROFILE_THEME_PRESETS = [
  ["#ff6a3d", "#7048e8"],
  ["#1c7ed6", "#0c8599"],
  ["#d6336c", "#ae3ec9"],
  ["#2f9e44", "#0c8599"],
  ["#f59f00", "#e8590c"],
  ["#5c7cfa", "#15aabf"],
  ["#343a40", "#868e96"],
];

const known = (list, id) => (list.some((item) => item.id === id) ? id : null);

// Só devolve o que este front sabe desenhar (o servidor aceita qualquer slug).
export const decorationOf = (profile) => known(DECORATIONS, profile?.decoration ?? null);
export const effectOf = (profile) => known(PROFILE_EFFECTS, profile?.effect ?? null);
export const nameplateOf = (profile) => known(NAMEPLATES, profile?.nameplate ?? null);

// Classe e variáveis CSS do nome estilizado (fonte, cor, efeito).
export function nameStyleOf(profile) {
  const style = profile?.nameStyle;
  if (!style) return { className: null, style: undefined };

  const font = NAME_FONTS.find((item) => item.id === style.font && item.id)?.family;
  const effect = NAME_EFFECTS.find((item) => item.id === style.effect && item.id);
  const [first, second] = style.colors ?? [];
  const css = {};
  if (font) css.fontFamily = font;
  if (first) css["--name-1"] = first;
  if (second) css["--name-2"] = second;

  let className = null;
  if (effect) className = `name-fx name-fx-${effect.id}`;
  else if (first) className = "name-color";
  if (font) className = className ? `${className} has-name-font` : "has-name-font";

  return { className, style: Object.keys(css).length ? css : undefined };
}

export function normalizeProfile(raw) {
  const value = raw && typeof raw === "object" ? raw : {};
  const nameStyle = value.nameStyle && typeof value.nameStyle === "object" ? value.nameStyle : {};
  return {
    ...EMPTY_PROFILE,
    avatarId: typeof value.avatarId === "string" ? value.avatarId : null,
    bannerId: typeof value.bannerId === "string" ? value.bannerId : null,
    bannerColor: typeof value.bannerColor === "string" ? value.bannerColor : null,
    themeColors: Array.isArray(value.themeColors) && value.themeColors.length === 2 ? value.themeColors : null,
    bio: typeof value.bio === "string" ? value.bio.slice(0, MAX_BIO_LENGTH) : "",
    nameStyle: {
      font: nameStyle.font ?? null,
      effect: nameStyle.effect ?? null,
      colors: Array.isArray(nameStyle.colors) ? nameStyle.colors.slice(0, 2) : [],
    },
    decoration: value.decoration ?? null,
    effect: value.effect ?? null,
    nameplate: value.nameplate ?? null,
  };
}

// Antes das contas, o perfil ficava só no navegador. Ele vai junto na primeira
// conexão para virar o perfil da conta e depois é apagado daqui.
export function takeLegacyProfile() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeProfile(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function clearLegacyProfile() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // sem armazenamento: nada para limpar
  }
}
