// Saída do áudio da chamada: alto-falante escolhido e volume acima de 100%.
//
// O áudio de cada pessoa toca num <audio> (é esse caminho que o cancelamento de eco
// do navegador conhece). Só que o <audio> não passa de 100%: acima disso, o som vai
// por um ganho do Web Audio, e o <audio> continua tocando, mudo — sem ele o Chrome
// entrega silêncio ao Web Audio para áudio que chega por WebRTC.

const hasWindow = typeof window !== "undefined";

// Trocar o alto-falante do <audio> (Chrome, Edge, Firefox; o Safari não deixa).
export const canChooseOutput = hasWindow && "setSinkId" in HTMLMediaElement.prototype;

const AudioContextClass = hasWindow ? window.AudioContext || window.webkitAudioContext : null;
const contextCanChooseOutput = Boolean(AudioContextClass && "setSinkId" in AudioContextClass.prototype);

let context = null;
let contextSink = "";
let outputDeviceId = "";

// Com um alto-falante escolhido, aumentar além de 100% só onde o Web Audio também
// sabe tocar nele; senão o som reforçado sairia no alto-falante errado.
export function canBoost(sinkId) {
  return Boolean(AudioContextClass) && (!sinkId || contextCanChooseOutput);
}

export function setPlaybackOutput(sinkId) {
  outputDeviceId = sinkId;
  if (context) applyContextSink();
}

function applyContextSink() {
  if (!contextCanChooseOutput || contextSink === outputDeviceId) return;
  contextSink = outputDeviceId;
  context.setSinkId(outputDeviceId).catch(warn);
}

function getContext() {
  context ??= new AudioContextClass();
  applyContextSink();
  if (context.state === "suspended") context.resume().catch(() => {});
  return context;
}

// Toca `stream` com ganho acima de 1. Devolve como ajustar o ganho e como parar.
export function boostStream(stream) {
  const audio = getContext();
  const source = audio.createMediaStreamSource(stream);
  const gain = audio.createGain();
  source.connect(gain).connect(audio.destination);
  return {
    setGain(value) {
      gain.gain.value = value;
    },
    stop() {
      source.disconnect();
      gain.disconnect();
    },
  };
}

// Aplica o alto-falante num <audio>. Se ele sumiu (fone desconectado), volta ao padrão.
export function applyElementOutput(element, sinkId) {
  if (!canChooseOutput || element.sinkId === sinkId) return;
  element.setSinkId(sinkId).catch((err) => {
    warn(err);
    if (sinkId) element.setSinkId("").catch(() => {});
  });
}

function warn(err) {
  console.warn("[áudio]", err);
}
