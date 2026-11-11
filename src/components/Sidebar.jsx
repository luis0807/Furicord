import {
  Hash,
  HeadphoneOff,
  Headphones,
  LoaderCircle,
  LogOut,
  Mic,
  MicOff,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Signal,
  Volume2,
} from "lucide-react";
import { useChat } from "../state/chat-context.js";
import { useIsSpeaking, useVoice } from "../voice/voice-context.js";
import { SELF } from "../voice/VoiceEngine.js";
import { cls } from "../lib/cls.js";
import { Avatar, BrandMark, IconButton } from "./ui.jsx";

export default function Sidebar({ onNavigate }) {
  const { state, setView } = useChat();
  const voice = useVoice();
  const isSpeaking = useIsSpeaking();
  const { channels, view, unread } = state;

  function openText(id) {
    setView({ type: "text", id });
    onNavigate();
  }

  function openVoice(id) {
    setView({ type: "voice", id });
    voice.join(id);
    onNavigate();
  }

  const showVoicePanel = voice.channelId || voice.joiningChannelId || voice.reconnecting;

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <BrandMark />
        <span>Furicord</span>
      </header>

      <nav className="channel-list" aria-label="Canais">
        <h2 className="section-title">Canais de texto</h2>
        {channels.text.map((channel) => {
          const active = view?.type === "text" && view.id === channel.id;
          return (
            <button
              key={channel.id}
              type="button"
              className={cls("channel", active && "is-active", unread[channel.id] && "is-unread")}
              onClick={() => openText(channel.id)}
              aria-current={active ? "page" : undefined}
            >
              <Hash size={18} />
              <span className="channel-name">{channel.name}</span>
            </button>
          );
        })}

        <h2 className="section-title">Canais de voz</h2>
        {channels.voice.map((channel) => {
          const members = state.voice.filter((entry) => entry.channelId === channel.id);
          const active = view?.type === "voice" && view.id === channel.id;
          return (
            <div key={channel.id}>
              <button
                type="button"
                className={cls("channel", active && "is-active", voice.channelId === channel.id && "is-connected")}
                onClick={() => openVoice(channel.id)}
                aria-current={active ? "page" : undefined}
              >
                <Volume2 size={18} />
                <span className="channel-name">{channel.name}</span>
                {voice.joiningChannelId === channel.id && <LoaderCircle size={14} className="spin" />}
              </button>
              {members.length > 0 && (
                <ul className="voice-members">
                  {members.map((member) => (
                    <li key={member.id} className="voice-member">
                      <Avatar name={member.name} size={22} speaking={isSpeaking(member.id)} />
                      <span className="voice-member-name">{member.name}</span>
                      <span className="voice-member-icons">
                        {member.sharing && <span className="live-pill">AO VIVO</span>}
                        {member.deafened ? (
                          <HeadphoneOff size={14} aria-label="Sem áudio" />
                        ) : (
                          member.muted && <MicOff size={14} aria-label="Microfone desligado" />
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>

      {showVoicePanel && <VoicePanel />}
      <UserPanel />
    </aside>
  );
}

function VoicePanel() {
  const { state } = useChat();
  const voice = useVoice();
  const channelId = voice.channelId ?? voice.joiningChannelId;
  const channel = state.channels.voice.find((c) => c.id === channelId);

  let status = "Voz conectada";
  if (voice.reconnecting) status = "Reconectando…";
  else if (!voice.channelId) status = "Conectando…";
  const ok = Boolean(voice.channelId) && !voice.reconnecting;

  return (
    <div className="voice-panel">
      <div className="voice-panel-info">
        <span className={cls("voice-status", ok && "is-ok")}>
          <Signal size={14} /> {status}
        </span>
        <span className="voice-panel-channel">{channel?.name}</span>
      </div>
      {voice.supportsScreenShare && voice.channelId && (
        <IconButton
          label={voice.screenStream ? "Parar transmissão" : "Transmitir tela"}
          active={Boolean(voice.screenStream)}
          onClick={() => (voice.screenStream ? voice.stopScreenShare() : voice.startScreenShare())}
        >
          {voice.screenStream ? <ScreenShareOff /> : <ScreenShare />}
        </IconButton>
      )}
      <IconButton label="Desconectar da voz" danger onClick={voice.leave}>
        <PhoneOff />
      </IconButton>
    </div>
  );
}

function UserPanel() {
  const { state, logout } = useChat();
  const voice = useVoice();
  const micOff = voice.muted || voice.deafened;
  const online = state.status === "online";

  return (
    <div className="user-panel">
      <Avatar name={state.self.name} size={32} speaking={voice.speaking.has(SELF)} online={online} />
      <div className="user-panel-info">
        <span className="user-panel-name">{state.self.name}</span>
        <span className="user-panel-status">{online ? "Online" : "Reconectando…"}</span>
      </div>
      <IconButton
        label={micOff ? "Ligar microfone" : "Silenciar microfone"}
        danger={micOff}
        onClick={() => voice.setMuted(!micOff)}
      >
        {micOff ? <MicOff /> : <Mic />}
      </IconButton>
      <IconButton
        label={voice.deafened ? "Ligar áudio" : "Desligar áudio"}
        danger={voice.deafened}
        onClick={() => voice.setDeafened(!voice.deafened)}
      >
        {voice.deafened ? <HeadphoneOff /> : <Headphones />}
      </IconButton>
      <IconButton label="Sair (trocar de nome)" onClick={logout}>
        <LogOut />
      </IconButton>
    </div>
  );
}
