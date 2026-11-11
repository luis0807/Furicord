import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LogOut, MonitorUp, Palette, UserRound, X } from "lucide-react";
import { useChat } from "../state/chat-context.js";
import { useVoice } from "../voice/voice-context.js";
import { cls } from "../lib/cls.js";
import { THEMES, applyTheme, loadTheme, resolveTheme, saveTheme } from "../lib/theme.js";
import { STREAM_FPS, STREAM_RESOLUTIONS } from "../lib/streamQuality.js";
import { getSoundsEnabled, playSound, setSoundsEnabled, subscribeSounds } from "../lib/sounds.js";
import { IconButton } from "./ui.jsx";
import ProfileEditor from "./ProfileEditor.jsx";

const TABS = [
  { id: "perfil", label: "Perfil", icon: UserRound },
  { id: "aparencia", label: "Aparência", icon: Palette },
  { id: "voz", label: "Voz e vídeo", icon: MonitorUp },
];

export default function SettingsModal({ initialTab = "perfil", onClose }) {
  const { logout } = useChat();
  const [tab, setTab] = useState(initialTab);
  const dirty = useRef(false); // o editor de perfil avisa quando há algo não salvo

  const confirmLeave = () => !dirty.current || window.confirm("Descartar as alterações do perfil que não foram salvas?");
  const close = () => confirmLeave() && onClose();
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const onKeyDown = (event) => event.key === "Escape" && closeRef.current();
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function switchTab(id) {
    if (id === tab || !confirmLeave()) return;
    dirty.current = false;
    setTab(id);
  }

  const current = TABS.find((item) => item.id === tab);

  return (
    <div className="modal-backdrop" onPointerDown={(event) => event.target === event.currentTarget && close()}>
      <div className="settings" role="dialog" aria-modal="true" aria-label="Configurações">
        <nav className="settings-nav" aria-label="Seções">
          <h2 className="section-title">Configurações</h2>
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={cls("settings-tab", tab === id && "is-active")}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => switchTab(id)}
            >
              <Icon size={18} /> {label}
            </button>
          ))}
          <hr />
          <button type="button" className="settings-tab is-danger" onClick={() => confirmLeave() && logout()}>
            <LogOut size={18} /> Sair (trocar de nome)
          </button>
        </nav>

        <section className="settings-content">
          <header className="settings-header">
            <h2>{current.label}</h2>
            <IconButton label="Fechar" onClick={close}>
              <X />
            </IconButton>
          </header>
          <div className="settings-body">
            {tab === "perfil" && (
              <ProfileEditor
                onDirtyChange={(value) => {
                  dirty.current = value;
                }}
              />
            )}
            {tab === "aparencia" && <AppearanceTab />}
            {tab === "voz" && <VoiceTab />}
          </div>
        </section>
      </div>
    </div>
  );
}

// --- Aparência (só para você) -------------------------------------------------

function AppearanceTab() {
  const [saved, setSaved] = useState(loadTheme);
  const theme = resolveTheme(saved);
  const soundsOn = useSyncExternalStore(subscribeSounds, getSoundsEnabled);

  function choose(next) {
    setSaved(next);
    saveTheme(next);
    applyTheme(next);
  }

  const custom = {
    accent: theme.accent,
    gradient: theme.gradient ?? ["#141428", "#2a1430"],
  };

  return (
    <div className="settings-section-list">
      <p className="settings-hint">O tema muda só a sua tela — os outros continuam vendo o deles.</p>

      <section>
        <h3 className="field-label">Tema</h3>
        <div className="theme-grid">
          {THEMES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cls("theme-swatch", saved.id === item.id && "is-selected")}
              aria-pressed={saved.id === item.id}
              style={{
                "--swatch-accent": item.accent,
                background: item.gradient
                  ? `linear-gradient(135deg, ${item.gradient[0]}, ${item.gradient[1]})`
                  : "#1e1e23",
              }}
              onClick={() => choose({ id: item.id })}
            >
              <span className="theme-swatch-dot" />
              <span className="theme-swatch-label">{item.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="field-label">Personalizado</h3>
        <div className="color-row">
          <label className="color-field">
            <input
              type="color"
              value={custom.accent}
              onChange={(event) => choose({ id: "custom", accent: event.target.value, gradient: theme.gradient })}
            />
            Cor de destaque
          </label>
          <label className="switch-field">
            <input
              type="checkbox"
              checked={Boolean(theme.gradient)}
              onChange={(event) =>
                choose({ id: "custom", accent: custom.accent, gradient: event.target.checked ? custom.gradient : null })
              }
            />
            Fundo em gradiente
          </label>
          {theme.gradient &&
            [0, 1].map((index) => (
              <label key={index} className="color-field">
                <input
                  type="color"
                  value={theme.gradient[index]}
                  onChange={(event) => {
                    const gradient = [...theme.gradient];
                    gradient[index] = event.target.value;
                    choose({ id: "custom", accent: custom.accent, gradient });
                  }}
                />
                {index === 0 ? "Gradiente (início)" : "Gradiente (fim)"}
              </label>
            ))}
        </div>
      </section>

      <section>
        <h3 className="field-label">Sons</h3>
        <label className="switch-field">
          <input
            type="checkbox"
            checked={soundsOn}
            onChange={(event) => {
              setSoundsEnabled(event.target.checked);
              if (event.target.checked) playSound("message", { always: true });
            }}
          />
          Efeitos sonoros (mensagens, entrada e saída da voz, mudo, transmissão)
        </label>
      </section>
    </div>
  );
}

// --- Voz e vídeo --------------------------------------------------------------

function VoiceTab() {
  const voice = useVoice();
  const quality = voice.streamQuality;
  const set = (patch) => voice.setStreamQuality({ ...quality, ...patch });

  return (
    <div className="settings-section-list">
      <section>
        <h3 className="field-label">Resolução da transmissão de tela</h3>
        <div className="chip-row" role="radiogroup" aria-label="Resolução">
          {STREAM_RESOLUTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={quality.resolution === item.id}
              className={cls("chip", quality.resolution === item.id && "is-selected")}
              onClick={() => set({ resolution: item.id })}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="field-label">Quadros por segundo</h3>
        <div className="chip-row" role="radiogroup" aria-label="Quadros por segundo">
          {STREAM_FPS.map((fps) => (
            <button
              key={fps}
              type="button"
              role="radio"
              aria-checked={quality.fps === fps}
              className={cls("chip", quality.fps === fps && "is-selected")}
              onClick={() => set({ fps })}
            >
              {fps} fps
            </button>
          ))}
        </div>
      </section>

      <p className="settings-hint">
        15–30 fps deixa texto e código mais nítidos; 60 fps é melhor para jogos e vídeos. Cada pessoa na sala
        recebe uma cópia direta da sua tela, então qualidades altas usam bem mais da sua internet.
        {voice.screenStream && " A mudança já vale para a transmissão atual."}
      </p>
    </div>
  );
}
