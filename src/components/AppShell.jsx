import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useChat } from "../state/chat-context.js";
import { cls } from "../lib/cls.js";
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
    </OverlayProvider>
  );
}

function ConnectingScreen() {
  const { logout } = useChat();
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
      <button type="button" className="link-button" onClick={logout}>
        Trocar de nome
      </button>
    </main>
  );
}
