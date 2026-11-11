import { useState } from "react";
import { clearToken, getSavedName, saveName, setToken } from "./lib/identity.js";
import { ChatProvider } from "./state/ChatProvider.jsx";
import { VoiceProvider } from "./voice/VoiceProvider.jsx";
import LoginScreen from "./components/LoginScreen.jsx";
import AppShell from "./components/AppShell.jsx";

// Recusas em que o código deste navegador não serve mais: gera outro na próxima vez.
const FORGET_TOKEN = new Set(["UNKNOWN_CODE", "INVALID_TOKEN", "DELETED"]);

export default function App() {
  // Já entrou antes neste navegador? Então conecta direto: o servidor reconhece o
  // código de acesso e devolve o nome e o perfil da conta.
  const [login, setLogin] = useState(() => {
    const name = getSavedName();
    return name ? { name } : null;
  });
  const [draftName, setDraftName] = useState(() => getSavedName() ?? "");
  const [loginError, setLoginError] = useState(null);

  if (!login) {
    return (
      <LoginScreen
        initialName={draftName}
        error={loginError}
        onSubmitName={(chosen) => {
          setDraftName(chosen);
          setLoginError(null);
          setLogin({ name: chosen });
        }}
        onSubmitCode={(code) => {
          setToken(code);
          setLoginError(null);
          setLogin({ name: null });
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
        if (FORGET_TOKEN.has(code)) clearToken();
        saveName(null);
        setLoginError(message);
        setLogin(null);
      }}
      onLogout={() => {
        // Sair = este navegador esquece a conta. Para voltar, só com o código de acesso.
        clearToken();
        saveName(null);
        setDraftName("");
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
