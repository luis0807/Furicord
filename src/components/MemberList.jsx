import { Volume2 } from "lucide-react";
import { useChat } from "../state/chat-context.js";
import { Avatar } from "./ui.jsx";

export default function MemberList() {
  const { state } = useChat();
  const inVoice = new Set(state.voice.map((entry) => entry.name));

  return (
    <aside className="members" aria-label="Quem está online">
      <h2 className="section-title">Online — {state.users.length}</h2>
      <ul className="member-list">
        {state.users.map((user) => (
          <li key={user.name} className="member">
            <Avatar name={user.name} size={32} online />
            <span className="member-name">
              {user.name}
              {user.name === state.self?.name && <span className="you-tag">você</span>}
            </span>
            {inVoice.has(user.name) && (
              <Volume2 size={14} className="member-voice" aria-label="Em uma sala de voz" />
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
