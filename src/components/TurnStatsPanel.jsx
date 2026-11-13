import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { useChat } from "../state/chat-context.js";
import { cls } from "../lib/cls.js";

/*
 * Painel "Servidor de voz": quanto da franquia mensal do TURN da Cloudflare já foi
 * usado, por dia, por pessoa, voz × tela, e por onde as conexões passam. Só aparece
 * para as contas em ADMIN_NAMES (o servidor também confere a cada pedido).
 *
 * Duas fontes: o que os navegadores do Furicord contaram ("app") e, se configurado,
 * o número oficial da Cloudflare. A franquia usa o maior dos dois.
 */

const REFRESH_MS = 60_000;
const GB = 1024 ** 3;
const MB = 1024 ** 2;

const number = (value, digits) =>
  value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

// 0 B, 840 MB, 1,24 GB, 312 GB
function formatSize(bytes) {
  if (!bytes) return "0 MB";
  if (bytes < GB) return `${number(Math.max(bytes / MB, 0.1), bytes < 10 * MB ? 1 : 0)} MB`;
  return `${number(bytes / GB, bytes < 100 * GB ? 2 : 0)} GB`;
}

const percent = (part, total) => (total > 0 ? Math.round((part / total) * 100) : 0);
// "12%", ou "<1%" quando há consumo mas ainda não chega a 1%.
const percentLabel = (part, total) => (part > 0 && percent(part, total) === 0 ? "<1%" : `${percent(part, total)}%`);
const clock = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
const monthName = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
const formatMonth = (key) => monthName.format(new Date(`${key}-01T12:00:00Z`));
// "Outubro de 2026" (só a primeira letra maiúscula).
const formatMonthTitle = (key) => formatMonth(key).replace(/^./, (letter) => letter.toUpperCase());

const PATH_LABELS = {
  local: { label: "Mesma rede", hint: "mesma casa ou mesmo Wi-Fi" },
  direct: { label: "Direto pela internet", hint: "STUN, sem custo" },
  relay: { label: "Pelo TURN", hint: "gasta a franquia" },
};

export default function TurnStatsPanel() {
  const { fetchTurnStats } = useChat();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchTurnStats();
    setLoading(false);
    if (result?.error) setError(result.error);
    else {
      setError(null);
      setStats(result);
    }
  }, [fetchTurnStats]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (!stats) {
    return (
      <div className="settings-section-list">
        {error ? <p className="form-error">{error}</p> : <p className="settings-hint">Carregando…</p>}
      </div>
    );
  }

  if (!stats.enabled) {
    return (
      <div className="settings-section-list">
        <p className="settings-hint">
          O TURN da Cloudflare não está configurado neste servidor (faltam <code>CLOUDFLARE_TURN_KEY_ID</code> e{" "}
          <code>CLOUDFLARE_TURN_API_TOKEN</code>), então não há consumo para mostrar.
        </p>
      </div>
    );
  }

  return (
    <div className="settings-section-list turn-stats">
      <div className="turn-stats-toolbar">
        <span className="settings-hint">
          {formatMonth(stats.month)} · atualiza sozinho a cada minuto
          {error && <span className="form-error"> · {error}</span>}
        </span>
        <button type="button" className="button-ghost" onClick={load} disabled={loading}>
          <RefreshCw size={16} className={cls(loading && "is-spinning")} /> Atualizar
        </button>
      </div>

      <Overview stats={stats} />
      <SourceStatus stats={stats} />
      <DailyChart stats={stats} />
      <MediaSplit app={stats.app} />
      <People people={stats.app.people} />
      <Paths paths={stats.app.paths} />
      {stats.history.length > 0 && <History history={stats.history} limitBytes={stats.limitBytes} />}
    </div>
  );
}

// --- Visão geral ---------------------------------------------------------------

function Overview({ stats }) {
  const { usedBytes, limitBytes, alertsGB, blocked, month } = stats;
  const now = new Date();
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const today = now.getUTCDate();
  // Ritmo até agora (dias completos + fração de hoje), projetado até o fim do mês.
  const elapsedDays = Math.max(today - 1 + (now.getUTCHours() * 60 + now.getUTCMinutes()) / 1440, 0.25);
  const projection = (usedBytes / elapsedDays) * daysInMonth;
  const usedShare = Math.min(usedBytes / limitBytes, 1);
  const overProjection = projection >= limitBytes;

  return (
    <section>
      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="stat-tile-label">Usado no mês</span>
          <strong className="stat-tile-value">{formatSize(usedBytes)}</strong>
          <span className="stat-tile-sub">
            de {stats.limitGB} GB ({percentLabel(usedBytes, limitBytes)})
          </span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile-label">Restante</span>
          <strong className="stat-tile-value">{formatSize(Math.max(limitBytes - usedBytes, 0))}</strong>
          <span className="stat-tile-sub">até o limite que desliga o TURN</span>
        </div>
        <div className="stat-tile">
          <span className="stat-tile-label">Projeção do mês</span>
          <strong className="stat-tile-value">{formatSize(projection)}</strong>
          <span className={cls("stat-tile-sub", overProjection && "is-warning")}>
            {overProjection ? (
              <>
                <AlertTriangle size={13} /> passaria do limite neste ritmo
              </>
            ) : (
              "no ritmo atual"
            )}
          </span>
        </div>
      </div>

      <div
        className="usage-meter"
        role="meter"
        aria-label="Franquia do mês usada"
        aria-valuemin={0}
        aria-valuemax={stats.limitGB}
        aria-valuenow={Number((usedBytes / GB).toFixed(2))}
      >
        <div className={cls("usage-meter-fill", blocked && "is-blocked")} style={{ width: `${usedShare * 100}%` }} />
        {alertsGB.map((gb) => (
          <span
            key={gb}
            className="usage-meter-mark"
            style={{ left: `${((gb * GB) / limitBytes) * 100}%` }}
            title={`Alerta em ${gb} GB`}
          >
            <span>{gb} GB</span>
          </span>
        ))}
      </div>
      {blocked && (
        <p className="form-error">
          <AlertTriangle size={14} /> Limite atingido: o TURN está desligado até virar o mês. Quem conecta direto
          continua falando.
        </p>
      )}
    </section>
  );
}

// --- De onde vem o número -------------------------------------------------------

function SourceStatus({ stats }) {
  const { cloudflare, app } = stats;
  if (!cloudflare.configured) {
    return (
      <p className="settings-hint">
        Números contados pelos navegadores do Furicord. Para conferir com o número oficial da Cloudflare, cadastre{" "}
        <code>CLOUDFLARE_ACCOUNT_ID</code> e <code>CLOUDFLARE_ANALYTICS_TOKEN</code> no Render.
      </p>
    );
  }
  return (
    <div className="source-status">
      <div>
        <span className="stat-tile-label">Contado pelo app</span>
        <strong>{formatSize(app.bytes)}</strong>
      </div>
      <div>
        <span className="stat-tile-label">Oficial da Cloudflare</span>
        <strong>{cloudflare.ok ? formatSize(cloudflare.bytes) : "—"}</strong>
      </div>
      <p className="settings-hint">
        {cloudflare.checkedAt
          ? `Cloudflare conferida às ${clock.format(new Date(cloudflare.checkedAt))} (a cada 10 minutos). `
          : "A Cloudflare ainda não foi consultada desde que o servidor ligou. "}
        A franquia usa o maior dos dois.
      </p>
      {cloudflare.error && (
        <p className="form-error">
          <AlertTriangle size={14} /> Erro ao consultar a Cloudflare: {cloudflare.error}
        </p>
      )}
    </div>
  );
}

// --- Gráfico por dia -----------------------------------------------------------

function DailyChart({ stats }) {
  const [hover, setHover] = useState(null);
  const { month, app, cloudflare } = stats;
  const official = cloudflare.configured && cloudflare.days ? cloudflare.days : null;
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const today = new Date().toISOString().slice(0, 10);

  const days = Array.from({ length: daysInMonth }, (_, index) => {
    const key = `${month}-${String(index + 1).padStart(2, "0")}`;
    const appBytes = app.days[key] ?? 0;
    const cfBytes = official?.[key] ?? 0;
    return { day: index + 1, key, appBytes, cfBytes, bytes: Math.max(appBytes, cfBytes), future: key > today };
  });
  const max = Math.max(...days.map((item) => item.bytes), 0);
  const total = days.reduce((sum, item) => sum + item.bytes, 0);
  const active = hover !== null ? days[hover] : null;

  return (
    <section>
      <h3 className="field-label">Consumo por dia</h3>
      {total === 0 ? (
        <p className="settings-hint">Nenhum consumo pelo TURN neste mês ainda.</p>
      ) : (
        <div className="day-chart" onPointerLeave={() => setHover(null)}>
          <div className="day-chart-scale" aria-hidden="true">
            <span>{formatSize(max)}</span>
            <span>0</span>
          </div>
          <div className="day-chart-plot">
            {days.map((item, index) => (
              <div
                key={item.key}
                className={cls("day-chart-col", item.future && "is-future", hover === index && "is-hover")}
                onPointerEnter={() => setHover(index)}
                onClick={() => setHover(index)}
                aria-label={`Dia ${item.day}: ${formatSize(item.bytes)}`}
                role="img"
              >
                {item.bytes > 0 && (
                  <span className="day-chart-bar" style={{ height: `${Math.max((item.bytes / max) * 100, 2)}%` }} />
                )}
              </div>
            ))}
            {active && (
              <div
                className="chart-tooltip"
                style={{ left: `${((hover + 0.5) / daysInMonth) * 100}%` }}
                role="status"
              >
                <strong>
                  {String(active.day).padStart(2, "0")}/{String(monthNumber).padStart(2, "0")}
                </strong>
                <span>{formatSize(active.bytes)}</span>
                {official && (
                  <span className="chart-tooltip-detail">
                    app {formatSize(active.appBytes)} · Cloudflare {formatSize(active.cfBytes)}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="day-chart-axis" aria-hidden="true">
            {days.map((item) => (
              <span key={item.key}>{item.day === 1 || item.day % 5 === 0 ? item.day : ""}</span>
            ))}
          </div>
        </div>
      )}
      <p className="settings-hint">
        Cada barra é o maior entre o app e a Cloudflare naquele dia. Os dias seguem o horário UTC, como a cobrança
        (o dia vira às 21h de Brasília).
      </p>
    </section>
  );
}

// --- Voz × tela ----------------------------------------------------------------

function MediaSplit({ app }) {
  const voice = Math.max(app.bytes - app.screen, 0);
  return (
    <section>
      <h3 className="field-label">Voz × transmissão de tela</h3>
      <div className="split-rows">
        <ShareRow label="Voz" value={voice} total={app.bytes} />
        <ShareRow label="Transmissão de tela" value={app.screen} total={app.bytes} />
      </div>
      <p className="settings-hint">
        Contado pelos navegadores. Pelo TURN, a tela já vai em qualidade econômica (cerca de 0,5 GB por hora por
        espectador).
      </p>
    </section>
  );
}

function ShareRow({ label, hint, value, total, unit }) {
  const share = percent(value, total);
  return (
    <div className="share-row">
      <span className="share-row-label">
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <span className="share-row-track" aria-hidden="true">
        <span className="share-row-fill" style={{ width: `${share}%` }} />
      </span>
      <span className="share-row-value">
        {unit ? unit(value) : formatSize(value)} <small>{percentLabel(value, total)}</small>
      </span>
    </div>
  );
}

// --- Por pessoa ----------------------------------------------------------------

function People({ people }) {
  return (
    <section>
      <h3 className="field-label">Quem passou pelo TURN</h3>
      {people.length === 0 ? (
        <p className="settings-hint">Ninguém precisou do TURN neste mês.</p>
      ) : (
        <table className="stats-table">
          <thead>
            <tr>
              <th scope="col">Conta</th>
              <th scope="col">Total</th>
              <th scope="col">Tela</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person, index) => (
              <tr key={`${person.name}-${index}`}>
                <td>{person.name ?? <em>conta excluída</em>}</td>
                <td>{formatSize(person.bytes)}</td>
                <td>{formatSize(person.screen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="settings-hint">
        É o que cada pessoa <strong>recebeu</strong> pelo TURN (o que a Cloudflare cobra). Quem está numa rede que
        bloqueia conexão direta aparece aqui.
      </p>
    </section>
  );
}

// --- Por onde as conexões passam ----------------------------------------------

function Paths({ paths }) {
  const total = paths.local + paths.direct + paths.relay;
  const count = (value) => `${value} ${value === 1 ? "conexão" : "conexões"}`;
  return (
    <section>
      <h3 className="field-label">Por onde as conexões passaram</h3>
      {total === 0 ? (
        <p className="settings-hint">
          Nenhuma conexão de voz registrada neste mês. A contagem começou com esta versão do Furicord.
        </p>
      ) : (
        <div className="split-rows">
          {Object.entries(PATH_LABELS).map(([key, { label, hint }]) => (
            <ShareRow key={key} label={label} hint={hint} value={paths[key]} total={total} unit={count} />
          ))}
        </div>
      )}
      <p className="settings-hint">
        Cada par de pessoas numa sala conta como uma conexão, toda vez que alguém entra.
      </p>
    </section>
  );
}

// --- Meses anteriores ----------------------------------------------------------

function History({ history, limitBytes }) {
  return (
    <section>
      <h3 className="field-label">Meses anteriores</h3>
      <table className="stats-table">
        <tbody>
          {history.map((item) => (
            <tr key={item.month}>
              <td>{formatMonthTitle(item.month)}</td>
              <td>{formatSize(item.bytes)}</td>
              <td>{percentLabel(item.bytes, limitBytes)} do limite</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
