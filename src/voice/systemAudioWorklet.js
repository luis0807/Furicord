// Roda dentro do AudioWorklet: toca as amostras que chegam do app de desktop
// (f32 intercalado, estéreo, 48 kHz). Um pequeno buffer absorve a variação de chegada:
// começa a tocar com 40 ms guardados e descarta o mais antigo acima de 200 ms, para o
// atraso nunca crescer.
const START_FRAMES = 1920;
const MAX_FRAMES = 9600;

class SystemAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.offset = 0; // posição (em amostras) dentro do primeiro pedaço
    this.frames = 0; // quadros guardados
    this.playing = false;
    this.port.onmessage = ({ data }) => {
      this.chunks.push(data);
      this.frames += data.length / 2;
      while (this.frames > MAX_FRAMES && this.chunks.length > 1) {
        const dropped = this.chunks.shift();
        this.frames -= (dropped.length - this.offset) / 2;
        this.offset = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const [left, right] = outputs[0];
    if (!this.playing && this.frames >= START_FRAMES) this.playing = true;
    for (let i = 0; i < left.length; i++) {
      const chunk = this.playing ? this.chunks[0] : undefined;
      if (!chunk) {
        left[i] = 0;
        right[i] = 0;
        continue;
      }
      left[i] = chunk[this.offset];
      right[i] = chunk[this.offset + 1];
      this.offset += 2;
      this.frames--;
      if (this.offset >= chunk.length) {
        this.chunks.shift();
        this.offset = 0;
      }
    }
    // Esvaziou (o app atrasou): espera encher de novo em vez de picotar.
    if (this.frames <= 0) this.playing = false;
    return true;
  }
}

registerProcessor("furicord-system-audio", SystemAudioProcessor);
