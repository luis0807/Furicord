import mongoose from "mongoose";
import { CLOUDFLARE_TURN, CLOUDFLARE_ANALYTICS, TURN_ALERT_GB, TURN_MONTHLY_LIMIT_GB } from "../config.js";

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
 */

const GB = 1024 ** 3;
const FLUSH_MS = 30_000;
const CLOUDFLARE_CHECK_MS = 10 * 60_000;

// Um documento por mês ("2026-11"), somado com $inc: o servidor local e o do Render
// usam o mesmo banco e a mesma franquia.
const TurnUsage = mongoose.model(
  "TurnUsage",
  new mongoose.Schema({ _id: String, bytes: { type: Number, default: 0 } }, { versionKey: false }),
);

const limitBytes = TURN_MONTHLY_LIMIT_GB * GB;
const monthKey = () => new Date().toISOString().slice(0, 7); // mês em UTC, como a cobrança

let month = monthKey();
let reported = 0; // já gravado no banco
let unsaved = 0; // avisado pelos navegadores e ainda não gravado
let official = 0; // número da Cloudflare (0 se não configurado)
let blocked = false;
let alerted = 0; // maior marca de alerta (em GB) já ultrapassada neste mês
let onBlocked = () => {};
let onAlert = () => {};

const used = () => Math.max(reported + unsaved, official);

export const turnBlocked = () => Boolean(CLOUDFLARE_TURN) && blocked;

export function turnStatus() {
  return {
    month,
    usedGB: Number((used() / GB).toFixed(2)),
    limitGB: TURN_MONTHLY_LIMIT_GB,
    blocked: turnBlocked(),
    source: CLOUDFLARE_ANALYTICS && official >= reported + unsaved ? "cloudflare" : "navegadores",
  };
}

// O aviso que o app deve mostrar agora, ou null se o consumo está abaixo dos alertas.
export function turnAlert() {
  if (!CLOUDFLARE_TURN || (!alerted && !blocked)) return null;
  const { month, usedGB, limitGB } = turnStatus();
  return { month, usedGB, limitGB, alertGB: alerted, blocked };
}

export function addTurnUsage(bytes) {
  unsaved += bytes;
  evaluate();
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

async function flush() {
  if (monthKey() !== month) {
    // Virou o mês: franquia nova. O que sobrou sem gravar conta no mês novo.
    month = monthKey();
    reported = 0;
    official = 0;
    alerted = 0;
  }
  const pending = unsaved;
  unsaved = 0;
  try {
    const doc = await TurnUsage.findOneAndUpdate(
      { _id: month },
      { $inc: { bytes: pending } },
      { upsert: true, new: true, lean: true },
    );
    reported = doc.bytes;
  } catch (err) {
    unsaved += pending;
    throw err;
  }
  evaluate();
}

async function checkCloudflare() {
  const { accountId, apiToken } = CLOUDFLARE_ANALYTICS;
  const now = new Date();
  const query = `query ($account: string, $from: Date, $to: Date, $key: string) {
    viewer { accounts(filter: { accountTag: $account }) {
      callsTurnUsageAdaptiveGroups(filter: { date_geq: $from, date_leq: $to, keyId: $key }, limit: 1) {
        sum { egressBytes }
      }
    } }
  }`;
  try {
    const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: {
          account: accountId,
          from: `${now.toISOString().slice(0, 7)}-01`,
          to: now.toISOString().slice(0, 10),
          key: CLOUDFLARE_TURN.keyId,
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json();
    if (!response.ok || data.errors?.length) {
      throw new Error(data.errors?.[0]?.message || `HTTP ${response.status}`);
    }
    const groups = data.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups ?? [];
    official = Number(groups[0]?.sum?.egressBytes) || 0;
    evaluate();
  } catch (err) {
    // Sem o número oficial, segue valendo a conta dos navegadores.
    console.error("TURN: não foi possível consultar o uso na Cloudflare:", err.message);
  }
}

function logError(err) {
  console.error("TURN: não foi possível gravar o uso do mês:", err.message);
}
