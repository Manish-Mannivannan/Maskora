mod dialog_turn;
mod geometry;
mod project;
mod recovery;
mod sources;
mod trust;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The dialog is opened from Rust only; the frontend holds no dialog permission.
        .plugin(tauri_plugin_dialog::init())
        .manage(sources::SourceRegistry::default())
        .manage(project::ProjectFiles::default())
        .setup(|app| {
            use tauri::Manager;
            // The trust record is per installation, in local app data, never in a project file.
            let record = app
                .path()
                .app_local_data_dir()
                .map(|dir| dir.join("authorized-sources.json"))
                .unwrap_or_else(|_| std::env::temp_dir().join("maskora-authorized-sources.json"));
            app.manage(trust::TrustStore::load(record));
            // Unsaved work is kept for recovery beside it, also per installation.
            let snapshot = app
                .path()
                .app_local_data_dir()
                .map(|dir| dir.join("recovery.json"))
                .unwrap_or_else(|_| std::env::temp_dir().join("maskora-recovery.json"));
            app.manage(recovery::RecoveryStore::new(snapshot));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            sources::select_source,
            sources::read_source,
            geometry::inspect_geometry,
            project::save_project,
            project::open_project,
            project::locate_source,
            project::export_png,
            recovery::save_recovery,
            recovery::peek_recovery,
            recovery::discard_recovery,
            recovery::recover_project,
            trust::list_approvals,
            trust::forget_approval,
            trust::forget_all_approvals
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
