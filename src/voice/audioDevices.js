import { useEffect, useState } from "react";

// Microfones e alto-falantes do aparelho. Antes de a pessoa liberar o microfone, o
// navegador esconde os nomes (e às vezes a lista inteira): aí só aparece o padrão.

// Atalhos do Chrome/Edge para aparelhos que já estão na lista: o "Padrão do sistema"
// cobre o "default", e "communications" é o padrão para chamadas do Windows.
const ALIASES = new Set(["default", "communications"]);
// "Padrão - Microfone (Realtek)" -> "Microfone (Realtek)"
const DEFAULT_PREFIX = /^(default|padrão|predefinição|predeterminado)\s*-\s*/i;

export function groupDevices(list) {
  const result = { inputs: [], outputs: [], defaultInput: null, defaultOutput: null, hasLabels: false };
  for (const device of list) {
    const kind = device.kind === "audioinput" ? "input" : device.kind === "audiooutput" ? "output" : null;
    if (!kind) continue;
    if (device.label) result.hasLabels = true;
    if (device.deviceId === "default") {
      const label = device.label.replace(DEFAULT_PREFIX, "");
      if (kind === "input") result.defaultInput = label || null;
      else result.defaultOutput = label || null;
    }
    if (!device.deviceId || ALIASES.has(device.deviceId)) continue;
    const items = kind === "input" ? result.inputs : result.outputs;
    items.push({
      id: device.deviceId,
      label: device.label || `${kind === "input" ? "Microfone" : "Alto-falante"} ${items.length + 1}`,
    });
  }
  return result;
}

const EMPTY = groupDevices([]);

export function useAudioDevices() {
  const [devices, setDevices] = useState(EMPTY);

  useEffect(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.enumerateDevices) return;
    let alive = true;
    const refresh = () =>
      mediaDevices
        .enumerateDevices()
        .then((list) => alive && setDevices(groupDevices(list)))
        .catch(() => {});
    refresh();
    // Plugou ou tirou um fone, ou liberou o microfone (os nomes aparecem).
    mediaDevices.addEventListener("devicechange", refresh);
    return () => {
      alive = false;
      mediaDevices.removeEventListener("devicechange", refresh);
    };
  }, []);

  return devices;
}
