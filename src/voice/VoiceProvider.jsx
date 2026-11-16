import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { playSound, setSoundsOutput, setSoundsSilenced } from "../lib/sounds.js";
import { loadStreamQuality } from "../lib/streamQuality.js";
import { useChat } from "../state/chat-context.js";
import { VoiceContext, useAudioSettings } from "./voice-context.js";
import { VoiceEngine } from "./VoiceEngine.js";
import { updateAudioSettings, updateUserAudio, voiceVolume } from "./audioSettings.js";
import { applyElementOutput, boostStream, canBoost, setPlaybackOutput } from "./playback.js";

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
  screenWarning: null,
  screenViewers: 0,
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

  const audio = useAudioSettings();
  useEffect(() => {
    setPlaybackOutput(audio.outputDeviceId);
    setSoundsOutput(audio.outputDeviceId);
  }, [audio.outputDeviceId]);

  // As preferências por pessoa são guardadas pelo nome (o id muda a cada conexão).
  const names = useMemo(() => new Map(state.voice.map((entry) => [entry.id, entry.name])), [state.voice]);

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
      dropScreenAudio: () => engine?.dropScreenAudio(),
      watchScreen: (id, watch) => engine?.watchScreen(id, watch),
      setStreamQuality: (quality) => engine?.setStreamQuality(quality),
      // Microfone: a engine reabre/reenvia na hora se estiver numa sala.
      setInputDevice: (deviceId) =>
        engine ? engine.setInputDevice(deviceId) : updateAudioSettings({ inputDeviceId: deviceId }),
      setInputVolume: (volume) =>
        engine ? engine.setInputVolume(volume) : updateAudioSettings({ inputVolume: volume }),
      setOutputDevice: (deviceId) => updateAudioSettings({ outputDeviceId: deviceId }),
      setOutputVolume: (volume) => updateAudioSettings({ outputVolume: volume }),
      // Só para você: os outros continuam ouvindo essa pessoa normalmente.
      setUserVolume: (name, volume) => updateUserAudio(name, { volume }),
      setUserMuted: (name, muted) => updateUserAudio(name, { muted }),
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
          <PeerAudio
            key={peer.id}
            peer={peer}
            voiceVolume={snapshot.deafened ? 0 : voiceVolume(audio, names.get(peer.id))}
            screenVolume={snapshot.deafened ? 0 : audio.outputVolume}
            sinkId={audio.outputDeviceId}
          />
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

// O volume por pessoa vale para a voz; o áudio da transmissão segue o volume de saída.
function PeerAudio({ peer, voiceVolume, screenVolume, sinkId }) {
  return (
    <>
      <AudioSink stream={peer.micStream} volume={voiceVolume} sinkId={sinkId} />
      <AudioSink stream={peer.screenAudioStream} volume={screenVolume} sinkId={sinkId} />
    </>
  );
}

// `volume`: 0 = mudo, 1 = normal, até 4 (200% da pessoa x 200% da saída).
function AudioSink({ stream, volume, sinkId }) {
  const ref = useRef(null);
  const boostRef = useRef(null);
  const boosted = volume > 1 && canBoost(sinkId);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    element.play().catch(() => {});
  }, [stream]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Reforçado, quem toca é o ganho (ver playback.js); o <audio> segue tocando mudo.
    element.muted = boosted || volume === 0;
    element.volume = Math.min(1, volume);
  }, [boosted, volume]);

  useEffect(() => {
    if (ref.current) applyElementOutput(ref.current, sinkId);
  }, [sinkId]);

  useEffect(() => {
    if (!boosted || !stream) return;
    const boost = boostStream(stream);
    boostRef.current = boost;
    return () => {
      boost.stop();
      boostRef.current = null;
    };
  }, [boosted, stream]);

  useEffect(() => {
    boostRef.current?.setGain(volume);
  }, [boosted, stream, volume]);

  return <audio ref={ref} autoPlay />;
}
