#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

// Passado só quando o Windows abre o app no login: aí ele fica quieto na bandeja.
const AUTOSTART_ARG: &str = "--minimized";

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app)
        }))
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let startup_enabled = app.autolaunch().is_enabled().unwrap_or(false);

            let open = MenuItem::with_id(app, "open", "Abrir Furicord", true, None::<&str>)?;
            let startup = CheckMenuItem::with_id(
                app,
                "startup",
                "Abrir com o Windows",
                true,
                startup_enabled,
                None::<&str>,
            )?;
            let separator = PredefinedMenuItem::separator(app)?;
            let quit = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open, &startup, &separator, &quit])?;

            let startup_item = startup.clone();
            let startup_sync = startup.clone();
            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("ícone do app"))
                .tooltip("Furicord")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "open" => show_main(app),
                    "startup" => {
                        let autostart = app.autolaunch();
                        let _ = if autostart.is_enabled().unwrap_or(false) {
                            autostart.disable()
                        } else {
                            autostart.enable()
                        };
                        let _ = startup_item.set_checked(autostart.is_enabled().unwrap_or(false));
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(move |tray, event| match event {
                    TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } => show_main(tray.app_handle()),
                    // A opção também muda pelas Configurações: confere antes do menu abrir.
                    TrayIconEvent::Enter { .. } => {
                        let enabled = tray.app_handle().autolaunch().is_enabled().unwrap_or(false);
                        let _ = startup_sync.set_checked(enabled);
                    }
                    _ => {}
                })
                .build(app)?;

            if !std::env::args().any(|arg| arg == AUTOSTART_ARG) {
                show_main(app.handle());
            }
            Ok(())
        })
        // Fechar a janela só esconde (como o Discord); sair de verdade é pela bandeja.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Furicord");
}
