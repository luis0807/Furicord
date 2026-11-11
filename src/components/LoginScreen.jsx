import { useEffect, useState } from "react";
import { CircleCheck, KeyRound, LoaderCircle } from "lucide-react";
import { checkName } from "../lib/api.js";
import { getKnownTokens, isValidToken, newToken, normalizeName } from "../lib/identity.js";
import { BrandMark } from "./ui.jsx";

// Um campo só: o nome. Enquanto a pessoa digita, o servidor confere sozinho:
//   nome livre                       -> cria a conta
//   essa conta já entrou aqui        -> entra direto, sem código
//   nome de alguém que nunca entrou aqui -> pede o código de acesso
export default function LoginScreen({ initialName, error, onSubmit }) {
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState("");
  const [check, setCheck] = useState(null); // { for, status, name, match }
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState(null);
  const normalized = normalizeName(name);

  useEffect(() => {
    if (!normalized) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      verify(normalized, controller.signal)
        .then(setCheck)
        .catch(() => {
          // Sem resposta (rede, limite): tenta de novo ao apertar Entrar.
          if (!controller.signal.aborted) setCheck({ for: normalized, status: "unknown" });
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [normalized]);

  const current = check?.for === normalized ? check : null;
  const status = !normalized ? null : (current?.status ?? "checking");
  const needsCode = status === "taken";

  async function handleSubmit(event) {
    event.preventDefault();
    if (!normalized) {
      setLocalError("Use de 2 a 32 caracteres.");
      return;
    }

    // Apertou Entrar antes de a verificação terminar: confere agora.
    let result = current;
    if (!result || result.status === "unknown") {
      setSubmitting(true);
      try {
        result = await verify(normalized);
        setCheck(result);
      } catch {
        setSubmitting(false);
        setLocalError("Não foi possível falar com o servidor. Tente de novo em instantes.");
        return;
      }
      setSubmitting(false);
    }

    if (result.status === "yours") {
      onSubmit(normalized, result.tokens[result.match]);
    } else if (result.status === "free") {
      onSubmit(normalized, newToken());
    } else if (result.status === "taken") {
      const trimmed = code.trim();
      if (!trimmed) return; // o campo do código acabou de aparecer
      if (!isValidToken(trimmed)) {
        setLocalError("Cole o código de acesso inteiro (fica em Configurações → Conta, no aparelho onde você já entrou).");
        return;
      }
      onSubmit(normalized, trimmed);
    }
  }

  const shownError = localError ?? error;

  return (
    <main className="login">
      <form className="login-card" onSubmit={handleSubmit} noValidate>
        <div className="login-brand">
          <BrandMark size={44} />
          <h1>Furicord</h1>
        </div>
        <p className="login-lead">Digite seu nome para entrar. Se ainda não tem conta, ela é criada na hora — sem senha.</p>

        <label className="field-label" htmlFor="login-name">
          Nome de usuário
        </label>
        <input
          id="login-name"
          className="text-input"
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setLocalError(null);
          }}
          maxLength={40}
          autoComplete="username"
          spellCheck={false}
          autoFocus
          aria-invalid={Boolean(shownError)}
          aria-describedby="login-status"
        />

        <div id="login-status" className="login-status" aria-live="polite">
          {status === "checking" && (
            <span className="is-muted">
              <LoaderCircle size={14} className="spin" /> Verificando…
            </span>
          )}
          {status === "free" && (
            <span className="is-ok">
              <CircleCheck size={14} /> Nome disponível — ele vai ser só seu.
            </span>
          )}
          {status === "yours" && (
            <span className="is-ok">
              <CircleCheck size={14} /> Você já entrou com esse nome neste navegador — não precisa de código.
            </span>
          )}
        </div>

        {needsCode && (
          <div className="login-code">
            <label className="field-label" htmlFor="login-code">
              <KeyRound size={13} /> Código de acesso
            </label>
            <p className="login-code-hint">
              “{current.name}” nunca entrou neste navegador. Se for você, cole o código de acesso da conta — ele fica em
              Configurações → Conta, no aparelho onde você já entrou.
            </p>
            <input
              id="login-code"
              className="text-input code-input"
              value={code}
              onChange={(event) => {
                setCode(event.target.value);
                setLocalError(null);
              }}
              placeholder="Cole o código aqui"
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </div>
        )}

        {shownError && (
          <p className="form-error" role="alert">
            {shownError}
          </p>
        )}

        <button
          type="submit"
          className="button-primary"
          disabled={submitting || !name.trim() || (needsCode && !code.trim())}
        >
          {submitting ? "Verificando…" : status === "free" ? "Criar conta e entrar" : "Entrar"}
        </button>
      </form>
    </main>
  );
}

// Pergunta ao servidor sobre o nome, levando os códigos das contas que já entraram
// neste navegador (ele responde qual deles, se algum, é da conta com esse nome).
async function verify(name, signal) {
  const tokens = getKnownTokens();
  const result = await checkName(name, tokens, signal);
  return { ...result, for: name, tokens };
}
