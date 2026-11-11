import { createContext, useContext } from "react";

// Abre o cartão de perfil de alguém ou a janela de configurações, de qualquer lugar.
export const OverlayContext = createContext(null);

export function useOverlays() {
  const value = useContext(OverlayContext);
  if (!value) throw new Error("useOverlays precisa estar dentro de <OverlayProvider>");
  return value;
}
