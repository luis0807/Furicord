import { useState } from "react";
import { Flame } from "lucide-react";
import { colorFor, initialsFor } from "../lib/avatar.js";
import { cls } from "../lib/cls.js";
import { uploadUrl } from "../lib/config.js";
import { decorationOf, nameStyleOf } from "../lib/profile.js";
import { useProfile } from "../state/chat-context.js";

// `profile` omitido = usa o perfil atual da pessoa (se estiver online).
// `profile={null}` = força o avatar simples; um objeto = usa esse (prévia, histórico).
export function Avatar({ name, profile, size = 32, speaking = false, online = false, className }) {
  const live = useProfile(name);
  const resolved = profile === undefined ? live : profile;
  const [brokenId, setBrokenId] = useState(null);
  const imageId = resolved?.avatarId && resolved.avatarId !== brokenId ? resolved.avatarId : null;
  const decoration = decorationOf(resolved);

  return (
    <span
      className={cls("avatar", imageId && "has-image", speaking && "is-speaking", online && "is-online", className)}
      style={{ "--avatar-color": colorFor(name), "--avatar-size": `${size}px` }}
      aria-hidden="true"
    >
      {imageId ? (
        <img src={uploadUrl(imageId)} alt="" decoding="async" onError={() => setBrokenId(imageId)} />
      ) : (
        initialsFor(name)
      )}
      {decoration && <span className="avatar-deco" data-deco={decoration} />}
    </span>
  );
}

// Nome com a fonte/cor/efeito escolhidos pela pessoa.
export function UserName({ name, profile, className }) {
  const live = useProfile(name);
  const resolved = profile === undefined ? live : profile;
  const style = nameStyleOf(resolved);
  return (
    <span className={cls("user-name", style.className, className)} style={style.style}>
      {name}
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
