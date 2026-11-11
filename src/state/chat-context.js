import { createContext, useContext } from "react";

export const ChatContext = createContext(null);

export function useChat() {
  const value = useContext(ChatContext);
  if (!value) throw new Error("useChat precisa estar dentro de <ChatProvider>");
  return value;
}
