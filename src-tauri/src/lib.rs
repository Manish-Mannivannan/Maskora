mod geometry;
mod sources;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // The dialog is opened from Rust only; the frontend holds no dialog permission.
        .plugin(tauri_plugin_dialog::init())
        .manage(sources::SourceRegistry::default())
        .invoke_handler(tauri::generate_handler![
            sources::select_source,
            sources::read_source,
            geometry::inspect_geometry
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
