// Tauri backend commands and plugin setup

#[tauri::command]
fn get_backend_url() -> String {
    "http://127.0.0.1:8080".to_string()
}

#[tauri::command]
fn get_ws_url() -> String {
    "ws://127.0.0.1:8081/events".to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![get_backend_url, get_ws_url])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
