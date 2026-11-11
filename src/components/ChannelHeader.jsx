import { Menu, Users } from "lucide-react";
import { IconButton } from "./ui.jsx";

export default function ChannelHeader({ icon, title, topic, layout }) {
  return (
    <header className="channel-header">
      <IconButton label="Abrir canais" className="mobile-only" onClick={layout.onOpenNav}>
        <Menu />
      </IconButton>
      <span className="channel-header-icon">{icon}</span>
      <h1 className="channel-header-title">{title}</h1>
      {topic && (
        <>
          <span className="channel-header-divider" aria-hidden="true" />
          <p className="channel-header-topic">{topic}</p>
        </>
      )}
      <div className="channel-header-actions">
        <IconButton
          label={layout.membersOpen ? "Ocultar membros" : "Mostrar membros"}
          active={layout.membersOpen}
          onClick={layout.onToggleMembers}
        >
          <Users />
        </IconButton>
      </div>
    </header>
  );
}
