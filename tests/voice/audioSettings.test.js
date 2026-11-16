import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_AUDIO,
  normalizeAudioSettings,
  userAudio,
  voiceVolume,
  withUserAudio,
} from "../../src/voice/audioSettings.js";
import { groupDevices } from "../../src/voice/audioDevices.js";

test("preferências inválidas ou ausentes voltam ao padrão", () => {
  assert.deepEqual(normalizeAudioSettings(null), normalizeAudioSettings(DEFAULT_AUDIO));
  const settings = normalizeAudioSettings({ inputVolume: "alto", outputVolume: 9, inputDeviceId: 3 });
  assert.equal(settings.inputVolume, 1);
  assert.equal(settings.outputVolume, 2); // teto de 200%
  assert.equal(settings.inputDeviceId, "");
});

test("volume por pessoa multiplica o volume da chamada; silenciar zera", () => {
  let settings = normalizeAudioSettings({ outputVolume: 0.5 });
  assert.equal(voiceVolume(settings, "Ana"), 0.5);
  settings = withUserAudio(settings, "Ana", { volume: 2 });
  assert.equal(voiceVolume(settings, "Ana"), 1);
  settings = withUserAudio(settings, "Ana", { muted: true });
  assert.equal(voiceVolume(settings, "Ana"), 0);
  assert.equal(userAudio(settings, "Ana").volume, 2); // o volume volta quando tirar o silêncio
  assert.equal(voiceVolume(settings, "Bia"), 0.5);
});

test("quem volta ao padrão deixa de ser guardado", () => {
  let settings = withUserAudio(normalizeAudioSettings({}), "Ana", { volume: 1.5 });
  assert.ok(settings.users.Ana);
  settings = withUserAudio(settings, "Ana", { volume: 1 });
  assert.deepEqual(settings.users, {});
});

test("lista de dispositivos sem os atalhos do Chrome e com o nome do padrão", () => {
  const devices = groupDevices([
    { kind: "audioinput", deviceId: "default", label: "Padrão - Microfone (Realtek)" },
    { kind: "audioinput", deviceId: "communications", label: "Comunicações - Microfone (Realtek)" },
    { kind: "audioinput", deviceId: "a1", label: "Microfone (Realtek)" },
    { kind: "audioinput", deviceId: "a2", label: "Headset USB" },
    { kind: "audiooutput", deviceId: "default", label: "Default - Alto-falantes" },
    { kind: "audiooutput", deviceId: "b1", label: "Alto-falantes" },
    { kind: "videoinput", deviceId: "c1", label: "Câmera" },
  ]);
  assert.deepEqual(devices.inputs.map((d) => d.id), ["a1", "a2"]);
  assert.deepEqual(devices.outputs.map((d) => d.id), ["b1"]);
  assert.equal(devices.defaultInput, "Microfone (Realtek)");
  assert.equal(devices.defaultOutput, "Alto-falantes");
  assert.equal(devices.hasLabels, true);
});

test("sem permissão do microfone o navegador esconde os aparelhos", () => {
  const devices = groupDevices([
    { kind: "audioinput", deviceId: "", label: "" },
    { kind: "audiooutput", deviceId: "", label: "" },
  ]);
  assert.deepEqual(devices.inputs, []);
  assert.equal(devices.hasLabels, false);
});
