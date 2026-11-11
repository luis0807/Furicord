import { useEffect, useState } from "react";
import { Copy, KeyRound, LoaderCircle } from "lucide-react";
import { useChat } from "../state/chat-context.js";
import { cls } from "../lib/cls.js";
import { getToken } from "../lib/identity.js";
import { BrandMark } from "./ui.jsx";
import Sidebar from "./Sidebar.jsx";
import ChannelView from "./ChannelView.jsx";
import VoiceView from "./VoiceView.jsx";
import MemberList from "./MemberList.jsx";
import { OverlayProvider } from "./Overlays.jsx";

const WIDE_QUERY = "(min-width: 1100px)";

export default function AppShell() {
  const { state } = useChat();
  const [navOpen, setNavOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(() => window.matchMedia(WIDE_QUERY).matches);
  const [codeSaved, setCodeSaved] = useState(false);

  if (!state.self) return <ConnectingScreen />;

  const { view, channels } = state;
  const textChannel = view?.type === "text" ? channels.text.find((c) => c.id === view.id) : null;
  const voiceChannel = view?.type === "voice" ? channels.voice.find((c) => c.id === view.id) : null;

  const layout = {
    onOpenNav: () => setNavOpen(true),
    onToggleMembers: () => setMembersOpen((open) => !open),
    membersOpen,
  };

  return (
    <OverlayProvider>
      <div className={cls("app", navOpen && "nav-open", membersOpen && "members-open")}>
        <Sidebar onNavigate={() => setNavOpen(false)} />

        <main className="main">
          {state.status === "offline" && (
            <div className="connection-banner" role="status">
              <LoaderCircle size={14} className="spin" /> Conexão perdida. Reconectando…
            </div>
          )}
          {textChannel && <ChannelView key={textChannel.id} channel={textChannel} layout={layout} />}
          {voiceChannel && <VoiceView key={voiceChannel.id} channel={voiceChannel} layout={layout} />}
        </main>

        {membersOpen && <MemberList />}

        {/* Só aparece no celular, atrás das gavetas de canais/membros. */}
        <div
          className="scrim"
          onClick={() => {
            setNavOpen(false);
            if (!window.matchMedia(WIDE_QUERY).matches) setMembersOpen(false);
          }}
        />
      </div>
      {state.self.isNew && !codeSaved && <AccessCodeDialog name={state.self.name} onClose={() => setCodeSaved(true)} />}
    </OverlayProvider>
  );
}

// Primeiro login: o código de acesso é o único jeito de voltar para a conta em outro
// aparelho (ou se este navegador for limpo). Só fecha pelo botão.
function AccessCodeDialog({ name, onClose }) {
  const code = getToken();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // sem acesso à área de transferência: o código está visível para copiar à mão
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="access-dialog" role="alertdialog" aria-modal="true" aria-labelledby="access-title" aria-describedby="access-text">
        <span className="access-dialog-icon">
          <KeyRound size={26} />
        </span>
        <h2 id="access-title">Salve seu código de acesso</h2>
        <p id="access-text">
          A conta <strong>{name}</strong> não tem senha. Para entrar de novo — em outro aparelho ou se este navegador for
          limpo — você vai precisar deste código:
        </p>
        <code className="access-code">{code}</code>
        <button type="button" className="button-secondary" onClick={copy} autoFocus>
          <Copy size={16} /> {copied ? "Copiado!" : "Copiar código"}
        </button>
        <p className="access-dialog-note">
          Guarde num lugar seguro: anote, salve num gerenciador de senhas ou mande para você mesmo. Quem tiver o código
          entra como você. Ele também fica em Configurações → Conta.
        </p>
        <button type="button" className="button-primary" onClick={onClose}>
          Já salvei meu código
        </button>
      </div>
    </div>
  );
}

function ConnectingScreen() {
  const { cancelLogin } = useChat();
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 4000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="splash">
      <BrandMark size={56} />
      <p className="splash-title">
        <LoaderCircle size={18} className="spin" /> Conectando ao Furicord…
      </p>
      {slow && (
        <p className="splash-hint">
          O servidor gratuito dorme quando ninguém usa. Acordar pode levar até um minuto.
        </p>
      )}
      {/* Só volta para a tela de entrada: não pode apagar a conta deste navegador. */}
      <button type="button" className="link-button" onClick={cancelLogin}>
        Voltar
      </button>
    </main>
  );
}
