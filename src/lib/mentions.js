// Menções "@Nome". Nomes podem ter espaços, então a menção é reconhecida comparando
// com os nomes dos membros — e só vale se não continuar numa palavra maior
// (@Ana não menciona a Anabela) nem vier grudada antes (e-mail não é menção).
// "@everyone" menciona todo mundo; o servidor não deixa ninguém se chamar assim.

const LOCALE = "pt-BR";
const WORD = "[\\p{L}\\p{N}_]";
const MAX_QUERY = 32;

export const EVERYONE = "everyone";

const lower = (value) => value.toLocaleLowerCase(LOCALE);
const escapeRegExp = (value) => value.replace(/[\\^$.*+?()[\]{}|/]/g, "\\$&");

function mentionPattern(names, flags) {
  // Mais longos primeiro: "@Ana Paula" ganha de "@Ana".
  const sorted = [...names].sort((a, b) => b.length - a.length);
  return new RegExp(`(?<!${WORD})@(${sorted.map(escapeRegExp).join("|")})(?!${WORD})`, flags);
}

const everyonePattern = mentionPattern([EVERYONE], "iu");

export function buildMentionMatcher(names) {
  const all = [EVERYONE, ...names.filter((name) => lower(name) !== EVERYONE)];
  return {
    pattern: mentionPattern(all, "giu"),
    byLower: new Map(all.map((name) => [lower(name), name])),
  };
}

export function mentionsName(content, name) {
  if (!content || !name) return false;
  return mentionPattern([name], "iu").test(content);
}

export const mentionsEveryone = (content) => Boolean(content) && everyonePattern.test(content);

// Divide o texto em pedaços: strings e { mention: nome (ou EVERYONE), index }.
export function splitMentions(text, matcher) {
  const parts = [];
  let last = 0;
  for (const match of text.matchAll(matcher.pattern)) {
    const name = matcher.byLower.get(lower(match[1]));
    if (!name) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ mention: name, index: match.index });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// O "@algo" que está sendo digitado no cursor, ou null.
export function mentionQueryAt(text, caret) {
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start === -1 || (start > 0 && !/\s/.test(before[start - 1]))) return null;
  const query = before.slice(start + 1);
  if (query.length > MAX_QUERY || /\n|\s\s/.test(query)) return null;
  return { start, query };
}

// Sugestões do "@": @everyone primeiro (se combinar), depois os membros.
export function suggestMembers(users, query, selfName, limit = 8) {
  const q = lower(query);
  const members = users
    .filter((user) => user.name !== selfName)
    .filter((user) => {
      const name = lower(user.name);
      return name.startsWith(q) || name.includes(` ${q}`);
    })
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name, LOCALE));
  const everyone = EVERYONE.startsWith(q) ? [{ name: EVERYONE, everyone: true }] : [];
  return [...everyone, ...members].slice(0, limit);
}
