//! Áudio do computador para a transmissão de tela, SEM o som do próprio Furicord.
//!
//! O áudio do sistema que o navegador captura é a mistura de tudo o que toca no PC,
//! inclusive as vozes da chamada — e quem está na sala se ouve na transmissão. Aqui
//! usamos o "process loopback" do Windows 10 2004+, que captura tudo menos a árvore
//! de processos indicada.
//!
//! O alvo é o processo principal do WebView2, não o furicord.exe: para o Windows ele
//! não conta como filho do app (testado: excluir a árvore do furicord.exe deixava as
//! vozes passarem). E o WebView2 roda com AudioServiceOutOfProcess desligado
//! (tauri.conf.json), para o som sair desse mesmo processo, e não de um serviço à parte.
//!
//! As amostras (f32 intercalado, 48 kHz, estéreo) vão para a página por um Channel do
//! Tauri, e lá viram uma trilha de áudio comum (src/voice/systemAudio.js).

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

pub const SAMPLE_RATE: usize = 48_000;
pub const CHANNELS: usize = 2;
// 20 ms por mensagem: poucas mensagens por segundo e atraso pequeno.
const CHUNK_FRAMES: usize = SAMPLE_RATE / 50;

#[derive(Default)]
pub struct SystemAudio(Mutex<Option<Capture>>);

struct Capture {
    stop: Arc<AtomicBool>,
    thread: JoinHandle<()>,
}

// async: roda fora da thread principal, que é onde o with_webview precisa responder.
#[tauri::command]
pub async fn start_system_audio(
    webview: tauri::Webview,
    state: State<'_, SystemAudio>,
    on_audio: Channel<InvokeResponseBody>,
) -> Result<serde_json::Value, String> {
    stop_capture(&state);
    let exclude_pid = webview_browser_pid(&webview)?;

    let stop = Arc::new(AtomicBool::new(false));
    let (ready_tx, ready_rx) = mpsc::channel();
    let thread_stop = stop.clone();
    let thread = std::thread::Builder::new()
        .name("furicord-system-audio".into())
        .spawn(move || {
            if let Err(err) = capture(exclude_pid, &thread_stop, &on_audio, &ready_tx) {
                // Antes de começar: vira o erro do comando. Depois: só termina a captura.
                let _ = ready_tx.send(Err(err.to_string()));
            }
        })
        .map_err(|err| err.to_string())?;

    match ready_rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Ok(())) => {
            *state.0.lock().unwrap() = Some(Capture { stop, thread });
            Ok(serde_json::json!({ "sampleRate": SAMPLE_RATE, "channels": CHANNELS }))
        }
        Ok(Err(err)) => Err(err),
        Err(_) => {
            stop.store(true, Ordering::Relaxed);
            Err("o Windows não respondeu ao pedido de captura de áudio".into())
        }
    }
}

#[tauri::command]
pub fn stop_system_audio(state: State<'_, SystemAudio>) {
    stop_capture(&state);
}

fn stop_capture(state: &SystemAudio) {
    let current = state.0.lock().unwrap().take();
    if let Some(capture) = current {
        capture.stop.store(true, Ordering::Relaxed);
        let _ = capture.thread.join();
    }
}

// PID do processo principal do WebView2 desta janela, perguntado ao próprio WebView2.
fn webview_browser_pid(webview: &tauri::Webview) -> Result<u32, String> {
    let (tx, rx) = mpsc::channel();
    webview
        .with_webview(move |platform| {
            let pid = unsafe {
                platform.controller().CoreWebView2().and_then(|core| {
                    let mut pid = 0u32;
                    core.BrowserProcessId(&mut pid).map(|_| pid)
                })
            };
            let _ = tx.send(pid.map_err(|err| err.to_string()));
        })
        .map_err(|err| err.to_string())?;
    rx.recv_timeout(Duration::from_secs(2))
        .map_err(|_| "o WebView2 não informou o processo dele".to_string())?
}

fn capture(
    exclude_pid: u32,
    stop: &AtomicBool,
    out: &Channel<InvokeResponseBody>,
    ready: &mpsc::Sender<Result<(), String>>,
) -> Result<(), Box<dyn std::error::Error>> {
    use wasapi::{AudioClient, Direction, SampleType, StreamMode, WaveFormat};

    wasapi::initialize_mta().ok()?;
    let format = WaveFormat::new(32, 32, SampleType::Float, SAMPLE_RATE, CHANNELS, None);
    let chunk_bytes = CHUNK_FRAMES * format.get_blockalign() as usize;

    // include_tree = false: captura tudo MENOS o WebView2 (e o que ele abrir).
    let mut client = AudioClient::new_application_loopback_client(exclude_pid, false)?;
    client.initialize_client(
        &format,
        Direction::Capture,
        StreamMode::EventsShared {
            autoconvert: true,
            buffer_duration_hns: 200_000,
        },
        None,
    )?;
    let event = client.set_get_eventhandle()?;
    let reader = client.get_audiocaptureclient()?;
    client.start_stream()?;
    let _ = ready.send(Ok(()));

    let mut queue: VecDeque<u8> = VecDeque::with_capacity(chunk_bytes * 4);
    while !stop.load(Ordering::Relaxed) {
        while reader.get_next_packet_size()?.unwrap_or(0) > 0 {
            reader.read_from_device_to_deque(&mut queue)?;
        }
        while queue.len() >= chunk_bytes {
            let chunk: Vec<u8> = queue.drain(..chunk_bytes).collect();
            // A página foi embora (recarregou, fechou): para de capturar.
            if out.send(InvokeResponseBody::Raw(chunk)).is_err() {
                stop.store(true, Ordering::Relaxed);
                break;
            }
        }
        // Sem nada tocando, o Windows pode não mandar evento: o prazo só reavalia o stop.
        let _ = event.wait_for_event(100);
    }
    client.stop_stream()?;
    Ok(())
}
