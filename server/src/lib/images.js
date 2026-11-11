// Descobre o tipo pela assinatura dos bytes em vez de confiar no que o navegador
// declarou. SVG fica de fora de propósito: pode carregar script.
export function sniffImageType(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer.toString("ascii", 1, 4) === "PNG") {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6 && /^GIF8[79]a$/.test(buffer.toString("ascii", 0, 6))) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export function cleanFileName(original, contentType) {
  const base = String(original || "")
    .replace(/[\u0000-\u001f\u007f/\\]/g, "")
    .trim()
    .slice(0, 100);
  return base || `imagem.${EXTENSIONS[contentType]}`;
}

// Largura/altura vêm do navegador (só para reservar espaço na tela antes da imagem carregar).
export function toDimension(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 && number <= 20000 ? number : undefined;
}
