//! Native screen and window capture module using Core Graphics.
//!
//! This module provides native enumeration of capturable sources (screens and windows)
//! without requiring the browser's getDisplayMedia picker dialog, enabling an OBS-like
//! user experience for selecting capture sources.
//!
//! It also provides live capture streaming for real-time preview of capture sources.
//!
//! # Platform Support
//! - **macOS**: Uses Core Graphics (CGWindowListCopyWindowInfo) for enumeration
//!   and CGWindowListCreateImage/CGDisplayCreateImage for frame capture.
//!   No Swift runtime required.
//!
//! # Permissions
//! Screen recording requires explicit user permission. On first use, the system will
//! prompt the user to grant screen recording access in System Preferences.

pub mod enumerate;
pub mod stream;
pub mod types;

pub use enumerate::{enumerate_screens, enumerate_windows};
pub use stream::{CaptureManager, CaptureSession, FramePayload, SourceType};
pub use types::{CapturableScreen, CapturableWindow, Rect};

// Tauri commands for frontend integration

/// List all capturable windows using ScreenCaptureKit.
///
/// Returns a list of windows that can be captured, filtered to exclude
/// system UI elements. Each window includes metadata and an optional
/// base64-encoded PNG thumbnail.
///
/// # Errors
/// Returns an error if screen recording permission is not granted or
/// if enumeration fails.
#[tauri::command]
pub fn list_capturable_windows() -> Result<Vec<CapturableWindow>, String> {
    enumerate_windows()
}

/// List all capturable screens/displays.
///
/// Returns a list of all connected displays with metadata and optional
/// base64-encoded PNG thumbnails.
///
/// # Errors
/// Returns an error if screen recording permission is not granted or
/// if enumeration fails.
#[tauri::command]
pub fn list_capturable_screens() -> Result<Vec<CapturableScreen>, String> {
    enumerate_screens()
}

// =============================================================================
// Capture Streaming Commands
// =============================================================================

use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

/// Capabilities of the capture system
#[derive(Debug, Clone, Serialize)]
pub struct CaptureCapabilities {
    /// Whether live streaming is supported
    pub streaming: bool,
    /// Whether window capture is supported
    pub window_capture: bool,
    /// Whether screen capture is supported
    pub screen_capture: bool,
    /// Maximum supported FPS for streaming
    pub max_fps: u32,
}

/// Get the capture capabilities of this system.
///
/// This command is used by the frontend to detect if streaming is supported.
/// If this command exists and returns successfully, streaming is available.
#[tauri::command]
pub fn get_capture_capabilities() -> CaptureCapabilities {
    CaptureCapabilities {
        streaming: true,
        window_capture: true,
        screen_capture: true,
        max_fps: 30,
    }
}

/// Start capturing frames from a source.
///
/// This starts streaming frames from the specified window or screen.
/// Use `get_source_frame` to poll for the latest captured frame.
///
/// # Arguments
/// * `source_id` - Unique identifier for this capture session
/// * `source_type` - Either "window" or "screen"
/// * `native_id` - The CGWindowID or CGDirectDisplayID
/// * `fps` - Optional frames per second (default: 30)
/// * `width` - Optional output width (default: 1280)
/// * `height` - Optional output height (default: 720)
///
/// # Errors
/// Returns an error if:
/// - Screen recording permission is not granted
/// - The specified window/screen is not found
/// - Capture fails to start
#[tauri::command]
pub fn start_source_capture(
    manager: State<'_, Mutex<CaptureManager>>,
    source_id: String,
    source_type: String,
    native_id: u32,
    fps: Option<u32>,
    width: Option<u32>,
    height: Option<u32>,
) -> Result<(), String> {
    let source_type = match source_type.to_lowercase().as_str() {
        "window" => SourceType::Window,
        "screen" => SourceType::Screen,
        _ => return Err(format!("Invalid source type: {}. Use 'window' or 'screen'", source_type)),
    };

    let manager = manager.lock().map_err(|_| "Lock poisoned")?;
    manager.start_capture(source_id, source_type, native_id, fps, width, height)
}

/// Stop capturing frames from a source.
///
/// # Arguments
/// * `source_id` - The unique identifier used when starting the capture
///
/// # Errors
/// Returns an error if the capture fails to stop cleanly.
#[tauri::command]
pub fn stop_source_capture(
    manager: State<'_, Mutex<CaptureManager>>,
    source_id: String,
) -> Result<(), String> {
    let manager = manager.lock().map_err(|_| "Lock poisoned")?;
    manager.stop_capture(&source_id)
}

/// Stop all active capture sessions.
///
/// # Errors
/// Returns an error if any capture fails to stop cleanly.
#[tauri::command]
pub fn stop_all_captures(
    manager: State<'_, Mutex<CaptureManager>>,
) -> Result<(), String> {
    let manager = manager.lock().map_err(|_| "Lock poisoned")?;
    manager.stop_all()
}

/// Get the latest captured frame for a source.
///
/// Returns the most recent frame as a base64-encoded JPEG, along with
/// metadata like timestamp and dimensions.
///
/// # Arguments
/// * `source_id` - The unique identifier used when starting the capture
///
/// # Returns
/// * `Ok(Some(FramePayload))` - Latest frame data
/// * `Ok(None)` - No frame available yet or source not found
/// * `Err(String)` - Error accessing capture state
#[tauri::command]
pub fn get_source_frame(
    manager: State<'_, Mutex<CaptureManager>>,
    source_id: String,
) -> Result<Option<FramePayload>, String> {
    let manager = manager.lock().map_err(|_| "Lock poisoned")?;
    Ok(manager.get_frame(&source_id))
}

/// Check if a source is currently being captured.
///
/// # Arguments
/// * `source_id` - The unique identifier used when starting the capture
///
/// # Returns
/// `true` if the source is actively capturing, `false` otherwise.
#[tauri::command]
pub fn is_source_capturing(
    manager: State<'_, Mutex<CaptureManager>>,
    source_id: String,
) -> Result<bool, String> {
    let manager = manager.lock().map_err(|_| "Lock poisoned")?;
    Ok(manager.is_capturing(&source_id))
}

/// Get list of all active capture source IDs.
///
/// # Returns
/// Vector of source IDs that are currently capturing.
#[tauri::command]
pub fn get_active_captures(
    manager: State<'_, Mutex<CaptureManager>>,
) -> Result<Vec<String>, String> {
    let manager = manager.lock().map_err(|_| "Lock poisoned")?;
    Ok(manager.active_sources())
}

/// Get the total number of frames captured for a source.
///
/// Useful for debugging and monitoring capture performance.
///
/// # Arguments
/// * `source_id` - The unique identifier used when starting the capture
///
/// # Returns
/// Total number of frames captured since the session started.
#[tauri::command]
pub fn get_capture_frame_count(
    manager: State<'_, Mutex<CaptureManager>>,
    source_id: String,
) -> Result<u64, String> {
    let manager = manager.lock().map_err(|_| "Lock poisoned")?;
    Ok(manager.frame_count(&source_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enumerate_screens() {
        // This test requires screen recording permission
        match enumerate_screens() {
            Ok(screens) => {
                println!("Found {} screens", screens.len());
                for screen in &screens {
                    println!(
                        "  Screen {}: {} ({}x{}) main={}",
                        screen.id, screen.name, screen.width, screen.height, screen.is_main
                    );
                }
                assert!(!screens.is_empty(), "Should have at least one screen");
            }
            Err(e) => {
                println!("Screen enumeration failed (likely no permission): {}", e);
            }
        }
    }

    #[test]
    fn test_enumerate_windows() {
        // This test requires screen recording permission
        match enumerate_windows() {
            Ok(windows) => {
                println!("Found {} windows", windows.len());
                for window in windows.iter().take(10) {
                    println!(
                        "  Window {}: '{}' by '{}'",
                        window.id, window.title, window.owner_name
                    );
                }
            }
            Err(e) => {
                println!("Window enumeration failed (likely no permission): {}", e);
            }
        }
    }
}
