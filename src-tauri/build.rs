fn main() {
    // Declare the app's own commands so each must be granted by name in a
    // capability; nothing is reachable from the frontend by default.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "select_source",
            "read_source",
            "inspect_geometry",
            "save_project",
            "open_project",
            "locate_source",
            "export_png",
        ]),
    ))
    .expect("failed to run tauri-build");
}
