// cls("a", cond && "b") -> "a b" ou "a"
export const cls = (...names) => names.filter(Boolean).join(" ");
