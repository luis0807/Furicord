// Tema do app: cor de destaque e, opcionalmente, um fundo em gradiente.
// É uma preferência só deste navegador — os outros não veem.

const STORAGE_KEY = "furicord.theme";

export const THEMES = [
  { id: "padrao", label: "Padrão", accent: "#ff6a3d", gradient: null },
  { id: "meia-noite", label: "Meia-noite", accent: "#5b8cff", gradient: ["#0b1026", "#1d1247"] },
  { id: "floresta", label: "Floresta", accent: "#3ccf72", gradient: ["#06170e", "#143a26"] },
  { id: "oceano", label: "Oceano", accent: "#22c3e6", gradient: ["#03182a", "#0a3d4c"] },
  { id: "por-do-sol", label: "Pôr do sol", accent: "#ff7a59", gradient: ["#2b0f33", "#4d1a14"] },
  { id: "lavanda", label: "Lavanda", accent: "#b48cff", gradient: ["#16112b", "#2c1843"] },
  { id: "carmesim", label: "Carmesim", accent: "#ff4d6d", gradient: ["#1f0610", "#3d0d1b"] },
  { id: "neon", label: "Neon", accent: "#ff4fd8", gradient: ["#140328", "#03282f"] },
];

const DEFAULT_THEME = { id: "padrao" };
const HEX = /^#[0-9a-f]{6}$/i;

// { id } de um tema pronto, ou { id: "custom", accent, gradient: [a, b] | null }.
export function resolveTheme(saved) {
  if (saved?.id === "custom" && HEX.test(saved.accent ?? "")) {
    const gradient = Array.isArray(saved.gradient) && saved.gradient.every((c) => HEX.test(c)) ? saved.gradient : null;
    return { id: "custom", label: "Personalizado", accent: saved.accent, gradient };
  }
  return THEMES.find((theme) => theme.id === saved?.id) ?? THEMES[0];
}

export function loadTheme() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) ?? DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(theme));
  } catch {
    // sem armazenamento: o tema vale até fechar a aba
  }
}

export function applyTheme(saved) {
  const theme = resolveTheme(saved);
  const root = document.documentElement;
  root.style.setProperty("--accent", theme.accent);
  if (theme.gradient) {
    root.dataset.gradient = "";
    root.style.setProperty("--app-grad-1", theme.gradient[0]);
    root.style.setProperty("--app-grad-2", theme.gradient[1]);
  } else {
    delete root.dataset.gradient;
    root.style.removeProperty("--app-grad-1");
    root.style.removeProperty("--app-grad-2");
  }
  // Cor da barra do navegador no celular.
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.gradient?.[0] ?? "#16161a");
}
