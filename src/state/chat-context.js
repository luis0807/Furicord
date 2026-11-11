import { createContext, useContext } from "react";

export const ChatContext = createContext(null);

// Nome -> perfil atual dos membros (online e offline). Separado do ChatContext para que avatares e
// nomes só redesenhem quando a lista de presença muda, não a cada mensagem.
export const ProfilesContext = createContext(new Map());

export function useChat() {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat precisa estar dentro de <ChatProvider>");
  return value;
}

// Perfil atual de um membro (ou undefined se a pessoa não está na lista).
export function useProfile(name) {
  return useContext(ProfilesContext).get(name);
}
