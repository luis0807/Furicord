// Sem foto de perfil: cada nome ganha uma cor fixa e as iniciais.
const COLORS = ["#e8590c", "#d6336c", "#ae3ec9", "#7048e8", "#1c7ed6", "#0c8599", "#2f9e44", "#c77700"];

export function colorFor(name = "") {
  let hash = 0;
  for (const char of name.toLocaleLowerCase("pt-BR")) {
    hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  }
  return COLORS[hash % COLORS.length];
}

export function initialsFor(name = "") {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = Array.from(words[0] ?? "?")[0];
  const last = words.length > 1 ? Array.from(words.at(-1))[0] : "";
  return (first + last).toLocaleUpperCase("pt-BR");
}
