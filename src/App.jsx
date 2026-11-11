import { useState } from "react";
import { getSavedName, saveName } from "./lib/identity.js";
import { ChatProvider } from "./state/ChatProvider.jsx";
import { VoiceProvider } from "./voice/VoiceProvider.jsx";
import LoginScreen from "./components/LoginScreen.jsx";
import AppShell from "./components/AppShell.jsx";

export default function App() {
  const [name, setName] = useState(getSavedName);
  const [draftName, setDraftName] = useState(() => getSavedName() ?? "");
  const [loginError, setLoginError] = useState(null);

  if (!name) {
    return (
      <LoginScreen
        initialName={draftName}
        error={loginError}
        onSubmit={(chosen) => {
          saveName(chosen);
          setDraftName(chosen);
          setLoginError(null);
          setName(chosen);
        }}
      />
    );
  }

  return (
    <ChatProvider
      name={name}
      onRejected={(message) => {
        saveName(null);
        setLoginError(message);
        setName(null);
      }}
      onLogout={() => {
        saveName(null);
        setLoginError(null);
        setName(null);
      }}
    >
      <VoiceProvider>
        <AppShell />
      </VoiceProvider>
    </ChatProvider>
  );
}
