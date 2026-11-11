import { useState } from "react";
import { isValidToken, normalizeName } from "../lib/identity.js";
import { BrandMark } from "./ui.jsx";

export default function LoginScreen({ initialName, error, onSubmitName, onSubmitCode }) {
  const [mode, setMode] = useState("name"); // "name" (conta nova / voltar) | "code" (outro aparelho)
  const [name, setName] = useState(initialName);
  const [code, setCode] = useState("");
  const [localError, setLocalError] = useState(null);

  function handleSubmit(event) {
    event.preventDefault();
    if (mode === "code") {
      const trimmed = code.trim();
      if (!isValidToken(trimmed)) {
        setLocalError("Esse não parece um código de acesso. Copie ele inteiro de Configurações > Conta.");
        return;
      }
      onSubmitCode(trimmed);
      return;
    }
    const normalized = normalizeName(name);
    if (!normalized) {
      setLocalError("Use de 2 a 32 caracteres.");
      return;
    }
    onSubmitName(normalized);
  }

  function switchMode(next) {
    setMode(next);
    setLocalError(null);
  }

  const shownError = localError ?? error;
  const isCode = mode === "code";

  return (
    <main className="login">
      <form className="login-card" onSubmit={handleSubmit} noValidate>
        <div className="login-brand">
          <BrandMark size={44} />
          <h1>Furicord</h1>
        </div>
        <p className="login-lead">
          {isCode
            ? "Cole o código de acesso da sua conta (fica em Configurações > Conta, no aparelho onde você já entrou)."
            : "Escolha um nome e entre. Sem senha: este navegador fica lembrado e o nome passa a ser só seu."}
        </p>

        <label className="field-label" htmlFor="login-input">
          {isCode ? "Código de acesso" : "Nome de usuário"}
        </label>
        <input
          key={mode}
          id="login-input"
          className={isCode ? "text-input code-input" : "text-input"}
          value={isCode ? code : name}
          onChange={(event) => {
            if (isCode) setCode(event.target.value);
            else setName(event.target.value);
            setLocalError(null);
          }}
          maxLength={isCode ? 128 : 40}
          autoComplete={isCode ? "off" : "nickname"}
          spellCheck={false}
          autoFocus
          aria-invalid={Boolean(shownError)}
          aria-describedby={shownError ? "login-error" : undefined}
        />
        {shownError && (
          <p className="form-error" id="login-error" role="alert">
            {shownError}
          </p>
        )}

        <button type="submit" className="button-primary" disabled={!(isCode ? code : name).trim()}>
          Entrar
        </button>

        <button type="button" className="link-button login-switch" onClick={() => switchMode(isCode ? "name" : "code")}>
          {isCode ? "Criar uma conta nova com um nome" : "Já tenho conta — entrar com código de acesso"}
        </button>
      </form>
    </main>
  );
}
