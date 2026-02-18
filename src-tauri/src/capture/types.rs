//! Types for capturable sources (windows and screens) using ScreenCaptureKit.

use serde::{Deserialize, Serialize};

/// Rectangle bounds for a capturable source.
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Represents a capturable window from ScreenCaptureKit.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CapturableWindow {
    /// CGWindowID - unique identifier for the window
    pub id: u32,
    /// Window title (may be empty for some windows)
    pub title: String,
    /// Name of the owning application
    pub owner_name: String,
    /// Bundle identifier of the owning application
    pub bundle_id: Option<String>,
    /// Process ID of the owning application
    pub pid: i32,
    /// Window bounds in screen coordinates
    pub bounds: Rect,
    /// Window layer (lower is closer to user)
    pub layer: i32,
    /// Whether the window is on screen
    pub is_on_screen: bool,
    /// Whether the window is minimized
    pub is_minimized: bool,
    /// Base64-encoded PNG thumbnail (~200px wide), if available
    pub thumbnail: Option<String>,
}

/// Represents a capturable screen/display from ScreenCaptureKit.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CapturableScreen {
    /// CGDirectDisplayID - unique identifier for the display
    pub id: u32,
    /// Human-readable display name
    pub name: String,
    /// Display width in pixels
    pub width: u32,
    /// Display height in pixels
    pub height: u32,
    /// Display frame origin and size
    pub frame: Rect,
    /// Whether this is the main display
    pub is_main: bool,
    /// Base64-encoded PNG thumbnail, if available
    pub thumbnail: Option<String>,
}

impl CapturableWindow {
    /// Create a new CapturableWindow with basic info
    pub fn new(id: u32, title: String, owner_name: String) -> Self {
        Self {
            id,
            title,
            owner_name,
            bundle_id: None,
            pid: 0,
            bounds: Rect::default(),
            layer: 0,
            is_on_screen: true,
            is_minimized: false,
            thumbnail: None,
        }
    }
}

impl CapturableScreen {
    /// Create a new CapturableScreen with basic info
    pub fn new(id: u32, name: String, width: u32, height: u32) -> Self {
        Self {
            id,
            name,
            width,
            height,
            frame: Rect {
                x: 0.0,
                y: 0.0,
                width: width as f64,
                height: height as f64,
            },
            is_main: false,
            thumbnail: None,
        }
    }
}
