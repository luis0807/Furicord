import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { playSound, setSoundsSilenced } from "../lib/sounds.js";
import { loadStreamQuality } from "../lib/streamQuality.js";
import { useChat } from "../state/chat-context.js";
import { VoiceContext } from "./voice-context.js";
import { VoiceEngine } from "./VoiceEngine.js";

const IDLE_SNAPSHOT = {
  channelId: null,
  joiningChannelId: null,
  waitingMic: false,
  waitingSince: {},
  reconnecting: false,
  muted: false,
  deafened: false,
  hasMic: false,
  micError: null,
  screenStream: null,
  streamQuality: loadStreamQuality(),
  error: null,
  turnLimited: false,
  speaking: new Set(),
  peers: {},
};
const noopSubscribe = () => () => {};
const getIdleSnapshot = () => IDLE_SNAPSHOT;

const supportsScreenShare =
  typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getDisplayMedia);

export function VoiceProvider({ children }) {
  const { socket, state } = useChat();
  const [engine, setEngine] = useState(null);

  useEffect(() => {
    if (!socket) return;
    const instance = new VoiceEngine(socket);
    setEngine(instance);
    if (import.meta.env.DEV) window.__furicordVoice = instance; // facilita depurar pelo console
    return () => {
      instance.destroy();
      setEngine(null);
    };
  }, [socket]);

  useEffect(() => {
    engine?.syncState(state.voice);
  }, [engine, state.voice]);

  const snapshot = useSyncExternalStore(
    engine ? engine.subscribe : noopSubscribe,
    engine ? engine.getSnapshot : getIdleSnapshot,
  );

  useVoiceSounds(snapshot, state.voice, state.self?.id);

  const value = useMemo(
    () => ({
      ...snapshot,
      selfId: state.self?.id ?? null,
      supportsScreenShare,
      join: (channelId) => engine?.join(channelId),
      leave: () => engine?.leave(),
      // `always`: o retorno do próprio botão toca mesmo ensurdecido.
      setMuted: (muted) => {
        playSound(muted ? "mute" : "unmute", { always: true });
        engine?.setMuted(muted);
      },
      setDeafened: (deafened) => {
        playSound(deafened ? "deafen" : "undeafen", { always: true });
        engine?.setDeafened(deafened);
      },
      startScreenShare: () => engine?.startScreenShare(),
      stopScreenShare: () => engine?.stopScreenShare(),
      setStreamQuality: (quality) => engine?.setStreamQuality(quality),
    }),
    [snapshot, engine, state.self?.id],
  );

  return (
    <VoiceContext.Provider value={value}>
      {children}
      {/* Áudio dos outros participantes: fica fora da tela e continua tocando
          mesmo quando você está olhando um canal de texto. */}
      <div hidden>
        {Object.values(snapshot.peers).map((peer) => (
          <PeerAudio key={peer.id} peer={peer} muted={snapshot.deafened} />
        ))}
      </div>
    </VoiceContext.Provider>
  );
}

// Sons da sala: compara quem está na sua sala agora com a atualização anterior.
function useVoiceSounds(snapshot, entries, selfId) {
  const { channelId, joiningChannelId, reconnecting, deafened } = snapshot;
  const sharing = Boolean(snapshot.screenStream);
  const previous = useRef(null);

  useEffect(() => setSoundsSilenced(deafened), [deafened]);

  useEffect(() => {
    // Os outros que estão na mesma sala que você -> se estão transmitindo.
    const room = new Map();
    if (channelId) {
      for (const entry of entries) {
        if (entry.channelId === channelId && entry.id !== selfId) room.set(entry.id, entry.sharing);
      }
    }
    const before = previous.current;
    previous.current = { channelId, room, sharing };
    if (!before) return;

    if (channelId !== before.channelId) {
      if (channelId) playSound("connect");
      // Trocar de sala (já entrando em outra) ou queda de conexão não contam como sair.
      else if (!joiningChannelId && !reconnecting) playSound("disconnect");
      return;
    }
    if (!channelId) return;

    let joined = false;
    let left = false;
    let streamStarted = sharing && !before.sharing;
    let streamStopped = !sharing && before.sharing;
    for (const [id, isSharing] of room) {
      if (!before.room.has(id)) joined = true;
      else if (isSharing && !before.room.get(id)) streamStarted = true;
      else if (!isSharing && before.room.get(id)) streamStopped = true;
    }
    for (const id of before.room.keys()) {
      if (!room.has(id)) left = true;
    }

    if (joined) playSound("userJoin");
    else if (left) playSound("userLeave");
    if (streamStarted) playSound("streamStart");
    else if (streamStopped) playSound("streamStop");
  }, [channelId, joiningChannelId, reconnecting, sharing, entries, selfId]);
}

function PeerAudio({ peer, muted }) {
  return (
    <>
      <AudioSink stream={peer.micStream} muted={muted} />
      <AudioSink stream={peer.screenAudioStream} muted={muted} />
    </>
  );
}

function AudioSink({ stream, muted }) {
  const ref = useRef(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    element.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted]);

  return <audio ref={ref} autoPlay />;
}
