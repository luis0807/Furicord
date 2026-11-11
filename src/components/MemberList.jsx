import { Volume2 } from "lucide-react";
import { useChat } from "../state/chat-context.js";
import { cls } from "../lib/cls.js";
import { nameplateOf } from "../lib/profile.js";
import { useOverlays } from "./overlay-context.js";
import { Avatar, UserName } from "./ui.jsx";

export default function MemberList() {
  const { state } = useChat();
  const { openProfile } = useOverlays();
  const inVoice = new Set(state.voice.map((entry) => entry.name));

  return (
    <aside className="members" aria-label="Quem está online">
      <h2 className="section-title">Online — {state.users.length}</h2>
      <ul className="member-list">
        {state.users.map((user) => {
          const plate = nameplateOf(user.profile);
          return (
            <li key={user.name}>
              <button
                type="button"
                className={cls("member", plate && "has-plate")}
                data-plate={plate ?? undefined}
                onClick={(event) => openProfile(user.name, event)}
              >
                <Avatar name={user.name} profile={user.profile ?? null} size={32} online />
                <span className="member-name">
                  <UserName name={user.name} profile={user.profile ?? null} />
                  {user.name === state.self?.name && <span className="you-tag">você</span>}
                </span>
                {inVoice.has(user.name) && (
                  <Volume2 size={14} className="member-voice" aria-label="Em uma sala de voz" />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
