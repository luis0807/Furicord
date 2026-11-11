import { Volume2 } from "lucide-react";
import { useChat } from "../state/chat-context.js";
import { cls } from "../lib/cls.js";
import { nameplateOf } from "../lib/profile.js";
import { useOverlays } from "./overlay-context.js";
import { Avatar, UserName } from "./ui.jsx";

export default function MemberList() {
  const { state } = useChat();
  const online = state.users.filter((user) => user.online);
  const offline = state.users.filter((user) => !user.online);

  return (
    <aside className="members" aria-label="Membros">
      <MemberGroup title="Online" users={online} />
      {offline.length > 0 && <MemberGroup title="Offline" users={offline} />}
    </aside>
  );
}

function MemberGroup({ title, users }) {
  const { state } = useChat();
  const { openProfile } = useOverlays();
  const inVoice = new Set(state.voice.map((entry) => entry.name));

  return (
    <section>
      <h2 className="section-title">
        {title} — {users.length}
      </h2>
      <ul className="member-list">
        {users.map((user) => {
          const plate = nameplateOf(user.profile);
          return (
            <li key={user.name}>
              <button
                type="button"
                className={cls("member", plate && "has-plate", !user.online && "is-offline")}
                data-plate={plate ?? undefined}
                onClick={(event) => openProfile(user.name, event)}
              >
                <Avatar name={user.name} profile={user.profile ?? null} size={32} online={user.online} />
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
    </section>
  );
}
