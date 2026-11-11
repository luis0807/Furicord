import { createContext, useContext } from "react";
import { SELF } from "./VoiceEngine.js";

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
