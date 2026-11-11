import { useEffect, useState } from "react";
import { ImagePlus, LoaderCircle } from "lucide-react";
import { useChat } from "../state/chat-context.js";
import { uploadImage } from "../lib/api.js";
import { ALLOWED_IMAGE_TYPES, MAX_UPLOAD_BYTES } from "../lib/config.js";
import { cls } from "../lib/cls.js";
import {
  DECORATIONS,
  MAX_BIO_LENGTH,
  NAMEPLATES,
  NAME_EFFECTS,
  NAME_FONTS,
  PROFILE_EFFECTS,
  PROFILE_THEME_PRESETS,
  loadProfile,
} from "../lib/profile.js";
import { Avatar, UserName } from "./ui.jsx";
import ProfileCard from "./ProfileCard.jsx";

const NAME_COLOR_DEFAULTS = ["#ffffff", "#ff6a3d"];
const sameColors = (a, b) => a?.[0] === b?.[0] && a?.[1] === b?.[1];

export default function ProfileEditor({ onDirtyChange }) {
  const { state, updateProfile } = useChat();
  const name = state.self.name;
  const [saved, setSaved] = useState(loadProfile);
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(null); // "avatar" | "banner" | "save"
  const [notice, setNotice] = useState(null); // { type: "error" | "ok", text }

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const patch = (changes) => {
    setNotice(null);
    setDraft((current) => ({ ...current, ...changes }));
  };
  const patchName = (changes) => patch({ nameStyle: { ...draft.nameStyle, ...changes } });

  async function upload(kind, file) {
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      setNotice({ type: "error", text: "Use uma imagem PNG, JPEG, GIF ou WebP." });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setNotice({ type: "error", text: `A imagem passa de ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.` });
      return;
    }
    setBusy(kind);
    setNotice(null);
    try {
      const result = await uploadImage(file);
      setDraft((current) => ({ ...current, [kind === "avatar" ? "avatarId" : "bannerId"]: result.id }));
    } catch (err) {
      setNotice({ type: "error", text: `Não foi possível enviar a imagem: ${err.message}` });
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    const result = await updateProfile(draft);
    setBusy(null);
    if (result?.error) {
      setNotice({ type: "error", text: result.error });
      return;
    }
    setSaved(draft);
    setNotice({ type: "ok", text: "Perfil salvo! Todo mundo online já está vendo." });
  }

  const effect = NAME_EFFECTS.find((item) => item.id === draft.nameStyle.effect) ?? NAME_EFFECTS[0];
  const nameColors = draft.nameStyle.colors;

  function setNameColor(index, value) {
    const next = [0, 1].map((i) => (i === index ? value : (nameColors[i] ?? NAME_COLOR_DEFAULTS[i])));
    patchName({ colors: next.slice(0, Math.max(effect.colors, 1)) });
  }

  return (
    <div className="profile-editor">
      <div className="profile-form">
        <Section title="Avatar" hint="PNG, JPEG, WebP ou GIF animado, até 8 MB. A imagem é cortada em círculo.">
          <div className="button-row">
            <FileButton busy={busy === "avatar"} onFile={(file) => upload("avatar", file)}>
              Trocar avatar
            </FileButton>
            {draft.avatarId && (
              <button type="button" className="button-ghost" onClick={() => patch({ avatarId: null })}>
                Remover
              </button>
            )}
          </div>
        </Section>

        <Section title="Banner" hint="Aparece no topo do cartão de perfil. Imagens largas (ex: 600×240) ficam melhores.">
          <div className="button-row">
            <FileButton busy={busy === "banner"} onFile={(file) => upload("banner", file)}>
              Enviar banner
            </FileButton>
            {draft.bannerId && (
              <button type="button" className="button-ghost" onClick={() => patch({ bannerId: null })}>
                Remover imagem
              </button>
            )}
            <label className="color-field">
              <input
                type="color"
                value={draft.bannerColor ?? "#ff6a3d"}
                onChange={(event) => patch({ bannerColor: event.target.value })}
              />
              Cor do banner
            </label>
            {draft.bannerColor && (
              <button type="button" className="button-ghost" onClick={() => patch({ bannerColor: null })}>
                Cor automática
              </button>
            )}
          </div>
        </Section>

        <Section title="Cores do perfil" hint="Gradiente do cartão de perfil.">
          <div className="swatch-row">
            <button
              type="button"
              className={cls("pair-swatch is-none", !draft.themeColors && "is-selected")}
              aria-pressed={!draft.themeColors}
              onClick={() => patch({ themeColors: null })}
              title="Sem cores"
            />
            {PROFILE_THEME_PRESETS.map((pair) => (
              <button
                key={pair.join()}
                type="button"
                className={cls("pair-swatch", sameColors(draft.themeColors, pair) && "is-selected")}
                aria-pressed={sameColors(draft.themeColors, pair)}
                aria-label={`Gradiente ${pair.join(" e ")}`}
                style={{ background: `linear-gradient(135deg, ${pair[0]}, ${pair[1]})` }}
                onClick={() => patch({ themeColors: pair })}
              />
            ))}
          </div>
          <div className="color-row">
            {[0, 1].map((index) => (
              <label key={index} className="color-field">
                <input
                  type="color"
                  value={draft.themeColors?.[index] ?? PROFILE_THEME_PRESETS[0][index]}
                  onChange={(event) => {
                    const next = [...(draft.themeColors ?? PROFILE_THEME_PRESETS[0])];
                    next[index] = event.target.value;
                    patch({ themeColors: next });
                  }}
                />
                {index === 0 ? "Cor principal" : "Cor de destaque"}
              </label>
            ))}
          </div>
        </Section>

        <Section title="Sobre mim">
          <textarea
            className="text-input bio-input"
            value={draft.bio}
            maxLength={MAX_BIO_LENGTH}
            rows={3}
            placeholder="Conte um pouco sobre você"
            onChange={(event) => patch({ bio: event.target.value })}
          />
          <span className="char-count">
            {draft.bio.length}/{MAX_BIO_LENGTH}
          </span>
        </Section>

        <Section title="Fonte do nome">
          <div className="chip-row">
            {NAME_FONTS.map((font) => (
              <button
                key={font.id ?? "padrao"}
                type="button"
                className={cls("chip", draft.nameStyle.font === font.id && "is-selected")}
                aria-pressed={draft.nameStyle.font === font.id}
                style={font.family ? { fontFamily: font.family } : undefined}
                onClick={() => patchName({ font: font.id })}
              >
                {font.label}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Efeito do nome">
          <div className="chip-row">
            {NAME_EFFECTS.map((item) => (
              <button
                key={item.id ?? "solido"}
                type="button"
                className={cls("chip", draft.nameStyle.effect === item.id && "is-selected")}
                aria-pressed={draft.nameStyle.effect === item.id}
                onClick={() => patchName({ effect: item.id, colors: nameColors.slice(0, Math.max(item.colors, 1)) })}
              >
                {item.label}
              </button>
            ))}
          </div>
          {effect.colors > 0 && (
            <div className="color-row">
              {Array.from({ length: effect.colors }, (_, index) => (
                <label key={index} className="color-field">
                  <input
                    type="color"
                    value={nameColors[index] ?? NAME_COLOR_DEFAULTS[index]}
                    onChange={(event) => setNameColor(index, event.target.value)}
                  />
                  {effect.colors === 1 ? "Cor do nome" : index === 0 ? "Cor 1" : "Cor 2"}
                </label>
              ))}
              {nameColors.length > 0 && (
                <button type="button" className="button-ghost" onClick={() => patchName({ colors: [] })}>
                  Cor padrão
                </button>
              )}
            </div>
          )}
        </Section>

        <Section title="Decoração do avatar">
          <div className="option-grid">
            {DECORATIONS.map((item) => (
              <OptionTile
                key={item.id ?? "nenhuma"}
                label={item.label}
                selected={draft.decoration === item.id}
                onClick={() => patch({ decoration: item.id })}
              >
                <Avatar name={name} profile={{ ...draft, decoration: item.id }} size={44} />
              </OptionTile>
            ))}
          </div>
        </Section>

        <Section title="Efeito do perfil" hint="Animação por cima do seu cartão de perfil.">
          <div className="option-grid">
            {PROFILE_EFFECTS.map((item) => (
              <OptionTile
                key={item.id ?? "nenhum"}
                label={item.label}
                selected={draft.effect === item.id}
                onClick={() => patch({ effect: item.id })}
              >
                <span className="effect-preview">
                  {item.id && <span className="profile-effect" data-effect={item.id} />}
                </span>
              </OptionTile>
            ))}
          </div>
        </Section>

        <Section title="Placa do nome" hint="Fundo atrás do seu nome na lista de membros.">
          <div className="option-grid is-wide">
            {NAMEPLATES.map((item) => (
              <OptionTile
                key={item.id ?? "nenhuma"}
                label={item.label}
                selected={draft.nameplate === item.id}
                onClick={() => patch({ nameplate: item.id })}
              >
                <span className={cls("member", "plate-preview", item.id && "has-plate")} data-plate={item.id ?? undefined}>
                  <Avatar name={name} profile={draft} size={24} />
                  <span className="member-name">
                    <UserName name={name} profile={draft} />
                  </span>
                </span>
              </OptionTile>
            ))}
          </div>
        </Section>
      </div>

      <aside className="profile-preview" aria-label="Prévia">
        <h3 className="field-label">Prévia</h3>
        <ProfileCard name={name} profile={draft} online />

        <h3 className="field-label">Na conversa</h3>
        <div className="preview-message">
          <Avatar name={name} profile={draft} size={40} />
          <div className="message-body">
            <header className="message-header">
              <UserName name={name} profile={draft} className="message-author" />
              <span className="message-time">Hoje</span>
            </header>
            <div className="message-text">Olha meu perfil novo!</div>
          </div>
        </div>
      </aside>

      {(dirty || notice) && (
        <div className={cls("save-bar", notice?.type === "error" && "is-error")} role="status">
          <span>{notice?.text ?? "Você tem alterações não salvas."}</span>
          {dirty && (
            <div className="save-bar-actions">
              <button type="button" className="button-ghost" onClick={() => setDraft(saved)} disabled={busy === "save"}>
                Descartar
              </button>
              <button type="button" className="button-primary" onClick={save} disabled={busy !== null}>
                {busy === "save" ? "Salvando…" : "Salvar alterações"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, hint, children }) {
  return (
    <section className="editor-section">
      <h3 className="field-label">{title}</h3>
      {hint && <p className="settings-hint">{hint}</p>}
      {children}
    </section>
  );
}

function FileButton({ busy, onFile, children }) {
  return (
    <label className={cls("button-secondary", busy && "is-busy")} aria-disabled={busy}>
      <input
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(",")}
        hidden
        disabled={busy}
        onChange={(event) => {
          onFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {busy ? <LoaderCircle size={16} className="spin" /> : <ImagePlus size={16} />}
      {busy ? "Enviando…" : children}
    </label>
  );
}

function OptionTile({ label, selected, onClick, children }) {
  return (
    <button type="button" className={cls("option-tile", selected && "is-selected")} aria-pressed={selected} onClick={onClick}>
      <span className="option-tile-preview">{children}</span>
      <span className="option-tile-label">{label}</span>
    </button>
  );
}
