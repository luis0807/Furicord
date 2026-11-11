const time = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const longDate = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", year: "numeric" });

export const formatTime = (date) => time.format(new Date(date));
export const formatDay = (date) => longDate.format(new Date(date));

export function isSameDay(a, b) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

// "Hoje às 14:03", "Ontem às 09:12" ou "05/11/2026 14:03"
export function formatTimestamp(date) {
  const value = new Date(date);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (isSameDay(value, now)) return `Hoje às ${time.format(value)}`;
  if (isSameDay(value, yesterday)) return `Ontem às ${time.format(value)}`;
  return `${shortDate.format(value)} ${time.format(value)}`;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export function listNames(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} e ${names.at(-1)}`;
}
