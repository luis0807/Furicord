import { useState } from "react";
import { normalizeName } from "../lib/identity.js";
import { BrandMark } from "./ui.jsx";

export default function LoginScreen({ initialName, error, onSubmit }) {
  const [name, setName] = useState(initialName);
  const [localError, setLocalError] = useState(null);

  function handleSubmit(event) {
    event.preventDefault();
    const normalized = normalizeName(name);
    if (!normalized) {
      setLocalError("Use de 2 a 32 caracteres.");
      return;
    }
    onSubmit(normalized);
  }

  const shownError = localError ?? error;

  return (
    <main className="login">
      <form className="login-card" onSubmit={handleSubmit} noValidate>
        <div className="login-brand">
          <BrandMark size={44} />
          <h1>Furicord</h1>
        </div>
        <p className="login-lead">Escolha um nome e entre. Sem cadastro, sem senha.</p>

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
          autoComplete="nickname"
          autoFocus
          aria-invalid={Boolean(shownError)}
          aria-describedby={shownError ? "login-error" : undefined}
        />
        {shownError && (
          <p className="form-error" id="login-error" role="alert">
            {shownError}
          </p>
        )}

        <button type="submit" className="button-primary" disabled={!name.trim()}>
          Entrar
        </button>
      </form>
    </main>
  );
}
