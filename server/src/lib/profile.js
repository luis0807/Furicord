import { isObjectId } from "./http.js";

/*
 * O perfil (avatar, banner, cores, estilo do nome, enfeites) fica guardado no
 * navegador de cada pessoa e chega aqui a cada conexão ou quando ela salva.
 * O servidor só garante o formato — ids de imagem válidos, cores #rrggbb, textos
 * curtos — e repassa para os outros. Fontes, efeitos e enfeites são só "slugs":
 * o front desenha os que conhece e ignora o resto.
 */

export const MAX_BIO_LENGTH = 190;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const SLUG = /^[a-z0-9-]{1,24}$/;
// Controle e invisíveis, menos a quebra de linha (o "Sobre mim" pode ter várias linhas).
// Montado por código numérico, como em names.js: escrever esses caracteres direto no
// regex quebra o arquivo (U+2028 conta como fim de linha).
const CONTROL_RANGES = [[0x00, 0x09], [0x0b, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff]];
const CONTROL = new RegExp(
  `[${CONTROL_RANGES.map(([from, to]) => `${String.fromCharCode(from)}-${String.fromCharCode(to)}`).join("")}]`,
  "g",
);

const color = (value) => (typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : null);
const slug = (value) => (typeof value === "string" && SLUG.test(value) ? value : null);
const imageId = (value) => (isObjectId(value) ? value : null);
const colors = (list, max) => (Array.isArray(list) ? list.map(color).filter(Boolean).slice(0, max) : []);

function cleanBio(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(CONTROL, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_BIO_LENGTH);
}

export function sanitizeProfile(raw) {
  if (!raw || typeof raw !== "object") return null;
  const nameStyle = raw.nameStyle && typeof raw.nameStyle === "object" ? raw.nameStyle : {};
  const themeColors = colors(raw.themeColors, 2);

  return {
    avatarId: imageId(raw.avatarId),
    bannerId: imageId(raw.bannerId),
    bannerColor: color(raw.bannerColor),
    themeColors: themeColors.length === 2 ? themeColors : null,
    bio: cleanBio(raw.bio),
    nameStyle: {
      font: slug(nameStyle.font),
      effect: slug(nameStyle.effect),
      colors: colors(nameStyle.colors, 2),
    },
    decoration: slug(raw.decoration),
    effect: slug(raw.effect),
    nameplate: slug(raw.nameplate),
  };
}

// Cópia gravada em cada mensagem: só o que aparece na lista de mensagens. Assim o
// histórico mostra o visual de quem escreveu mesmo depois que a pessoa sai.
export function messageProfile(profile) {
  if (!profile) return null;
  const { avatarId, nameStyle, decoration } = profile;
  const styled = nameStyle.font || nameStyle.effect || nameStyle.colors.length > 0;
  if (!avatarId && !decoration && !styled) return null;
  return { avatarId, nameStyle, decoration };
}
