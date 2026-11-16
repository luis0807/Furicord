import { useSyncExternalStore } from "react";
import {
  Bell,
  BellOff,
  Hash,
  HeadphoneOff,
  Headphones,
  LoaderCircle,
  Mic,
  MicOff,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  Settings,
  Signal,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useChat } from "../state/chat-context.js";
import { useAudioSettings, useIsSpeaking, useVoice } from "../voice/voice-context.js";
import { SELF } from "../voice/VoiceEngine.js";
import { userAudio } from "../voice/audioSettings.js";
import { cls } from "../lib/cls.js";
import { getSoundsEnabled, playSound, setSoundsEnabled, subscribeSounds } from "../lib/sounds.js";
import { useOverlays } from "./overlay-context.js";
import { Avatar, IconButton, Logo, UserName } from "./ui.jsx";
import { AudioMenuButton } from "./AudioControls.jsx";

export default function Sidebar({ onNavigate }) {
  const { state, setView } = useChat();
  const voice = useVoice();
  const audio = useAudioSettings();
  const isSpeaking = useIsSpeaking();
  const { openProfile } = useOverlays();
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
        <Logo height={24} />
        <SoundToggle />
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
                    <li key={member.id}>
                      <button
                        type="button"
                        className="voice-member"
                        onClick={(event) => openProfile(member.name, event)}
                        // Botão direito também abre (é lá que ficam volume e silenciar).
                        onContextMenu={(event) => {
                          event.preventDefault();
                          openProfile(member.name, event);
                        }}
                      >
                        <Avatar name={member.name} size={22} speaking={isSpeaking(member.id)} />
                        <UserName name={member.name} className="voice-member-name" />
                        <span className="voice-member-icons">
                          {member.sharing && <span className="live-pill">AO VIVO</span>}
                          {member.id !== voice.selfId && userAudio(audio, member.name).muted && (
                            <VolumeX size={14} className="is-locally-muted" aria-label="Silenciado para você" />
                          )}
                          {member.deafened ? (
                            <HeadphoneOff size={14} aria-label="Sem áudio" />
                          ) : (
                            member.muted && <MicOff size={14} aria-label="Microfone desligado" />
                          )}
                        </span>
                      </button>
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

function SoundToggle() {
  const enabled = useSyncExternalStore(subscribeSounds, getSoundsEnabled);

  function toggle() {
    setSoundsEnabled(!enabled);
    // Ao ligar, toca um exemplo para a pessoa saber que funcionou.
    if (!enabled) playSound("message", { always: true });
  }

  return (
    <IconButton label={enabled ? "Desativar sons" : "Ativar sons"} className="sound-toggle" onClick={toggle}>
      {enabled ? <Bell /> : <BellOff />}
    </IconButton>
  );
}

function VoicePanel() {
  const { state } = useChat();
  const voice = useVoice();
  const channelId = voice.channelId ?? voice.joiningChannelId;
  const channel = state.channels.voice.find((c) => c.id === channelId);

  let status = "Voz conectada";
  if (voice.reconnecting) status = "Reconectando…";
  else if (voice.waitingMic) status = "Permita o microfone…";
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
  const { state } = useChat();
  const voice = useVoice();
  const { openProfile, openSettings } = useOverlays();
  const micOff = voice.muted || voice.deafened;
  const online = state.status === "online";

  return (
    <div className="user-panel">
      <button
        type="button"
        className="user-panel-me"
        onClick={(event) => openProfile(state.self.name, event)}
        title="Ver meu perfil"
      >
        <Avatar name={state.self.name} size={32} speaking={voice.speaking.has(SELF)} online={online} />
        <span className="user-panel-info">
          <UserName name={state.self.name} className="user-panel-name" />
          <span className="user-panel-status">{online ? "Online" : "Reconectando…"}</span>
        </span>
      </button>
      <div className="audio-button-group">
        <IconButton
          label={micOff ? "Ligar microfone" : "Silenciar microfone"}
          danger={micOff}
          onClick={() => voice.setMuted(!micOff)}
        >
          {micOff ? <MicOff /> : <Mic />}
        </IconButton>
        <AudioMenuButton kind="input" />
      </div>
      <div className="audio-button-group">
        <IconButton
          label={voice.deafened ? "Ligar áudio" : "Desligar áudio"}
          danger={voice.deafened}
          onClick={() => voice.setDeafened(!voice.deafened)}
        >
          {voice.deafened ? <HeadphoneOff /> : <Headphones />}
        </IconButton>
        <AudioMenuButton kind="output" />
      </div>
      <IconButton label="Configurações" onClick={() => openSettings()}>
        <Settings />
      </IconButton>
    </div>
  );
}
