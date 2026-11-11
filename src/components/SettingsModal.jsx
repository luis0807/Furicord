import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Copy, Eye, EyeOff, KeyRound, LogOut, MonitorUp, Palette, UserRound, X } from "lucide-react";
import { useChat } from "../state/chat-context.js";
import { useVoice } from "../voice/voice-context.js";
import { cls } from "../lib/cls.js";
import { getToken, normalizeName } from "../lib/identity.js";
import { THEMES, applyTheme, loadTheme, resolveTheme, saveTheme } from "../lib/theme.js";
import { STREAM_FPS, STREAM_RESOLUTIONS } from "../lib/streamQuality.js";
import { getSoundsEnabled, playSound, setSoundsEnabled, subscribeSounds } from "../lib/sounds.js";
import { IconButton } from "./ui.jsx";
import ProfileEditor from "./ProfileEditor.jsx";

const FORGET_WARNING =
  "Sair e fazer este navegador esquecer a conta?\n\nPara entrar de novo aqui, você vai precisar do código de acesso. Se ainda não guardou, cancele e copie o código nesta aba.";

const TABS = [
  { id: "conta", label: "Conta", icon: KeyRound },
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
          <button
            type="button"
            className="settings-tab is-danger"
            onClick={() => confirmLeave() && logout()}
          >
            <LogOut size={18} /> Sair
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
            {tab === "conta" && <AccountTab />}
            {tab === "aparencia" && <AppearanceTab />}
            {tab === "voz" && <VoiceTab />}
          </div>
        </section>
      </div>
    </div>
  );
}

// --- Conta --------------------------------------------------------------------

function AccountTab() {
  const { state, renameAccount, deleteAccount, logout } = useChat();
  const [name, setName] = useState(state.self.name);
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(null); // "rename" | "delete"
  const [notice, setNotice] = useState(null); // { type, text }
  const code = getToken();

  const normalized = normalizeName(name);
  const canRename = normalized && normalized !== state.self.name && busy === null;

  async function rename(event) {
    event.preventDefault();
    if (!canRename) return;
    setBusy("rename");
    const result = await renameAccount(normalized);
    setBusy(null);
    setNotice(result?.ok ? { type: "ok", text: `Pronto! Agora você é ${result.name}.` } : { type: "error", text: result?.error });
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setShowCode(true); // sem acesso à área de transferência: mostra para copiar à mão
    }
  }

  async function remove() {
    const ok = window.confirm(
      `Excluir a conta "${state.self.name}" para sempre?\n\nO nome fica livre para qualquer pessoa e o seu perfil é apagado. As mensagens que você já mandou continuam no histórico.`,
    );
    if (!ok) return;
    setBusy("delete");
    const result = await deleteAccount();
    setBusy(null);
    if (!result?.ok) setNotice({ type: "error", text: result?.error });
  }

  return (
    <div className="settings-section-list">
      <section>
        <h3 className="field-label">Nome</h3>
        <form className="inline-form" onSubmit={rename}>
          <input
            className="text-input"
            value={name}
            maxLength={40}
            onChange={(event) => {
              setName(event.target.value);
              setNotice(null);
            }}
            aria-label="Nome"
          />
          <button type="submit" className="button-secondary" disabled={!canRename}>
            {busy === "rename" ? "Salvando…" : "Trocar nome"}
          </button>
        </form>
        {notice && (
          <p className={notice.type === "error" ? "form-error" : "form-ok"} role="status">
            {notice.text}
          </p>
        )}
      </section>

      <section>
        <h3 className="field-label">Código de acesso</h3>
        <p className="settings-hint">
          Sua conta não tem senha: este navegador é lembrado por este código. Para entrar em outro aparelho (ou se
          limpar os dados do navegador), digite seu nome na tela de entrada e cole este código quando ele for pedido.{" "}
          <strong>Quem tiver o código entra como você — não mostre para ninguém.</strong>
        </p>
        <div className="code-box">
          <code className={cls("code-value", !showCode && "is-hidden")}>{showCode ? code : "•".repeat(24)}</code>
          <button type="button" className="button-ghost" onClick={() => setShowCode((value) => !value)}>
            {showCode ? <EyeOff size={16} /> : <Eye size={16} />} {showCode ? "Ocultar" : "Mostrar"}
          </button>
          <button type="button" className="button-secondary" onClick={copy}>
            <Copy size={16} /> {copied ? "Copiado!" : "Copiar"}
          </button>
        </div>
      </section>

      <section>
        <h3 className="field-label">Sair</h3>
        <p className="settings-hint">
          <strong>Sair:</strong> para voltar neste navegador, é só digitar seu nome — sem código.
          <br />
          <strong>Sair e esquecer este navegador:</strong> para computador compartilhado. Quem tentar entrar com o seu
          nome aqui vai precisar do código de acesso.
        </p>
        <div className="button-row">
          <button type="button" className="button-secondary" onClick={() => logout()}>
            <LogOut size={16} /> Sair
          </button>
          <button
            type="button"
            className="button-ghost"
            onClick={() => window.confirm(FORGET_WARNING) && logout({ forget: true })}
          >
            Sair e esquecer este navegador
          </button>
        </div>
      </section>

      <section className="danger-zone">
        <h3 className="field-label">Excluir conta</h3>
        <p className="settings-hint">Apaga a conta e o perfil do servidor e libera o nome. Não dá para desfazer.</p>
        <button type="button" className="button-danger" onClick={remove} disabled={busy !== null}>
          {busy === "delete" ? "Excluindo…" : "Excluir minha conta"}
        </button>
      </section>
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
