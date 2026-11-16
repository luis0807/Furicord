fn main() {
    // Comandos próprios do app, liberados para a página do Furicord na capability
    // furicord-web (allow-start-system-audio, allow-stop-system-audio).
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&["start_system_audio", "stop_system_audio"]),
    ))
    .expect("falha ao preparar o build do Tauri");
}
