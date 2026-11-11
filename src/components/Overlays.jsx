import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { useChat, useProfile } from "../state/chat-context.js";
import { OverlayContext } from "./overlay-context.js";
import ProfileCard from "./ProfileCard.jsx";
import SettingsModal from "./SettingsModal.jsx";

export function OverlayProvider({ children }) {
  const [card, setCard] = useState(null); // { name, fallback, anchor }
  const [settingsTab, setSettingsTab] = useState(null);

  const value = useMemo(
    () => ({
      // `fallback`: perfil gravado na mensagem, para quem já saiu.
      openProfile(name, event, fallback = null) {
        const rect = event.currentTarget.getBoundingClientRect();
        setCard({ name, fallback, anchor: { top: rect.top, left: rect.left, right: rect.right } });
      },
      openSettings(tab = "perfil") {
        setCard(null);
        setSettingsTab(tab);
      },
    }),
    [],
  );

  return (
    <OverlayContext.Provider value={value}>
      {children}
      {card && (
        <ProfilePopover
          {...card}
          onClose={() => setCard(null)}
          onEdit={() => value.openSettings("perfil")}
        />
      )}
      {settingsTab && <SettingsModal initialTab={settingsTab} onClose={() => setSettingsTab(null)} />}
    </OverlayContext.Provider>
  );
}

const MARGIN = 12;

function ProfilePopover({ name, fallback, anchor, onClose, onEdit }) {
  const { state } = useChat();
  const live = useProfile(name);
  const ref = useRef(null);
  const [position, setPosition] = useState(null);
  const isSelf = name === state.self?.name;
  const profile = live !== undefined ? live : fallback;

  // Ao lado de quem foi clicado; se não couber, do outro lado; no celular, centralizado.
  useLayoutEffect(() => {
    const { width, height } = ref.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    let left = anchor.right + 10;
    if (left + width > viewportWidth - MARGIN) left = anchor.left - width - 10;
    if (left < MARGIN) left = Math.max(MARGIN, (viewportWidth - width) / 2);
    const top = Math.max(MARGIN, Math.min(anchor.top, viewportHeight - height - MARGIN));
    setPosition({ left, top });
  }, [anchor]);

  useEffect(() => {
    const onKeyDown = (event) => event.key === "Escape" && onClose();
    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target)) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="profile-popover"
      role="dialog"
      aria-label={`Perfil de ${name}`}
      style={position ?? { visibility: "hidden" }}
    >
      <ProfileCard
        name={name}
        profile={profile}
        online={live !== undefined}
        footer={
          isSelf && (
            <button type="button" className="button-secondary profile-edit" onClick={onEdit}>
              <Pencil size={16} /> Editar perfil
            </button>
          )
        }
      />
    </div>
  );
}
