import { useRef, useState } from "react";
import { ChevronUp } from "lucide-react";
import { useAudioSettings, useVoice } from "../voice/voice-context.js";
import { useAudioDevices } from "../voice/audioDevices.js";
import { MAX_VOLUME, userAudio } from "../voice/audioSettings.js";
import { canChooseOutput } from "../voice/playback.js";
import { cls } from "../lib/cls.js";
import Popover from "./Popover.jsx";

// Controles das preferências de áudio (voice/audioSettings.js): usados no menu ao
// lado dos botões de microfone e áudio, nas Configurações e no perfil de quem está
// na sua sala.

const MAX_PERCENT = MAX_VOLUME * 100;
// Perto de 100% o controle "gruda" no 100, para ser fácil voltar ao normal.
const SNAP = 4;

export function VolumeSlider({ label, value, onChange, disabled }) {
  const percent = Math.round(value * 100);

  function change(event) {
    let next = Number(event.target.value);
    if (Math.abs(next - 100) <= SNAP) next = 100;
    onChange(next / 100);
  }

  return (
    <label className={cls("volume-field", disabled && "is-disabled")}>
      <span className="volume-field-head">
        <span>{label}</span>
        <span className="volume-field-value">{percent}%</span>
      </span>
      <input
        type="range"
        min="0"
        max={MAX_PERCENT}
        step="1"
        value={percent}
        disabled={disabled}
        onChange={change}
        // Duplo clique volta para 100%.
        onDoubleClick={() => onChange(1)}
        aria-valuetext={`${percent}%`}
      />
    </label>
  );
}

function DeviceList({ label, devices, defaultLabel, selected, onSelect }) {
  // O escolhido não está conectado agora: o que toca/capta de fato é o padrão.
  const current = devices.some((device) => device.id === selected) ? selected : "";
  const options = [{ id: "", label: "Padrão do sistema", detail: defaultLabel }, ...devices];

  return (
    <div className="device-list" role="radiogroup" aria-label={label}>
      {options.map((device) => (
        <button
          key={device.id || "padrao"}
          type="button"
          role="radio"
          aria-checked={current === device.id}
          className={cls("device-option", current === device.id && "is-selected")}
          onClick={() => onSelect(device.id)}
        >
          <span className="device-option-dot" aria-hidden="true" />
          <span className="device-option-text">
            <span>{device.label}</span>
            {device.detail && <small>{device.detail}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function InputSettings({ headingClass = "section-title" }) {
  const voice = useVoice();
  const audio = useAudioSettings();
  const devices = useAudioDevices();

  return (
    <div className="audio-settings">
      <h3 className={headingClass}>Microfone</h3>
      <DeviceList
        label="Microfone"
        devices={devices.inputs}
        defaultLabel={devices.defaultInput}
        selected={audio.inputDeviceId}
        onSelect={voice.setInputDevice}
      />
      {!devices.hasLabels && (
        <p className="settings-hint">Os nomes dos aparelhos aparecem depois que você libera o microfone.</p>
      )}
      <VolumeSlider label="Volume do microfone" value={audio.inputVolume} onChange={voice.setInputVolume} />
      <p className="settings-hint">O quanto os outros te ouvem.</p>
    </div>
  );
}

export function OutputSettings({ headingClass = "section-title" }) {
  const voice = useVoice();
  const audio = useAudioSettings();
  const devices = useAudioDevices();

  return (
    <div className="audio-settings">
      <h3 className={headingClass}>Alto-falante</h3>
      {canChooseOutput ? (
        <DeviceList
          label="Alto-falante"
          devices={devices.outputs}
          defaultLabel={devices.defaultOutput}
          selected={audio.outputDeviceId}
          onSelect={voice.setOutputDevice}
        />
      ) : (
        <p className="settings-hint">Este navegador não deixa escolher: o áudio sai no alto-falante do sistema.</p>
      )}
      <VolumeSlider label="Volume da chamada" value={audio.outputVolume} onChange={voice.setOutputVolume} />
      <p className="settings-hint">Vale para as vozes e as transmissões de todo mundo.</p>
    </div>
  );
}

// Setinha ao lado do botão de microfone/áudio que abre o menu de dispositivos.
export function AudioMenuButton({ kind }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const label = kind === "input" ? "Opções do microfone" : "Opções do alto-falante";

  return (
    <>
      <button
        ref={ref}
        type="button"
        className={cls("audio-menu-toggle", open && "is-open")}
        onClick={() => setOpen((value) => !value)}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <ChevronUp size={14} />
      </button>
      {open && (
        <Popover anchorRef={ref} onClose={() => setOpen(false)} label={label} className="audio-menu">
          {kind === "input" ? <InputSettings /> : <OutputSettings />}
        </Popover>
      )}
    </>
  );
}

// No perfil de quem está na sua sala de voz.
export function UserAudioControls({ name }) {
  const voice = useVoice();
  const audio = useAudioSettings();
  const user = userAudio(audio, name);

  return (
    <div className="user-audio">
      <VolumeSlider
        label="Volume para você"
        value={user.volume}
        onChange={(volume) => voice.setUserVolume(name, volume)}
        disabled={user.muted}
      />
      <label className="switch-field">
        <input type="checkbox" checked={user.muted} onChange={(event) => voice.setUserMuted(name, event.target.checked)} />
        Silenciar para mim
      </label>
      <p className="settings-hint">Só muda o que você ouve: os outros continuam ouvindo normalmente.</p>
    </div>
  );
}
