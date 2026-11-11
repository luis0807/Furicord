import { useState } from "react";
import { forgetToken, getSavedName, getToken, saveName } from "./lib/identity.js";
import { ChatProvider } from "./state/ChatProvider.jsx";
import { VoiceProvider } from "./voice/VoiceProvider.jsx";
import LoginScreen from "./components/LoginScreen.jsx";
import AppShell from "./components/AppShell.jsx";

// Recusas em que o código não serve mais: este navegador para de lembrar dele.
const FORGET_TOKEN = new Set(["UNKNOWN_CODE", "INVALID_TOKEN", "DELETED"]);

export default function App() {
  // `login` muda só quando a pessoa entra ou sai — é isso que recria a conexão.
  //   { name, resume: true }  entrou da última vez e não saiu: conecta direto
  //   { name, token }         entrada pela tela: o código já foi escolhido lá
  //                           (lembrado deste navegador, novo, ou colado)
  const [login, setLogin] = useState(() => {
    const name = getSavedName();
    return name ? { name, resume: true } : null;
  });
  const [draftName, setDraftName] = useState(() => getSavedName() ?? "");
  const [loginError, setLoginError] = useState(null);

  if (!login) {
    return (
      <LoginScreen
        initialName={draftName}
        error={loginError}
        onSubmit={(name, token) => {
          setDraftName(name);
          setLoginError(null);
          setLogin({ name, token });
        }}
      />
    );
  }

  return (
    <ChatProvider
      login={login}
      onIdentity={(name) => {
        saveName(name);
        setDraftName(name);
      }}
      onRejected={(message, code) => {
        if (FORGET_TOKEN.has(code)) forgetToken(login.token ?? getToken());
        saveName(null);
        setLoginError(message);
        setLogin(null);
      }}
      onLogout={({ forget }) => {
        // Sair: para de entrar sozinho, mas o navegador continua lembrando da conta
        // (basta digitar o nome). Esquecer: aí só volta com o código de acesso.
        if (forget) forgetToken(getToken());
        saveName(null);
        setLoginError(null);
        setLogin(null);
      }}
    >
      <VoiceProvider>
        <AppShell />
      </VoiceProvider>
    </ChatProvider>
  );
}
