// Mesma regra do frontend (src/lib/identity.js): 2 a 32 caracteres visíveis.
// Controle e invisíveis (zero-width, direção de texto, BOM), montado por código numérico.
const INVISIBLE_RANGES = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]];
const INVISIBLE = new RegExp(
  `[${INVISIBLE_RANGES.map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`).join("")}]`,
  "g",
);

export function normalizeName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
  if (name.length < 2 || name.length > 32) return null;
  return name;
}

export const nameKey = (name) => name.toLocaleLowerCase("pt-BR");
