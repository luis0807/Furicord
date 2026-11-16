import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cls } from "../lib/cls.js";

const MARGIN = 12;
const GAP = 8;

// Painel flutuante preso a um botão: abre acima dele (o painel do usuário fica no pé
// da tela) e cresce para cima. Fecha com Esc ou clicando fora. Vai direto no <body>
// para não ser cortado pela gaveta lateral do celular.
export default function Popover({ anchorRef, onClose, label, className, children }) {
  const ref = useRef(null);
  const [position, setPosition] = useState(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const width = ref.current.offsetWidth;
    const left = Math.max(MARGIN, Math.min(anchor.left, window.innerWidth - width - MARGIN));
    setPosition({ left, bottom: Math.max(MARGIN, window.innerHeight - anchor.top + GAP) });
  }, [anchorRef]);

  useEffect(() => {
    const onKeyDown = (event) => event.key === "Escape" && onClose();
    // O próprio botão de abrir cuida do clique nele (abre/fecha).
    const onPointerDown = (event) => {
      if (!ref.current?.contains(event.target) && !anchorRef.current?.contains(event.target)) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={ref}
      className={cls("popover", className)}
      role="dialog"
      aria-label={label}
      style={position ?? { visibility: "hidden" }}
    >
      {children}
    </div>,
    document.body,
  );
}
