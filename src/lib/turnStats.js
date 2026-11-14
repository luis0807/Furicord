/*
 * Contas e formatação do painel "Servidor de voz" (TurnStatsPanel), sem React:
 * tamanho em MB/GB, percentuais, nome do mês, dias do mês, projeção e série diária.
 */

export const GB = 1024 ** 3;
const MB = 1024 ** 2;

const number = (value, digits) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

// 0 B, 840 MB, 1,24 GB, 312 GB
export function formatSize(bytes) {
  if (!bytes) return "0 MB";
  if (bytes < GB) return `${number(Math.max(bytes / MB, 0.1), bytes < 10 * MB ? 1 : 0)} MB`;
  return `${number(bytes / GB, bytes < 100 * GB ? 2 : 0)} GB`;
}

export const percent = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);
// "12%", ou "<1%" quando há consumo mas ainda não chega a 1%.
export const percentLabel = (part, total) => (part > 0 && percent(part, total) === 0 ? "<1%" : `${percent(part, total)}%`);
const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
export const formatMonth = (key) => monthName.format(new Date(`${key}-01T12:00:00Z`));
// "Outubro de 2026" (só a primeira letra maiúscula).
export const formatMonthTitle = (key) => formatMonth(key).replace(/^./, (letter) => letter.toUpperCase());

export function monthInfo(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { year, monthNumber, daysInMonth };
}

export function projectMonthUsage(usedBytes, month, now) {
  const { daysInMonth } = monthInfo(month);
  const today = now.getUTCDate();
  // Ritmo até agora (dias completos + fração de hoje), projetado até o fim do mês.
  const elapsedDays = Math.max(today - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440, 0.25);
  const projection = (usedBytes / elapsedDays) * daysInMonth;
  return projection;
}

export function buildDailySeries(month, appDays, officialDays, now) {
  const { daysInMonth } = monthInfo(month);
  const today = now.toISOString().slice(0, 10);

  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const key = `${month}-${String(index + 1).padStart(2, "0")}`;
    const appBytes = appDays[key] ?? 0;
    const cfBytes = officialDays?.[key] ?? 0;
    return { day: index + 1, key, appBytes, cfBytes, bytes: Math.max(appBytes, cfBytes), future: key > today };
  });
  return days;
}
