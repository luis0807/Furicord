// Áudio do computador para a transmissão de tela, capturado pelo app de desktop SEM o
// som do próprio Furicord (src-tauri/src/system_audio.rs). Assim quem está na chamada
// não se ouve na transmissão. Aqui ele vira uma trilha de áudio comum.
import workletSource from "./systemAudioWorklet.js?raw";
import { isDesktop } from "../lib/desktop.js";

const SAMPLE_RATE = 48_000;

// App de desktop com a captura nativa (versões antigas do app não têm o comando).
// Perguntado cedo: o clique em "transmitir" não pode esperar para abrir a escolha de tela.
let supported = null;
export function nativeSystemAudioSupported() {
  if (!isDesktop) return Promise.resolve(false);
  supported ??= import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("stop_system_audio"))
    .then(
      () => true,
      () => false,
    );
  return supported;
}

export async function startSystemAudio() {
  const { Channel, invoke } = await import("@tauri-apps/api/core");
  const context = new AudioContext({ sampleRate: SAMPLE_RATE });
  // O worklet vem como texto e é carregado por uma URL blob: (funciona igual no
  // navegador e no WebView2, sem depender de como o Vite empacota arquivos pequenos).
  const workletUrl = URL.createObjectURL(new Blob([workletSource], { type: "text/javascript" }));
  try {
    await context.audioWorklet.addModule(workletUrl);
    const node = new AudioWorkletNode(context, "furicord-system-audio", {
      numberOfInputs: 0,
      outputChannelCount: [2],
    });
    const destination = context.createMediaStreamDestination();
    node.connect(destination);

    const channel = new Channel();
    channel.onmessage = (message) => {
      const samples = new Float32Array(toArrayBuffer(message));
      node.port.postMessage(samples, [samples.buffer]);
    };
    const format = await invoke("start_system_audio", { onAudio: channel });
    if (format?.sampleRate !== SAMPLE_RATE) throw new Error(`formato inesperado: ${JSON.stringify(format)}`);
    await context.resume();

    const track = destination.stream.getAudioTracks()[0];
    track.contentHint = "music";
    return {
      track,
      stop() {
        channel.onmessage = () => {};
        invoke("stop_system_audio").catch(() => {});
        track.stop();
        context.close().catch(() => {});
      },
    };
  } catch (err) {
    context.close().catch(() => {});
    throw err;
  } finally {
    URL.revokeObjectURL(workletUrl);
  }
}

// Pacotes pequenos chegam como ArrayBuffer; por garantia, aceita também arrays.
function toArrayBuffer(message) {
  if (message instanceof ArrayBuffer) return message;
  if (ArrayBuffer.isView(message)) return message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength);
  return new Uint8Array(message).buffer;
}
