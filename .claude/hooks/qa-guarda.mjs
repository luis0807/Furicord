// Guarda dos agentes de QA. O Claude Code roda este script antes de cada Read/Edit/Write/Bash
// do `refatorador` e do `gerente-qa` (está registrado no frontmatter de cada um, em
// .claude/agents/). Sair com código 2 barra a chamada e devolve o motivo ao agente.
//
// É uma catraca contra acidentes, não uma sandbox: um teste rodado por `node --test` ainda
// executa código arbitrário. Quem cobre isso é a auditoria do gerente sobre o diff.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// ─── Limites: ajuste aqui ────────────────────────────────────────────────────────────────
const RAIZES_EDITAVEIS = ["src/", "server/src/", "tests/"]; // fora disso nenhum agente edita
const MAX_ARQUIVOS = 6; // arquivos já existentes que uma rodada pode alterar
const VALIDADE_MIN = 120; // minutos até o escopo expirar sozinho
const COMANDOS_LEITURA = new Set(["cd", "pwd", "ls", "cat", "head", "tail", "wc", "grep", "sort", "uniq", "echo", "diff", "true"]);
const GIT_LEITURA = new Set(["status", "diff", "log", "show", "ls-files", "grep", "blame", "rev-parse"]);
// Opções do node que rodam código solto ou carregam credenciais.
const NODE_PROIBIDO = /^(-e|--eval|-p|--print|-r|--require|--import|--env-file)/;
// ─────────────────────────────────────────────────────────────────────────────────────────

const RAIZ = path.resolve(import.meta.dirname, "..", "..");
const PASTA_QA = path.join(RAIZ, ".qa");
const ESCOPO = path.join(PASTA_QA, "escopo.json");
const LOG = path.join(PASTA_QA, "guarda.log");
// No Windows "SRC/App.jsx" e "src/app.jsx" são o mesmo arquivo.
const chave = (caminho) => (process.platform === "win32" ? caminho.toLowerCase() : caminho);

class Bloqueio extends Error {}
const negar = (motivo) => {
  throw new Bloqueio(motivo);
};

// Caminho relativo à raiz do projeto, com "/", ou null se cair fora dele.
function relativo(arquivo, base = RAIZ) {
  if (typeof arquivo !== "string" || !arquivo) return null;
  const rel = path.relative(RAIZ, path.resolve(base, arquivo));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

const temSegredo = (caminho) =>
  String(caminho).split(/[\\/]/).some((parte) => parte.startsWith(".env") && parte !== ".env.example");

const editavel = (rel) => !temSegredo(rel) && RAIZES_EDITAVEIS.some((raiz) => chave(rel).startsWith(raiz));

function lerEscopo() {
  const info = fs.statSync(ESCOPO, { throwIfNoEntry: false });
  if (!info) negar("Não há ordem de serviço aberta. O refatorador só edita depois que o gerente-qa abre o escopo (.qa/escopo.json).");
  if (Date.now() - info.mtimeMs > VALIDADE_MIN * 60_000) {
    negar(`A ordem de serviço expirou (vale ${VALIDADE_MIN} min). Pare e devolva o relatório do que já foi feito.`);
  }
  const escopo = JSON.parse(fs.readFileSync(ESCOPO, "utf8"));
  return {
    arquivos: (escopo.arquivos ?? []).map(chave),
    novos: (escopo.novos ?? []).map(chave),
    abertoEm: info.mtimeMs,
  };
}

// Refatorador: só o que a ordem de serviço liberou.
function avaliarEdicao(arquivo, cwd) {
  const rel = relativo(arquivo, cwd);
  if (!rel) negar(`"${arquivo}" fica fora do projeto.`);
  if (!editavel(rel)) {
    negar(`"${rel}" é protegido: os agentes de QA só editam dentro de ${RAIZES_EDITAVEIS.join(", ")} (e nunca arquivos .env). Anote como recomendação no relatório.`);
  }
  const escopo = lerEscopo();
  const alvo = chave(rel);
  if (escopo.arquivos.includes(alvo)) return;

  const emPastaNova = escopo.novos.some((pasta) => alvo.startsWith(pasta));
  const info = fs.statSync(path.join(RAIZ, rel), { throwIfNoEntry: false });
  if (!info && emPastaNova) return;
  // Arquivo que o próprio refatorador criou nesta rodada: pode continuar ajustando.
  if (info && emPastaNova && info.birthtimeMs >= escopo.abertoEm) return;

  negar(
    `"${rel}" não está na ordem de serviço desta rodada. Liberados: ${escopo.arquivos.join(", ") || "nenhum arquivo existente"}; ` +
      `arquivos novos em: ${escopo.novos.join(", ") || "nenhuma pasta"}. Não contorne: anote como recomendação no relatório.`,
  );
}

// Gerente: não edita código; só abre o escopo, e o escopo também tem regra.
function avaliarEscopoNovo(ferramenta, dados, cwd) {
  const rel = relativo(dados.file_path, cwd);
  if (ferramenta !== "Write" || !rel || chave(rel) !== ".qa/escopo.json") {
    negar("O gerente não edita código: o único arquivo que ele escreve é .qa/escopo.json, com Write.");
  }
  let escopo;
  try {
    escopo = JSON.parse(dados.content ?? "");
  } catch {
    negar("O escopo precisa ser JSON válido.");
  }
  const arquivos = escopo?.arquivos ?? [];
  const novos = escopo?.novos ?? [];
  if (!Array.isArray(arquivos) || !Array.isArray(novos)) negar('"arquivos" e "novos" precisam ser listas.');
  if (arquivos.length + novos.length === 0) negar('Escopo vazio: informe "arquivos" (existentes) e/ou "novos" (pastas para arquivos novos).');
  if (arquivos.length > MAX_ARQUIVOS) {
    negar(`No máximo ${MAX_ARQUIVOS} arquivos existentes por rodada (vieram ${arquivos.length}). Divida em rodadas menores.`);
  }
  for (const arquivo of arquivos) {
    const caminho = typeof arquivo === "string" && !path.isAbsolute(arquivo) ? relativo(arquivo) : null;
    if (!caminho || !editavel(caminho)) {
      negar(`"${arquivo}" não pode entrar no escopo: use caminhos relativos dentro de ${RAIZES_EDITAVEIS.join(", ")}.`);
    }
    if (!fs.statSync(path.join(RAIZ, caminho), { throwIfNoEntry: false })?.isFile()) {
      negar(`"${arquivo}" não existe. Arquivo a criar entra em "novos", como pasta terminada em "/".`);
    }
  }
  for (const pasta of novos) {
    const caminho = typeof pasta === "string" && pasta.endsWith("/") && !path.isAbsolute(pasta) ? relativo(pasta) : null;
    if (!caminho || !editavel(`${caminho}/`)) {
      negar(`"${pasta}" não serve em "novos": use pastas terminadas em "/" dentro de ${RAIZES_EDITAVEIS.join(", ")}.`);
    }
  }
  if (arquivos.length) {
    // Inclui o que está no stage: a rodada não se mistura com trabalho ainda não commitado.
    const sujos = execFileSync("git", ["status", "--porcelain", "--", ...arquivos], { cwd: RAIZ, encoding: "utf8" }).trim();
    if (sujos) {
      negar(`Estes arquivos têm alterações ainda não commitadas e ficam fora da rodada, para não misturar com o trabalho do usuário:\n${sujos}`);
    }
  }
}

// Divide em ; && || | & e quebras de linha, respeitando aspas.
function segmentos(comando) {
  const partes = [];
  let atual = "";
  let aspas = null;
  for (let i = 0; i < comando.length; i++) {
    const c = comando[i];
    if (aspas) {
      atual += c;
      if (c === aspas) aspas = null;
      else if (c === "\\" && aspas === '"') atual += comando[++i] ?? "";
    } else if (c === '"' || c === "'") {
      aspas = c;
      atual += c;
    } else if (c === "\\") {
      atual += c + (comando[++i] ?? "");
    } else if (c === ">") {
      negar("Comandos dos agentes de QA não gravam em arquivo (sem redirecionar a saída com >).");
    } else if (";\n|&".includes(c)) {
      partes.push(atual);
      atual = "";
      if ((c === "|" || c === "&") && comando[i + 1] === c) i++;
    } else {
      atual += c;
    }
  }
  partes.push(atual);
  return partes.map((parte) => parte.trim()).filter(Boolean);
}

function avaliarSegmento(segmento) {
  const [comando, ...args] = segmento.split(/\s+/);
  if (COMANDOS_LEITURA.has(comando)) return;
  if (comando === "git") {
    const sub = args[0] === "--no-pager" ? args[1] : args[0];
    if (GIT_LEITURA.has(sub) && !args.some((arg) => arg.startsWith("--output"))) return;
  }
  if (comando === "npm" && args.join(" ") === "run build") return;
  if (comando === "node" && ["--check", "--test"].includes(args[0]) && !args.some((arg) => NODE_PROIBIDO.test(arg))) return;
  negar(
    `Comando fora da lista permitida: "${segmento}". Permitidos: git (${[...GIT_LEITURA].join(", ")}), npm run build, ` +
      `node --check, node --test e leitura (${[...COMANDOS_LEITURA].join(", ")}). Para buscar e ler, use Grep, Glob e Read. ` +
      "Se precisar de outra coisa, anote no relatório em vez de contornar.",
  );
}

function avaliarComando(comando) {
  // Primeiro passo de cada agente: um comando inofensivo que TEM de ser barrado. Se ele rodar,
  // a guarda não está ligada e o agente para antes de mexer em qualquer coisa.
  if (comando.includes("QA_GUARDA_TESTE")) negar("Guarda ativa: teste de bloqueio OK. Pode seguir.");
  if (/(^|[\s/\\"'=])\.env(?!\.example)/.test(comando)) negar("Comandos não tocam em arquivos .env: eles guardam as credenciais de produção.");
  if (comando.includes("$(") || comando.includes("`") || comando.includes("<(")) negar("Sem substituição de comando ($(...) ou crases).");
  // 2>&1 e >/dev/null não gravam nada; saem antes para não parecerem redirecionamento.
  const limpo = comando.replace(/\d?>&\d/g, "").replace(/\d?>\s*\/dev\/null/g, "");
  for (const segmento of segmentos(limpo)) avaliarSegmento(segmento);
}

function avaliar(papel, ferramenta, dados, cwd) {
  if (ferramenta === "Read") {
    if (temSegredo(dados.file_path)) negar("Arquivos .env guardam as credenciais de produção: os agentes de QA não leem. Use .env.example.");
  } else if (ferramenta === "Bash") {
    avaliarComando(dados.command ?? "");
  } else if (ferramenta === "Write" || ferramenta === "Edit") {
    if (papel === "gerente") avaliarEscopoNovo(ferramenta, dados, cwd);
    else avaliarEdicao(dados.file_path, cwd);
  } else {
    negar(`A ferramenta ${ferramenta} não faz parte do trabalho de QA.`);
  }
}

// O gerente lê este log na auditoria para relatar o que foi barrado.
function registrar(papel, decisao, ferramenta, dados, motivo = "") {
  try {
    fs.mkdirSync(PASTA_QA, { recursive: true });
    const ignore = path.join(PASTA_QA, ".gitignore");
    if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
    const alvo = String(dados.command ?? relativo(dados.file_path) ?? dados.file_path ?? "").replace(/\s+/g, " ").slice(0, 160);
    const nota = motivo ? ` — ${motivo.replace(/\s+/g, " ").slice(0, 200)}` : "";
    fs.appendFileSync(LOG, `${new Date().toISOString()} ${papel} ${decisao} ${ferramenta} ${alvo}${nota}\n`);
  } catch {
    // O log só serve à auditoria; uma falha aqui não pode derrubar a guarda.
  }
}

async function main() {
  let entrada = "";
  for await (const pedaco of process.stdin) entrada += pedaco;
  const { tool_name: ferramenta, tool_input: dados = {}, agent_type: tipo, cwd } = JSON.parse(entrada);
  const papel = process.argv[2] ?? { refatorador: "refatorador", "gerente-qa": "gerente" }[tipo];
  if (!papel) return; // sessão principal ou outro agente: a guarda não se mete

  try {
    avaliar(papel, ferramenta, dados, cwd || RAIZ);
    if (ferramenta !== "Read") registrar(papel, "LIBERADO", ferramenta, dados);
  } catch (erro) {
    if (erro instanceof Bloqueio) registrar(papel, "BLOQUEADO", ferramenta, dados, erro.message);
    throw erro;
  }
}

main().catch((erro) => {
  // Falha fechada: na dúvida, barra. Código 2 é o que o Claude Code entende como bloqueio.
  const motivo = erro instanceof Bloqueio
    ? erro.message
    : `Erro interno da guarda de QA (${erro.message}). Por segurança a chamada foi barrada; pare e avise o usuário.`;
  process.stderr.write(`[guarda de QA] ${motivo}\n`);
  process.exitCode = 2;
});
