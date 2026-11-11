import { useEffect, useRef, useState } from "react";
import {
  Fullscreen,
  HeadphoneOff,
  Headphones,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  PhoneOff,
  ScreenShare,
  ScreenShareOff,
  TriangleAlert,
  Volume2,
} from "lucide-react";
import { useChat } from "../state/chat-context.js";
import { useIsSpeaking, useVoice } from "../voice/voice-context.js";
import { colorFor } from "../lib/avatar.js";
import { listNames } from "../lib/format.js";
import { cls } from "../lib/cls.js";
import { Avatar, IconButton } from "./ui.jsx";
import ChannelHeader from "./ChannelHeader.jsx";

export default function VoiceView({ channel, layout }) {
  const { state } = useChat();
  const voice = useVoice();
  const participants = state.voice.filter((entry) => entry.channelId === channel.id);
  const connected = voice.channelId === channel.id;

  return (
    <section className="voice-view">
      <ChannelHeader icon={<Volume2 />} title={channel.name} layout={layout} />
      {connected ? (
        <VoiceStage participants={participants} />
      ) : (
        <VoiceLobby channel={channel} participants={participants} />
      )}
    </section>
  );
}

function VoiceLobby({ channel, participants }) {
  const voice = useVoice();
  const joining = voice.joiningChannelId === channel.id;

  return (
    <div className="voice-lobby">
      <div className="voice-lobby-icon">
        <Volume2 size={36} />
      </div>
      <h2>{channel.name}</h2>
      <p>
        {participants.length
          ? `${listNames(participants.map((p) => p.name))} ${participants.length === 1 ? "está" : "estão"} aqui.`
          : "Ninguém por aqui ainda."}
      </p>
      {participants.length > 0 && (
        <div className="avatar-stack">
          {participants.slice(0, 8).map((p) => (
            <Avatar key={p.id} name={p.name} size={40} />
          ))}
        </div>
      )}
      <button type="button" className="button-primary voice-join" onClick={() => voice.join(channel.id)} disabled={joining}>
        {joining ? "Entrando…" : "Entrar na sala"}
      </button>
      {voice.error && !joining && (
        <p className="form-error" role="alert">
          {voice.error}
        </p>
      )}
    </div>
  );
}

function VoiceStage({ participants }) {
  const voice = useVoice();
  const isSpeaking = useIsSpeaking();
  const [focusKey, setFocusKey] = useState(null);

  // Transmissões primeiro (é o que a galera quer ver), depois as pessoas.
  const screens = [];
  const people = [];
  for (const participant of participants) {
    const isSelf = participant.id === voice.selfId;
    if (participant.sharing) {
      screens.push({
        key: `${participant.id}:tela`,
        participant,
        isSelf,
        stream: isSelf ? voice.screenStream : voice.peers[participant.id]?.screenStream,
      });
    }
    people.push({ key: participant.id, participant, isSelf });
  }

  const focused = screens.find((screen) => screen.key === focusKey) ?? null;

  const renderPerson = (tile) => (
    <PersonTile
      key={tile.key}
      participant={tile.participant}
      isSelf={tile.isSelf}
      speaking={isSpeaking(tile.participant.id)}
      connectionState={tile.isSelf ? "connected" : voice.peers[tile.participant.id]?.connectionState}
    />
  );
  const renderScreen = (tile) => (
    <ScreenTile
      key={tile.key}
      tile={tile}
      focused={tile === focused}
      onToggleFocus={() => setFocusKey(tile === focused ? null : tile.key)}
    />
  );

  const alert = voice.error ?? voice.micError;

  return (
    <div className="voice-stage">
      {alert && (
        <div className="voice-alert" role="status">
          <TriangleAlert size={16} /> {alert}
        </div>
      )}

      {focused ? (
        <div className="voice-focus">
          {renderScreen(focused)}
          <div className="voice-strip">
            {screens.filter((tile) => tile !== focused).map(renderScreen)}
            {people.map(renderPerson)}
          </div>
        </div>
      ) : (
        <div className="voice-grid">
          {screens.map(renderScreen)}
          {people.map(renderPerson)}
        </div>
      )}

      <VoiceControls />
    </div>
  );
}

const CONNECTION_LABELS = {
  new: "Conectando…",
  connecting: "Conectando…",
  disconnected: "Conexão instável…",
  failed: "Não conectou — a rede pode precisar de um servidor TURN",
};

function PersonTile({ participant, isSelf, speaking, connectionState }) {
  const status = isSelf || connectionState === "connected" ? null : (CONNECTION_LABELS[connectionState] ?? "Conectando…");

  return (
    <div className={cls("tile", "person-tile", speaking && "is-speaking")} style={{ "--tile-color": colorFor(participant.name) }}>
      <Avatar name={participant.name} size={72} />
      {status && <div className="tile-status">{status}</div>}
      <div className="tile-label">
        {participant.deafened ? <HeadphoneOff size={14} /> : participant.muted && <MicOff size={14} />}
        <span>
          {participant.name}
          {isSelf && " (você)"}
        </span>
      </div>
    </div>
  );
}

function ScreenTile({ tile, focused, onToggleFocus }) {
  const ref = useRef(null);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else ref.current?.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className={cls("tile", "screen-tile", focused && "is-focused")} ref={ref} onDoubleClick={toggleFullscreen}>
      {tile.stream ? <StreamVideo stream={tile.stream} /> : <div className="tile-placeholder">Carregando transmissão…</div>}
      <span className="live-badge">AO VIVO</span>
      <div className="tile-label">
        <ScreenShare size={14} />
        <span>{tile.isSelf ? "Sua tela" : `Tela de ${tile.participant.name}`}</span>
      </div>
      <div className="tile-actions">
        <IconButton label={focused ? "Voltar para a grade" : "Destacar"} onClick={onToggleFocus}>
          {focused ? <Minimize2 /> : <Maximize2 />}
        </IconButton>
        <IconButton label="Tela cheia" onClick={toggleFullscreen}>
          <Fullscreen />
        </IconButton>
      </div>
    </div>
  );
}

// O áudio das transmissões toca pelo VoiceProvider; o vídeo aqui fica sempre mudo.
function StreamVideo({ stream }) {
  const ref = useRef(null);
  useEffect(() => {
    const video = ref.current;
    video.srcObject = stream;
    video.play().catch(() => {});
  }, [stream]);
  return <video ref={ref} autoPlay playsInline muted />;
}

function VoiceControls() {
  const voice = useVoice();
  const micOff = voice.muted || voice.deafened;

  return (
    <div className="voice-controls">
      <button
        type="button"
        className={cls("control-button", micOff && "is-off")}
        onClick={() => voice.setMuted(!micOff)}
        aria-label={micOff ? "Ligar microfone" : "Silenciar microfone"}
        title={micOff ? "Ligar microfone" : "Silenciar microfone"}
      >
        {micOff ? <MicOff /> : <Mic />}
      </button>
      <button
        type="button"
        className={cls("control-button", voice.deafened && "is-off")}
        onClick={() => voice.setDeafened(!voice.deafened)}
        aria-label={voice.deafened ? "Ligar áudio" : "Desligar áudio"}
        title={voice.deafened ? "Ligar áudio" : "Desligar áudio"}
      >
        {voice.deafened ? <HeadphoneOff /> : <Headphones />}
      </button>
      {voice.supportsScreenShare && (
        <button
          type="button"
          className={cls("control-button", voice.screenStream && "is-on")}
          onClick={() => (voice.screenStream ? voice.stopScreenShare() : voice.startScreenShare())}
          aria-label={voice.screenStream ? "Parar transmissão" : "Transmitir tela"}
          title={voice.screenStream ? "Parar transmissão" : "Transmitir tela"}
        >
          {voice.screenStream ? <ScreenShareOff /> : <ScreenShare />}
        </button>
      )}
      <button
        type="button"
        className="control-button is-leave"
        onClick={voice.leave}
        aria-label="Sair da sala"
        title="Sair da sala"
      >
        <PhoneOff />
      </button>
    </div>
  );
}
