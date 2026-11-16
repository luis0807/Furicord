import { createContext, useContext, useSyncExternalStore } from "react";
import { SELF } from "./VoiceEngine.js";
import { getAudioSettings, subscribeAudioSettings } from "./audioSettings.js";

export const VoiceContext = createContext(null);

export function useVoice() {
  const value = useContext(VoiceContext);
  if (!value) throw new Error("useVoice precisa estar dentro de <VoiceProvider>");
  return value;
}

// Só funciona para quem está na mesma sala que você (é de lá que vem o áudio analisado).
export function useIsSpeaking() {
  const voice = useVoice();
  return (id) => (id === voice.selfId ? voice.speaking.has(SELF) : voice.speaking.has(id));
}

// Dispositivos, volumes e quem você silenciou (ver audioSettings.js).
export function useAudioSettings() {
  return useSyncExternalStore(subscribeAudioSettings, getAudioSettings);
}
