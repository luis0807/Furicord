import { Flame } from "lucide-react";
import { colorFor, initialsFor } from "../lib/avatar.js";
import { cls } from "../lib/cls.js";

export function Avatar({ name, size = 32, speaking = false, online = false, className }) {
  return (
    <span
      className={cls("avatar", speaking && "is-speaking", online && "is-online", className)}
      style={{ "--avatar-color": colorFor(name), "--avatar-size": `${size}px` }}
      aria-hidden="true"
    >
      {initialsFor(name)}
    </span>
  );
}

export function IconButton({ label, onClick, active, danger, disabled, className, children }) {
  return (
    <button
      type="button"
      className={cls("icon-button", active && "is-active", danger && "is-danger", className)}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : Boolean(active)}
    >
      {children}
    </button>
  );
}

export function BrandMark({ size = 28 }) {
  return (
    <span className="brand-mark" style={{ "--brand-size": `${size}px` }} aria-hidden="true">
      <Flame size={Math.round(size * 0.6)} strokeWidth={2.4} />
    </span>
  );
}
