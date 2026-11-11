import { useState } from "react";
import { colorFor } from "../lib/avatar.js";
import { cls } from "../lib/cls.js";
import { uploadUrl } from "../lib/config.js";
import { effectOf } from "../lib/profile.js";
import { Avatar, UserName } from "./ui.jsx";

// Cartão de perfil: usado no popover ao clicar em alguém e na prévia do editor.
// Recebe sempre o perfil já resolvido (null = sem personalização).
export default function ProfileCard({ name, profile, online = false, footer, className }) {
  const [brokenBanner, setBrokenBanner] = useState(null);
  const theme = profile?.themeColors;
  const effect = effectOf(profile);
  const bannerId = profile?.bannerId && profile.bannerId !== brokenBanner ? profile.bannerId : null;
  const bannerColor = profile?.bannerColor ?? theme?.[0] ?? colorFor(name);

  return (
    <div
      className={cls("profile-card", theme && "has-theme", className)}
      style={theme ? { "--card-1": theme[0], "--card-2": theme[1] } : undefined}
    >
      <div className="profile-banner" style={{ background: bannerColor }}>
        {bannerId && <img src={uploadUrl(bannerId)} alt="" onError={() => setBrokenBanner(bannerId)} />}
      </div>
      <div className="profile-avatar">
        <Avatar name={name} profile={profile ?? null} size={84} online={online} />
      </div>
      <div className="profile-body">
        <UserName name={name} profile={profile ?? null} className="profile-name" />
        {profile?.bio && (
          <>
            <h3 className="section-title">Sobre mim</h3>
            <p className="profile-bio">{profile.bio}</p>
          </>
        )}
        {footer}
      </div>
      {effect && <div className="profile-effect" data-effect={effect} aria-hidden="true" />}
    </div>
  );
}
