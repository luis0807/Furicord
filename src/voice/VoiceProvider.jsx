import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { fetchIceServers } from "../lib/api.js";
import { useChat } from "../state/chat-context.js";
import { VoiceContext } from "./voice-context.js";
import { VoiceEngine } from "./VoiceEngine.js";

const IDLE_SNAPSHOT = {
  channelId: null,
  joiningChannelId: null,
  reconnecting: false,
  muted: false,
  deafened: false,
  hasMic: false,
  micError: null,
  screenStream: null,
  error: null,
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
    const instance = new VoiceEngine(socket, fetchIceServers);
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

  const value = useMemo(
    () => ({
      ...snapshot,
      selfId: state.self?.id ?? null,
      supportsScreenShare,
      join: (channelId) => engine?.join(channelId),
      leave: () => engine?.leave(),
      setMuted: (muted) => engine?.setMuted(muted),
      setDeafened: (deafened) => engine?.setDeafened(deafened),
      startScreenShare: () => engine?.startScreenShare(),
      stopScreenShare: () => engine?.stopScreenShare(),
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
