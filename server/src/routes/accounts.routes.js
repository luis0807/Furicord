import { Router } from "express";
import { User } from "../models/User.js";
import { HttpError } from "../lib/http.js";
import { createRateLimiter } from "../lib/rateLimit.js";
import { nameKey, normalizeName } from "../lib/names.js";
import { cleanToken, hashToken } from "../lib/accounts.js";

const router = Router();

// A tela de entrada consulta enquanto a pessoa digita (com intervalo), então o
// limite é folgado — só impede varrer nomes em massa.
const allowCheck = createRateLimiter({ windowMs: 60_000, max: 120 });
const MAX_TOKENS = 10;

// POST /api/accounts/check { name, tokens } -> { status, name, match? }
// `tokens` = códigos das contas que já entraram neste navegador.
//   free  = ninguém usa esse nome: entrar cria a conta
//   yours = essa conta já entrou neste navegador (`match` = qual dos códigos): sem código
//   taken = o nome tem dono e nunca entrou aqui: precisa do código de acesso
router.post("/check", async (req, res) => {
  if (!allowCheck(req.ip)) throw new HttpError(429, "Muitas verificações seguidas. Espere um pouco.");
  res.set("Cache-Control", "no-store");

  const name = normalizeName(req.body?.name);
  if (!name) return res.json({ status: "invalid" });

  const owner = await User.findOne({ nameKey: nameKey(name) }, { name: 1, tokenHash: 1 }).lean();
  if (!owner) return res.json({ status: "free", name });

  const tokens = Array.isArray(req.body?.tokens) ? req.body.tokens.slice(0, MAX_TOKENS) : [];
  const match = tokens.findIndex((token) => cleanToken(token) && hashToken(token) === owner.tokenHash);
  if (match >= 0) return res.json({ status: "yours", name: owner.name, match });
  res.json({ status: "taken", name: owner.name });
});

export default router;
