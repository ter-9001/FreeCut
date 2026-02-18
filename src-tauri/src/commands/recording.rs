use crate::models::{
    CameraInfo, MicrophoneInfo, RecordingConfig, RecordingState, ScreenInfo, ZoomMarker,
};
use crate::recording::RecordingManager;
use std::sync::Mutex;

// ---------------------------------------------------------------------------
// Device enumeration
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_screens() -> Result<Vec<ScreenInfo>, String> {
    crate::recording::screen::enumerate_screens()
}

#[tauri::command]
pub fn list_cameras() -> Result<Vec<CameraInfo>, String> {
    crate::recording::camera::enumerate_cameras()
}

#[tauri::command]
pub fn list_microphones() -> Result<Vec<MicrophoneInfo>, String> {
    crate::recording::audio::enumerate_microphones()
}

// ---------------------------------------------------------------------------
// Recording lifecycle
// ---------------------------------------------------------------------------

/// Generate a timestamped output path in ~/Movies/AutoEditor/
fn generate_output_path() -> Result<String, String> {
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let dir = format!("{home}/Movies/AutoEditor");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Cannot create output dir: {e}"))?;
    let ts = chrono::Local::now().format("%Y%m%d_%H%M%S");
    Ok(format!("{dir}/recording_{ts}.mp4"))
}

/// Camera layout for overlay positioning (percentages 0-100)
#[derive(serde::Deserialize)]
pub struct CameraLayoutInput {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Find the FFmpeg avfoundation device index for a screen.
///
/// The frontend may pass a Core Graphics display ID (like "1" for main display),
/// but FFmpeg needs the avfoundation device index. This function maps between them.
fn resolve_screen_index(screen_id: &str) -> String {
    // Get the list of FFmpeg screen devices
    let screens = match crate::recording::screen::enumerate_screens() {
        Ok(s) => s,
        Err(_) => return screen_id.to_string(), // Fallback to passed ID
    };

    // If the screen_id matches an existing FFmpeg screen ID directly, use it
    if screens.iter().any(|s| s.id == screen_id) {
        return screen_id.to_string();
    }

    // If we have screens, use the first one (most common case)
    // The Core Graphics display ID doesn't map directly to FFmpeg indices
    if let Some(first_screen) = screens.first() {
        eprintln!(
            "[recording] Mapping screen_id '{}' to FFmpeg device '{}'",
            screen_id, first_screen.id
        );
        return first_screen.id.clone();
    }

    // Fallback
    screen_id.to_string()
}

/// Find the FFmpeg avfoundation device index for a camera.
///
/// The frontend may pass a browser device ID or index, but FFmpeg needs
/// the avfoundation device index.
fn resolve_camera_index(camera_id: &str) -> String {
    // Get the list of FFmpeg camera devices
    let cameras = match crate::recording::camera::enumerate_cameras() {
        Ok(c) => c,
        Err(_) => return camera_id.to_string(),
    };

    // If the camera_id matches an existing FFmpeg camera ID directly, use it
    if cameras.iter().any(|c| c.id == camera_id) {
        return camera_id.to_string();
    }

    // Try to parse as an index
    if let Ok(idx) = camera_id.parse::<usize>() {
        if idx < cameras.len() {
            return cameras[idx].id.clone();
        }
    }

    // If we have cameras, use the first one
    if let Some(first_camera) = cameras.first() {
        eprintln!(
            "[recording] Mapping camera_id '{}' to FFmpeg device '{}'",
            camera_id, first_camera.id
        );
        return first_camera.id.clone();
    }

    camera_id.to_string()
}

/// Start recording. Screen + mic only; camera is recorded by the browser and merged later.
#[tauri::command]
pub fn start_recording(
    screen_id: Option<String>,
    mic_id: Option<String>,
    state: tauri::State<'_, Mutex<RecordingManager>>,
) -> Result<String, String> {
    let output_path = generate_output_path()?;

    // Resolve the screen ID to an FFmpeg avfoundation device index
    let resolved_screen_id = screen_id.as_ref().map(|id| resolve_screen_index(id));

    // Look up actual screen dimensions + origin from the enumerated screen list
    let screens = crate::recording::screen::enumerate_screens().unwrap_or_default();
    let selected_screen = screen_id
        .as_ref()
        .and_then(|sid| screens.iter().find(|s| s.id == *sid))
        .or_else(|| screens.first());
    let (sw, sh, sox, soy) = selected_screen
        .map(|s| (s.width, s.height, s.origin_x, s.origin_y))
        .unwrap_or((1920, 1080, 0.0, 0.0));

    eprintln!(
        "[recording] Starting with screen={:?}, mic={:?}, dims={}x{}, origin=({},{})",
        resolved_screen_id, mic_id, sw, sh, sox, soy
    );

    let config = RecordingConfig {
        screen_id: resolved_screen_id,
        camera_id: None,
        mic_id,
        output_path,
        screen_width: sw,
        screen_height: sh,
        screen_origin_x: sox,
        screen_origin_y: soy,
        camera_layout: None,
    };

    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.start_recording(&config)
}

/// Merge screen recording with a camera recording captured by the browser.
///
/// The camera file is saved by the frontend via the fs plugin, then this
/// command composites it onto the screen recording using the scene layout.
#[tauri::command]
pub fn merge_camera_overlay(
    screen_path: String,
    camera_path: String,
    camera_layout: CameraLayoutInput,
) -> Result<String, String> {
    let overlay = crate::recording::encoder::CameraOverlayConfig {
        x_percent: camera_layout.x,
        y_percent: camera_layout.y,
        width_percent: camera_layout.width,
        height_percent: camera_layout.height,
    };

    // Merge into a temp file, then replace the original screen recording
    let merged_path = format!(
        "{}_merged.mp4",
        screen_path.trim_end_matches(".mp4")
    );

    crate::recording::encoder::RecordingEncoder::merge_with_camera(
        &screen_path,
        &camera_path,
        &merged_path,
        &overlay,
    )?;

    // Replace original with merged, clean up temp files
    std::fs::remove_file(&screen_path).ok();
    std::fs::rename(&merged_path, &screen_path)
        .map_err(|e| format!("Failed to rename merged file: {e}"))?;
    std::fs::remove_file(&camera_path).ok();

    eprintln!("[recording] Camera overlay merged into {}", screen_path);
    Ok(screen_path)
}

#[tauri::command]
pub fn pause_recording(
    state: tauri::State<'_, Mutex<RecordingManager>>,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.pause_recording()
}

#[tauri::command]
pub fn resume_recording(
    state: tauri::State<'_, Mutex<RecordingManager>>,
) -> Result<(), String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.resume_recording()
}

#[tauri::command]
pub fn stop_recording(
    state: tauri::State<'_, Mutex<RecordingManager>>,
) -> Result<String, String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.stop_recording()
}

#[tauri::command]
pub fn get_recording_state(
    state: tauri::State<'_, Mutex<RecordingManager>>,
) -> Result<RecordingState, String> {
    let manager = state.lock().map_err(|e| e.to_string())?;
    Ok(manager.state.clone())
}

/// Toggle zoom during recording: first call zooms in at mouse position, second call zooms out.
#[tauri::command]
pub fn toggle_zoom(
    scale: Option<f64>,
    state: tauri::State<'_, Mutex<RecordingManager>>,
) -> Result<Option<ZoomMarker>, String> {
    let mut manager = state.lock().map_err(|e| e.to_string())?;
    manager.toggle_zoom(scale.unwrap_or(2.0))
}

/// Legacy zoom marker format (old "add marker each time" behavior).
#[derive(serde::Deserialize)]
struct LegacyZoomMarker {
    x: f64,
    y: f64,
    timestamp_ms: u64,
    scale: f64,
    duration_ms: u64,
}

/// Read zoom markers from the sidecar file next to a recording.
/// Supports both new (start_ms/end_ms) and legacy (timestamp_ms/duration_ms) formats.
#[tauri::command]
pub fn read_zoom_markers(recording_path: String) -> Result<Vec<ZoomMarker>, String> {
    let zoom_path = format!("{recording_path}.zoom.json");
    let json = match std::fs::read_to_string(&zoom_path) {
        Ok(s) => s,
        Err(_) => return Ok(vec![]),
    };
    if let Ok(markers) = serde_json::from_str::<Vec<ZoomMarker>>(&json) {
        return Ok(markers);
    }
    if let Ok(legacy) = serde_json::from_str::<Vec<LegacyZoomMarker>>(&json) {
        let converted: Vec<ZoomMarker> = legacy
            .into_iter()
            .map(|m| ZoomMarker {
                start_ms: m.timestamp_ms,
                end_ms: m.timestamp_ms + m.duration_ms,
                x: m.x,
                y: m.y,
                scale: m.scale,
            })
            .collect();
        return Ok(converted);
    }
    Ok(vec![])
}
