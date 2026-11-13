import mongoose from "mongoose";
import { CLOUDFLARE_TURN, CLOUDFLARE_ANALYTICS, TURN_ALERT_GB, TURN_MONTHLY_LIMIT_GB } from "../config.js";
import { User } from "../models/User.js";

/*
 * Cota mensal do TURN da Cloudflare.
 *
 * A Cloudflare não tem "teto de gasto": passou da franquia, cobra. Então o controle
 * fica aqui. A conta do mês vem de duas fontes, e vale a MAIOR:
 *   1. os próprios navegadores avisam quantos bytes receberam pelo TURN (funciona
 *      sem configurar nada, mas depende de o navegador avisar);
 *   2. o número oficial da Cloudflare (opcional: CLOUDFLARE_ACCOUNT_ID +
 *      CLOUDFLARE_ANALYTICS_TOKEN), que pega também o que não passou pelo app.
 * Ao chegar em TURN_MONTHLY_LIMIT_GB o TURN é desligado até virar o mês: o servidor
 * para de entregar credenciais e cancela a que estava em uso. Antes disso, ao passar
 * de cada marca de TURN_ALERT_GB (500 e 700 GB), avisa no log e no app.
 *
 * O que a Cloudflare cobra é só o que ela ENVIA para quem usa o TURN, por isso
 * cada navegador conta os bytes que recebeu.
 *
 * Para o painel "Servidor de voz" (turnStats), o documento do mês também guarda o
 * consumo por dia, por pessoa e quanto foi transmissão de tela, e por onde as
 * conexões passaram (rede local, direto pela internet ou TURN).
 */

const GB = 1024 ** 3;
const FLUSH_MS = 30_000;
const CLOUDFLARE_CHECK_MS = 10 * 60_000;
const PATHS = ["local", "direct", "relay"];

// Um documento por mês ("2026-11"), somado com $inc: o servidor local e o do Render
// usam o mesmo banco e a mesma franquia. Campos (todos opcionais além de bytes):
//   days.<AAAA-MM-DD>, screen, users.<userId>.bytes / .screen, paths.<local|direct|relay>
// `strict: false` porque os nomes desses campos são dinâmicos.
const TurnUsage = mongoose.model(
  "TurnUsage",
  new mongoose.Schema({ _id: String, bytes: { type: Number, default: 0 } }, { versionKey: false, strict: false }),
);

const limitBytes = TURN_MONTHLY_LIMIT_GB * GB;
// Mês e dia em UTC, como a cobrança da Cloudflare.
const monthKey = () => new Date().toISOString().slice(0, 7);
const dayKey = () => new Date().toISOString().slice(0, 10);

let month = monthKey();
let reported = 0; // já gravado no banco
let pending = newPending(); // avisado pelos navegadores e ainda não gravado
let stale = null; // lote do mês que acabou de virar, ainda não gravado
let official = 0; // número da Cloudflare (0 se não configurado)
let blocked = false;
let alerted = 0; // maior marca de alerta (em GB) já ultrapassada neste mês
let onBlocked = () => {};
let onAlert = () => {};
// Última consulta à Cloudflare, para o painel: { at, error, days: { "AAAA-MM-DD": bytes } }
let cloudflare = { at: null, ok: false, error: null, days: null };

function newPending() {
  return { month: monthKey(), bytes: 0, inc: {} };
}
const unsaved = () => (pending.month === month ? pending.bytes : 0);
const used = () => Math.max(reported + unsaved(), official);
const addInc = (batch, field, amount) => {
  if (amount > 0) batch.inc[field] = (batch.inc[field] ?? 0) + amount;
};
const bump = (field, amount) => addInc(pending, field, amount);
// Junta o lote `b` ao `a` (do mesmo mês).
function merge(a, b) {
  if (!a) return b;
  a.bytes += b.bytes;
  for (const [field, amount] of Object.entries(b.inc)) addInc(a, field, amount);
  return a;
}
// Virou o mês: o que foi contado até aqui é do mês anterior e vai para o documento dele.
function rotate() {
  if (pending.month === monthKey()) return;
  stale = merge(stale, pending);
  pending = newPending();
  flushSoon();
}
const toUpdate = (batch) => ({ $inc: { bytes: batch.bytes, ...batch.inc } });

export const turnBlocked = () => Boolean(CLOUDFLARE_TURN) && blocked;

export function turnStatus() {
  return {
    month,
    usedGB: Number((used() / GB).toFixed(2)),
    limitGB: TURN_MONTHLY_LIMIT_GB,
    blocked: turnBlocked(),
    source: CLOUDFLARE_ANALYTICS && official >= reported + unsaved() ? "cloudflare" : "navegadores",
  };
}

// O aviso que o app deve mostrar agora, ou null se o consumo está abaixo dos alertas.
export function turnAlert() {
  if (!CLOUDFLARE_TURN || (!alerted && !blocked)) return null;
  const { month, usedGB, limitGB } = turnStatus();
  return { month, usedGB, limitGB, alertGB: alerted, blocked };
}

// `bytes` recebidos pelo TURN desde o último aviso; `screen` é a parte que foi
// transmissão de tela (o resto é voz e controle da conexão).
export function addTurnUsage(bytes, { userId = null, screen = 0 } = {}) {
  if (!(bytes > 0)) return;
  screen = Math.min(Math.max(screen, 0), bytes);
  rotate();
  pending.bytes += bytes;
  bump(`days.${dayKey()}`, bytes);
  bump("screen", screen);
  if (userId) {
    bump(`users.${userId}.bytes`, bytes);
    bump(`users.${userId}.screen`, screen);
  }
  evaluate();
}

// Uma conexão de voz se estabeleceu (ou mudou de caminho). Só para o painel.
export function addConnectionPath(path) {
  if (!PATHS.includes(path)) return;
  rotate();
  bump(`paths.${path}`, 1);
}

export async function startTurnBudget(callbacks = {}) {
  if (!CLOUDFLARE_TURN) return;
  if (callbacks.onBlocked) onBlocked = callbacks.onBlocked;
  if (callbacks.onAlert) onAlert = callbacks.onAlert;
  await flush().catch(logError);
  setInterval(() => flush().catch(logError), FLUSH_MS).unref();
  if (CLOUDFLARE_ANALYTICS) {
    await checkCloudflare();
    setInterval(checkCloudflare, CLOUDFLARE_CHECK_MS).unref();
  }
  const status = turnStatus();
  console.log(`TURN: ${status.usedGB} GB usados de ${status.limitGB} GB em ${status.month}`);
}

function evaluate() {
  const usedGB = used() / GB;
  const mark = TURN_ALERT_GB.findLast((gb) => usedGB >= gb) ?? 0;
  const crossed = mark > alerted;
  if (crossed) {
    alerted = mark;
    console.warn(`TURN: ALERTA — o consumo do mês passou de ${mark} GB (limite: ${TURN_MONTHLY_LIMIT_GB} GB).`);
  }

  if (used() >= limitBytes) {
    if (!blocked) {
      blocked = true;
      console.warn(`TURN: limite mensal de ${TURN_MONTHLY_LIMIT_GB} GB atingido. Desligado até virar o mês.`);
      onBlocked();
      onAlert();
    }
    return;
  }
  blocked = false;
  if (crossed) onAlert();
}

// Virou o mês com dados do mês anterior ainda sem gravar: grava logo, no mês certo.
let flushTimer = null;
function flushSoon() {
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    flush().catch(logError);
  }, 0);
}

async function flush() {
  if (monthKey() !== month) {
    // Virou o mês: franquia nova.
    month = monthKey();
    reported = 0;
    official = 0;
    alerted = 0;
    cloudflare = { ...cloudflare, days: null };
  }
  rotate();
  if (stale) {
    const old = stale;
    stale = null;
    try {
      await TurnUsage.updateOne({ _id: old.month }, toUpdate(old), { upsert: true });
    } catch (err) {
      stale = merge(old, stale ?? newPending());
      throw err;
    }
  }

  const batch = pending;
  pending = newPending();
  try {
    const doc = await TurnUsage.findOneAndUpdate({ _id: month }, toUpdate(batch), {
      upsert: true,
      new: true,
      lean: true,
    });
    reported = doc.bytes;
  } catch (err) {
    // Devolve o lote para a fila, somando com o que chegou nesse meio-tempo.
    pending = merge(batch, pending);
    throw err;
  }
  evaluate();
}

async function checkCloudflare() {
  const { accountId, apiToken } = CLOUDFLARE_ANALYTICS;
  const now = new Date();
  const variables = {
    account: accountId,
    from: `${now.toISOString().slice(0, 7)}-01`,
    to: now.toISOString().slice(0, 10),
    key: CLOUDFLARE_TURN.keyId,
  };
  const filter = "filter: { date_geq: $from, date_leq: $to, keyId: $key }";
  const total = `total: callsTurnUsageAdaptiveGroups(${filter}, limit: 1) { sum { egressBytes } }`;
  // Por hora (o máximo de um mês são 744 horas), para o gráfico por dia do painel.
  const hours = `hours: callsTurnUsageAdaptiveGroups(${filter}, limit: 1000, orderBy: [datetimeHour_ASC]) {
        dimensions { datetimeHour }
        sum { egressBytes }
      }`;
  const query = (fields) => `query ($account: string, $from: Date, $to: Date, $key: string) {
    viewer { accounts(filter: { accountTag: $account }) { ${fields} } }
  }`;

  try {
    let account;
    let hourlyError = null;
    try {
      account = await cloudflareQuery(apiToken, query(`${total}\n${hours}`), variables);
    } catch (err) {
      // Se só a consulta por hora falhar, o total do mês (que protege a franquia) segue valendo.
      hourlyError = err.message;
      account = await cloudflareQuery(apiToken, query(total), variables);
    }
    official = Number(account?.total?.[0]?.sum?.egressBytes) || 0;

    let days = null;
    if (account?.hours) {
      days = {};
      for (const group of account.hours) {
        const day = String(group.dimensions?.datetimeHour ?? "").slice(0, 10);
        if (day) days[day] = (days[day] ?? 0) + (Number(group.sum?.egressBytes) || 0);
      }
    }
    cloudflare = { at: Date.now(), ok: true, error: hourlyError && `consulta por dia: ${hourlyError}`, days };
    evaluate();
  } catch (err) {
    // Sem o número oficial, segue valendo a conta dos navegadores.
    cloudflare = { ...cloudflare, at: Date.now(), ok: false, error: err.message };
    console.error("TURN: não foi possível consultar o uso na Cloudflare:", err.message);
  }
}

async function cloudflareQuery(apiToken, query, variables) {
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.errors?.length) {
    throw new Error(data.errors?.[0]?.message || `HTTP ${response.status}`);
  }
  const account = data.data?.viewer?.accounts?.[0];
  if (!account) throw new Error("conta não encontrada (confira o CLOUDFLARE_ACCOUNT_ID)");
  return account;
}

// Tudo o que o painel "Servidor de voz" mostra. Lê o banco na hora (o outro servidor
// pode ter gravado) e soma o que ainda não foi gravado aqui.
export async function turnStats() {
  if (!CLOUDFLARE_TURN) return { enabled: false };
  const [doc, history] = await Promise.all([
    TurnUsage.findById(month).lean(),
    TurnUsage.find({ _id: { $lt: month } }, { bytes: 1 }).sort({ _id: -1 }).limit(6).lean(),
  ]);

  const data = { bytes: 0, screen: 0, days: {}, users: {}, paths: {}, ...doc };
  if (pending.month === month) {
    data.bytes += pending.bytes;
    for (const [field, amount] of Object.entries(pending.inc)) {
      const parts = field.split(".");
      let target = data;
      for (const part of parts.slice(0, -1)) target = target[part] ??= {};
      const last = parts.at(-1);
      target[last] = (target[last] ?? 0) + amount;
    }
  }

  const ids = Object.keys(data.users).filter((id) => mongoose.isValidObjectId(id));
  const names = new Map(
    (await User.find({ _id: { $in: ids } }, { name: 1 }).lean()).map((user) => [String(user._id), user.name]),
  );
  const people = Object.entries(data.users)
    .map(([id, usage]) => ({ name: names.get(id) ?? null, bytes: usage.bytes ?? 0, screen: usage.screen ?? 0 }))
    .filter((person) => person.bytes > 0)
    .sort((a, b) => b.bytes - a.bytes);

  return {
    enabled: true,
    ...turnStatus(),
    alertsGB: TURN_ALERT_GB,
    usedBytes: used(),
    limitBytes,
    app: {
      bytes: data.bytes,
      screen: data.screen ?? 0,
      days: data.days ?? {},
      people,
      paths: Object.fromEntries(PATHS.map((path) => [path, data.paths?.[path] ?? 0])),
    },
    cloudflare: CLOUDFLARE_ANALYTICS
      ? {
          configured: true,
          ok: cloudflare.ok,
          bytes: official,
          checkedAt: cloudflare.at,
          error: cloudflare.error,
          days: cloudflare.days,
        }
      : { configured: false },
    history: history.map((item) => ({ month: item._id, bytes: item.bytes ?? 0 })),
  };
}

function logError(err) {
  console.error("TURN: não foi possível gravar o uso do mês:", err.message);
}
