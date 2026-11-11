import { randomId } from "../lib/identity.js";
import {
  contentHintFor,
  loadStreamQuality,
  maxBitrate,
  normalizeQuality,
  saveStreamQuality,
  videoConstraints,
} from "../lib/streamQuality.js";

/*
 * Voz e transmissão de tela via WebRTC em malha (cada participante conecta direto
 * com cada outro). O servidor só repassa a negociação (evento "rtc:signal").
 *
 * Como fica simples: toda conexão nasce com 3 transceivers fixos, sempre nesta ordem:
 *   0 = microfone, 1 = vídeo da tela, 2 = áudio da tela
 * Começar/parar de transmitir é só `replaceTrack` (sem renegociar), e quem recebe
 * sabe o que é cada trilha pela posição, sem precisar de metadados extras.
 *
 * Quem entra na sala é sempre quem faz a oferta para quem já estava. Como só um lado
 * oferece, não existe "colisão" de ofertas para tratar.
 *
 * Esta classe não conhece React: a UI assina mudanças com subscribe/getSnapshot.
 */

export const SELF = "self";

const MIC_CONSTRAINTS = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
const SPEAKING_THRESHOLD = 0.02;
const SPEAKING_HOLD_MS = 300;
// Quantas vezes seguidas tenta religar uma conexão que falhou.
const MAX_ICE_RESTARTS = 1;
// A partir de quando "Conectando…" vira um aviso de que algo está errado...
const SLOW_CONNECT_MS = 12_000;
// ...e quando desiste (ou religa uma vez, se for quem começou a conexão).
const CONNECT_TIMEOUT_MS = 25_000;

export class VoiceEngine {
  listeners = new Set();
  peers = new Map(); // socketId -> peer
  analysers = new Map(); // SELF | socketId -> detector de fala
  speaking = new Set();

  iceServers = null;
  channelId = null; // sala em que estamos de fato
  pendingChannelId = null; // sala em que estamos tentando entrar
  rejoinChannelId = null; // sala para voltar quando o socket reconectar
  joinToken = null;
  sid = null; // id desta entrada na sala (muda a cada entrada)

  muted = false;
  deafened = false;
  micStream = null;
  micPromise = null;
  micError = null;
  screenStream = null;
  streamQuality = loadStreamQuality();
  error = null;

  audioContext = null;
  speakingTimer = null;
  destroyed = false;

  constructor(socket, getIceServers) {
    this.socket = socket;
    this.getIceServers = getIceServers;
    this.handleSignal = this.handleSignal.bind(this);
    this.handleDisconnect = this.handleDisconnect.bind(this);
    this.handleSession = this.handleSession.bind(this);
    socket.on("rtc:signal", this.handleSignal);
    socket.on("disconnect", this.handleDisconnect);
    socket.on("session", this.handleSession);
    this.snapshot = this.buildSnapshot();
  }

  // --- Integração com React ---------------------------------------------------

  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  changed() {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  buildSnapshot() {
    const peers = {};
    for (const peer of this.peers.values()) {
      peers[peer.id] = {
        id: peer.id,
        // "failed" também quando o prazo acabou (o navegador às vezes nunca desiste).
        connectionState:
          peer.gaveUp && peer.pc.connectionState !== "connected" ? "failed" : peer.pc.connectionState,
        slow:
          !peer.gaveUp &&
          ["new", "connecting", "disconnected"].includes(peer.pc.connectionState) &&
          Date.now() - peer.since > SLOW_CONNECT_MS,
        micStream: peer.micStream,
        screenStream: peer.screenStream,
        screenAudioStream: peer.screenAudioStream,
      };
    }
    return {
      channelId: this.channelId,
      joiningChannelId: this.pendingChannelId,
      reconnecting: Boolean(this.rejoinChannelId),
      muted: this.muted,
      deafened: this.deafened,
      hasMic: Boolean(this.micStream),
      micError: this.micError,
      screenStream: this.screenStream,
      streamQuality: this.streamQuality,
      error: this.error,
      speaking: new Set(this.speaking),
      peers,
    };
  }

  // --- Entrar / sair -------------------------------------------------------------

  join(channelId) {
    if (this.channelId === channelId || this.pendingChannelId === channelId) return;
    this.leave({ keepMic: true });
    return this.connect(channelId);
  }

  async connect(channelId) {
    const token = {};
    this.joinToken = token;
    this.pendingChannelId = channelId;
    this.error = null;
    this.changed();

    // Depois de cada `await`, confere se a pessoa não saiu/trocou de sala no meio.
    const cancelled = () => this.joinToken !== token || this.destroyed;

    try {
      this.ensureAudioContext();
      if (!this.micStream) await this.openMic();
      if (cancelled()) return;

      // A cada entrada: as credenciais do TURN são temporárias.
      this.iceServers = await this.getIceServers();
      if (cancelled()) return;

      const sid = randomId();
      this.sid = sid;
      let result;
      try {
        result = await this.socket.timeout(10_000).emitWithAck("voice:join", {
          channelId,
          sid,
          muted: this.effectiveMuted(),
          deafened: this.deafened,
          sharing: Boolean(this.screenStream),
        });
      } catch {
        throw new Error("O servidor não respondeu. Tente entrar de novo.");
      }
      if (cancelled()) return;
      if (result?.error) throw new Error(result.error);

      this.channelId = channelId;
      for (const peer of result.peers) this.createPeer(peer.id, peer.sid, true);
    } catch (err) {
      if (!cancelled()) {
        this.error = err.message || "Não foi possível entrar no canal de voz";
        this.sid = null;
      }
    } finally {
      if (this.joinToken === token) {
        this.joinToken = null;
        this.pendingChannelId = null;
      }
      // Ninguém mais quer esse microfone (saiu durante a entrada ou deu erro).
      if (!this.channelId && !this.joinToken) {
        this.stopScreenShare({ silent: true });
        this.stopMic();
      }
      this.changed();
    }
  }

  leave({ keepMic = false } = {}) {
    const wasActive = Boolean(this.channelId || this.joinToken || this.rejoinChannelId);
    if (this.sid) this.socket.emit("voice:leave");
    this.joinToken = null;
    this.pendingChannelId = null;
    this.rejoinChannelId = null;
    for (const id of [...this.peers.keys()]) this.closePeer(id, { silent: true });
    this.channelId = null;
    this.sid = null;
    this.stopScreenShare({ silent: true });
    if (!keepMic) this.stopMic();
    if (wasActive) this.changed();
  }

  // Caiu a conexão com o servidor: as conexões com os outros já não valem (nosso
  // socket.id vai mudar). Guardamos a sala e o microfone para voltar sozinhos.
  handleDisconnect() {
    const channelId = this.channelId ?? this.pendingChannelId;
    if (!channelId) return;
    this.joinToken = null;
    this.pendingChannelId = null;
    for (const id of [...this.peers.keys()]) this.closePeer(id, { silent: true });
    this.channelId = null;
    this.sid = null;
    this.rejoinChannelId = channelId;
    this.changed();
  }

  handleSession() {
    const channelId = this.rejoinChannelId;
    if (!channelId) return;
    this.rejoinChannelId = null;
    this.connect(channelId);
  }

  // Chamado sempre que o servidor manda a lista de quem está em cada sala.
  syncState(entries) {
    if (!this.channelId) return;
    const present = new Map();
    for (const entry of entries) {
      if (entry.channelId === this.channelId && entry.id !== this.socket.id) present.set(entry.id, entry.sid);
    }
    for (const [id, peer] of this.peers) {
      if (present.get(id) !== peer.remoteSid) this.closePeer(id);
    }
  }

  destroy() {
    this.destroyed = true;
    this.leave();
    this.socket.off("rtc:signal", this.handleSignal);
    this.socket.off("disconnect", this.handleDisconnect);
    this.socket.off("session", this.handleSession);
    clearInterval(this.speakingTimer);
    this.audioContext?.close().catch(() => {});
    this.listeners.clear();
  }

  // --- Microfone -----------------------------------------------------------------

  micTrack() {
    return this.micStream?.getAudioTracks()[0] ?? null;
  }

  openMic() {
    this.micPromise ??= this.requestMic().finally(() => {
      this.micPromise = null;
    });
    return this.micPromise;
  }

  async requestMic() {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error("sem suporte"), { name: window.isSecureContext ? "NotSupportedError" : "InsecureContext" });
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS, video: false });
      if (this.destroyed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      this.micStream = stream;
      this.micError = null;
      this.applyMicEnabled();
      this.watchSpeaking(SELF, stream);
      // Se já estávamos na sala só ouvindo, começa a enviar o microfone agora.
      for (const peer of this.peers.values()) {
        peer.tr?.mic.sender.replaceTrack(this.micTrack()).catch(warn);
      }
    } catch (err) {
      this.micError = describeMicError(err);
    }
  }

  stopMic() {
    if (!this.micStream) return;
    this.micStream.getTracks().forEach((track) => track.stop());
    this.micStream = null;
    this.unwatchSpeaking(SELF);
  }

  effectiveMuted() {
    return this.muted || this.deafened || !this.micStream;
  }

  applyMicEnabled() {
    const track = this.micTrack();
    // Desligar a trilha envia silêncio: não precisa mexer nas conexões.
    if (track) track.enabled = !(this.muted || this.deafened);
  }

  publishState() {
    if (!this.channelId) return;
    this.socket.emit("voice:update", {
      muted: this.effectiveMuted(),
      deafened: this.deafened,
      sharing: Boolean(this.screenStream),
    });
  }

  async setMuted(muted) {
    this.muted = muted;
    // Igual ao Discord: tirar o mudo também tira o "ensurdecer".
    if (!muted) this.deafened = false;
    if (!muted && !this.micStream && this.channelId) await this.openMic();
    this.applyMicEnabled();
    this.publishState();
    this.changed();
  }

  setDeafened(deafened) {
    this.deafened = deafened;
    this.applyMicEnabled();
    this.publishState();
    this.changed();
  }

  // --- Transmissão de tela -------------------------------------------------------

  screenVideoTrack() {
    return this.screenStream?.getVideoTracks()[0] ?? null;
  }

  screenAudioTrack() {
    return this.screenStream?.getAudioTracks()[0] ?? null;
  }

  async startScreenShare() {
    if (!this.channelId || this.screenStream) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      this.error = "Este navegador não permite transmitir a tela.";
      this.changed();
      return;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: videoConstraints(this.streamQuality),
        audio: {
          // Áudio de jogo/vídeo não é voz: os filtros de voz estragariam o som.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // Chrome recente: não captura o próprio áudio da página (as vozes da sala),
          // senão os outros ouviriam eco de si mesmos ao transmitir a tela inteira.
          restrictOwnAudio: true,
        },
        systemAudio: "include",
        selfBrowserSurface: "exclude",
        surfaceSwitching: "include",
      });
    } catch (err) {
      // NotAllowedError = a pessoa cancelou a janela de escolha; não é erro.
      if (err.name !== "NotAllowedError") {
        warn(err);
        this.error = "Não foi possível transmitir a tela.";
        this.changed();
      }
      return;
    }

    if (!this.channelId || this.screenStream) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    this.screenStream = stream;
    this.error = null;
    const videoTrack = this.screenVideoTrack();
    if (videoTrack) videoTrack.contentHint = contentHintFor(this.streamQuality);
    // O botão "Parar de compartilhar" do próprio navegador encerra a trilha.
    this.screenVideoTrack()?.addEventListener("ended", () => {
      if (this.screenStream === stream) this.stopScreenShare();
    });
    for (const peer of this.peers.values()) this.applyScreenTracks(peer);
    this.publishState();
    this.changed();
  }

  stopScreenShare({ silent = false } = {}) {
    if (!this.screenStream) return;
    this.screenStream.getTracks().forEach((track) => track.stop());
    this.screenStream = null;
    for (const peer of this.peers.values()) this.applyScreenTracks(peer);
    if (!silent) {
      this.publishState();
      this.changed();
    }
  }

  applyScreenTracks(peer) {
    if (!peer.tr) return;
    peer.tr.video.sender.replaceTrack(this.screenVideoTrack()).catch(warn);
    peer.tr.screenAudio.sender.replaceTrack(this.screenAudioTrack()).catch(warn);
    this.applyVideoEncoding(peer);
  }

  // Sem isso o navegador limita a tela em ~2,5 Mbps, pouco para 1080p/60.
  applyVideoEncoding(peer) {
    const sender = peer.tr?.video.sender;
    if (!sender || peer.closed) return;
    const params = sender.getParameters();
    // Antes da negociação terminar ainda não há encodings; chamamos de novo depois.
    if (!params.encodings?.length) return;
    params.encodings[0].maxBitrate = maxBitrate(this.streamQuality);
    params.encodings[0].maxFramerate = this.streamQuality.fps;
    sender.setParameters(params).catch(warn);
  }

  setStreamQuality(quality) {
    this.streamQuality = normalizeQuality(quality);
    saveStreamQuality(this.streamQuality);
    // Transmitindo agora: ajusta na hora, sem precisar parar e começar de novo.
    const track = this.screenVideoTrack();
    if (track) {
      track.contentHint = contentHintFor(this.streamQuality);
      track.applyConstraints(videoConstraints(this.streamQuality)).catch(warn);
      for (const peer of this.peers.values()) this.applyVideoEncoding(peer);
    }
    this.changed();
  }

  // --- Conexões com cada participante -------------------------------------------

  createPeer(id, remoteSid, initiator) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers ?? [] });
    const peer = {
      id,
      remoteSid,
      initiator,
      pc,
      tr: null,
      restarts: 0,
      since: 0,
      gaveUp: false,
      slowTimer: null,
      giveUpTimer: null,
      queue: Promise.resolve(),
      closed: false,
      micStream: null,
      screenStream: null,
      screenAudioStream: null,
    };
    this.peers.set(id, peer);

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.signal(peer, { candidate: candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "connected") {
        peer.restarts = 0;
        this.stopWatching(peer);
      } else if (state === "failed") {
        this.connectionStuck(peer);
      } else if (state === "disconnected" && !peer.giveUpTimer) {
        // Rede oscilou: o navegador costuma voltar sozinho; se não voltar, o prazo decide.
        this.watchConnection(peer);
      }
      this.changed();
    };
    this.watchConnection(peer);

    if (initiator) {
      const transceivers = ["audio", "video", "audio"].map((kind) =>
        pc.addTransceiver(kind, { direction: "sendrecv" }),
      );
      this.bindTransceivers(peer, transceivers);
      pc.onnegotiationneeded = () =>
        this.enqueue(peer, async () => {
          await pc.setLocalDescription();
          this.signal(peer, { description: pc.localDescription.toJSON() });
        });
    }

    this.changed();
    return peer;
  }

  // Prazo para a conexão sair do "Conectando…". Necessário porque, quando não existe
  // caminho nenhum entre as duas redes, o navegador nunca declara "failed" sozinho.
  watchConnection(peer) {
    this.stopWatching(peer);
    peer.since = Date.now();
    peer.gaveUp = false;
    peer.slowTimer = setTimeout(() => this.changed(), SLOW_CONNECT_MS + 100); // só redesenha
    peer.giveUpTimer = setTimeout(() => {
      peer.giveUpTimer = null;
      if (!peer.closed && peer.pc.connectionState !== "connected") this.connectionStuck(peer);
    }, CONNECT_TIMEOUT_MS);
  }

  stopWatching(peer) {
    clearTimeout(peer.slowTimer);
    clearTimeout(peer.giveUpTimer);
    peer.slowTimer = null;
    peer.giveUpTimer = null;
  }

  // Falhou ou passou do prazo. Rede mudou (Wi-Fi caiu, trocou de rede...)? Tenta
  // religar uma vez sem sair da sala. Se a rede bloqueia a chamada (sem TURN), tentar
  // de novo não resolve: desiste e mostra o aviso.
  connectionStuck(peer) {
    if (peer.closed) return;
    if (peer.initiator && peer.restarts < MAX_ICE_RESTARTS) {
      peer.restarts++;
      this.watchConnection(peer);
      peer.pc.restartIce();
    } else {
      this.stopWatching(peer);
      peer.gaveUp = true;
    }
    this.changed();
  }

  bindTransceivers(peer, [mic, video, screenAudio]) {
    peer.tr = { mic, video, screenAudio };
    peer.micStream = new MediaStream([mic.receiver.track]);
    peer.screenStream = new MediaStream([video.receiver.track]);
    peer.screenAudioStream = new MediaStream([screenAudio.receiver.track]);
    this.watchSpeaking(peer.id, peer.micStream);
    return Promise.all([
      mic.sender.replaceTrack(this.micTrack()),
      video.sender.replaceTrack(this.screenVideoTrack()),
      screenAudio.sender.replaceTrack(this.screenAudioTrack()),
    ]);
  }

  signal(peer, payload) {
    this.socket.emit("rtc:signal", {
      to: peer.id,
      data: { ...payload, sid: this.sid, tsid: peer.remoteSid },
    });
  }

  handleSignal({ from, data }) {
    // `tsid` diferente = mensagem para uma entrada antiga nossa nesta sala.
    if (!data || !this.sid || data.tsid !== this.sid) return;

    let peer = this.peers.get(from);
    if (data.description?.type === "offer") {
      // Mesma pessoa, entrada nova (saiu e voltou): descarta a conexão antiga.
      if (peer && peer.remoteSid !== data.sid) {
        this.closePeer(from, { silent: true });
        peer = null;
      }
      peer ??= this.createPeer(from, data.sid, false);
    }
    if (!peer || peer.remoteSid !== data.sid) return;

    // Processa em fila: candidatos ICE só podem ser aplicados depois da oferta.
    this.enqueue(peer, () => this.applySignal(peer, data));
  }

  async applySignal(peer, data) {
    const { pc } = peer;
    if (peer.closed) return;

    if (data.description) {
      await pc.setRemoteDescription(data.description);
      if (data.description.type === "offer") {
        if (!peer.tr) {
          const transceivers = [...pc.getTransceivers()].sort((a, b) => Number(a.mid) - Number(b.mid));
          for (const transceiver of transceivers) transceiver.direction = "sendrecv";
          await this.bindTransceivers(peer, transceivers);
        } else if (pc.connectionState !== "connected") {
          // O outro lado está tentando religar: zera o prazo deste lado também.
          this.watchConnection(peer);
        }
        if (peer.closed) return;
        await pc.setLocalDescription();
        this.signal(peer, { description: pc.localDescription.toJSON() });
      }
      // Negociação concluída (dos dois lados): agora dá para aplicar o bitrate.
      this.applyVideoEncoding(peer);
    } else if (data.candidate) {
      await pc.addIceCandidate(data.candidate).catch(warn);
    }
  }

  enqueue(peer, task) {
    peer.queue = peer.queue.then(task).catch(warn);
    return peer.queue;
  }

  closePeer(id, { silent = false } = {}) {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.closed = true;
    this.stopWatching(peer);
    peer.pc.onicecandidate = null;
    peer.pc.onconnectionstatechange = null;
    peer.pc.onnegotiationneeded = null;
    peer.pc.close();
    this.unwatchSpeaking(id);
    if (!silent) this.changed();
  }

  // --- Indicador de quem está falando ----------------------------------------------

  ensureAudioContext() {
    // Criado dentro do clique em "entrar", senão o navegador começa com ele suspenso.
    if (!this.audioContext) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) this.audioContext = new AudioContextClass();
    }
    if (this.audioContext?.state === "suspended") this.audioContext.resume().catch(() => {});
  }

  watchSpeaking(id, stream) {
    if (!this.audioContext || !stream.getAudioTracks().length) return;
    this.unwatchSpeaking(id);
    const source = this.audioContext.createMediaStreamSource(stream);
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    this.analysers.set(id, { source, analyser, samples: new Uint8Array(analyser.fftSize), lastLoud: 0 });

    this.speakingTimer ??= setInterval(() => this.detectSpeaking(), 100);
  }

  unwatchSpeaking(id) {
    const detector = this.analysers.get(id);
    if (detector) {
      detector.source.disconnect();
      this.analysers.delete(id);
    }
    this.speaking.delete(id);
  }

  detectSpeaking() {
    const now = performance.now();
    let changed = false;
    for (const [id, detector] of this.analysers) {
      detector.analyser.getByteTimeDomainData(detector.samples);
      let sum = 0;
      for (const sample of detector.samples) {
        const value = (sample - 128) / 128;
        sum += value * value;
      }
      if (Math.sqrt(sum / detector.samples.length) > SPEAKING_THRESHOLD) detector.lastLoud = now;

      const isSpeaking = now - detector.lastLoud < SPEAKING_HOLD_MS;
      if (isSpeaking !== this.speaking.has(id)) {
        if (isSpeaking) this.speaking.add(id);
        else this.speaking.delete(id);
        changed = true;
      }
    }
    if (changed) this.changed();
  }
}

function describeMicError(err) {
  switch (err.name) {
    case "NotAllowedError":
      return "O navegador bloqueou o microfone. Você está só ouvindo.";
    case "NotFoundError":
      return "Nenhum microfone encontrado. Você está só ouvindo.";
    case "NotReadableError":
      return "O microfone está sendo usado por outro programa. Você está só ouvindo.";
    case "InsecureContext":
      return "Voz só funciona em HTTPS ou em localhost.";
    default:
      return "Não foi possível abrir o microfone. Você está só ouvindo.";
  }
}

function warn(err) {
  console.warn("[voz]", err);
}
