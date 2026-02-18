//! Live capture streaming using Core Graphics (polling-based).
//!
//! This module provides real-time frame capture from screens and windows
//! for OBS-style live preview functionality.
//!
//! Uses polling with CGWindowListCreateImage / CGDisplayCreateImage
//! instead of ScreenCaptureKit callbacks (no Swift runtime required).

use super::enumerate::{capture_screen_frame, capture_window_frame};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::thread::{self, JoinHandle};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Type of capture source
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceType {
    Window,
    Screen,
}

/// Frame data stored in the buffer
#[derive(Debug, Clone)]
pub struct FrameData {
    /// JPEG-encoded frame as base64
    pub jpeg_base64: String,
    /// Timestamp when frame was captured (ms since epoch)
    pub timestamp: u64,
    /// Frame width (approximate)
    pub width: u32,
    /// Frame height (approximate)
    pub height: u32,
}

/// Payload sent to frontend via events or polling
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FramePayload {
    pub source_id: String,
    pub frame_base64: String,
    pub timestamp: u64,
    pub width: u32,
    pub height: u32,
}

/// Shared frame buffer for a capture session
pub struct FrameBuffer {
    latest_frame: RwLock<Option<FrameData>>,
    frame_count: AtomicU64,
}

impl FrameBuffer {
    pub fn new() -> Self {
        Self {
            latest_frame: RwLock::new(None),
            frame_count: AtomicU64::new(0),
        }
    }

    /// Store a new frame
    pub fn store_frame(&self, frame: FrameData) {
        if let Ok(mut guard) = self.latest_frame.write() {
            *guard = Some(frame);
            self.frame_count.fetch_add(1, Ordering::Relaxed);
        }
    }

    /// Get the latest frame
    pub fn get_frame(&self) -> Option<FrameData> {
        self.latest_frame.read().ok().and_then(|g| g.clone())
    }

    /// Get frame count
    pub fn frame_count(&self) -> u64 {
        self.frame_count.load(Ordering::Relaxed)
    }
}

impl Default for FrameBuffer {
    fn default() -> Self {
        Self::new()
    }
}

/// Active capture session using polling
pub struct CaptureSession {
    pub id: String,
    pub source_type: SourceType,
    pub native_id: u32,
    running: Arc<AtomicBool>,
    buffer: Arc<FrameBuffer>,
    capture_thread: Option<JoinHandle<()>>,
    fps: u32,
    width: u32,
    height: u32,
}

impl CaptureSession {
    /// Create a new capture session for a window
    pub fn new_window(
        id: String,
        window_id: u32,
        fps: u32,
        width: u32,
        height: u32,
    ) -> Result<Self, String> {
        Ok(Self {
            id,
            source_type: SourceType::Window,
            native_id: window_id,
            running: Arc::new(AtomicBool::new(false)),
            buffer: Arc::new(FrameBuffer::new()),
            capture_thread: None,
            fps,
            width,
            height,
        })
    }

    /// Create a new capture session for a screen
    pub fn new_screen(
        id: String,
        screen_id: u32,
        fps: u32,
        width: u32,
        height: u32,
    ) -> Result<Self, String> {
        Ok(Self {
            id,
            source_type: SourceType::Screen,
            native_id: screen_id,
            running: Arc::new(AtomicBool::new(false)),
            buffer: Arc::new(FrameBuffer::new()),
            capture_thread: None,
            fps,
            width,
            height,
        })
    }

    /// Start capturing frames in a background thread
    pub fn start(&mut self) -> Result<(), String> {
        if self.running.load(Ordering::Relaxed) {
            return Ok(()); // Already running
        }

        self.running.store(true, Ordering::Relaxed);

        let running = self.running.clone();
        let buffer = self.buffer.clone();
        let source_type = self.source_type;
        let native_id = self.native_id;
        let fps = self.fps;
        let target_width = self.width;
        let target_height = self.height;

        let handle = thread::spawn(move || {
            let frame_duration = Duration::from_millis(1000 / fps as u64);

            while running.load(Ordering::Relaxed) {
                let start = std::time::Instant::now();

                // Capture frame based on source type
                let jpeg_data = match source_type {
                    SourceType::Window => capture_window_frame(native_id),
                    SourceType::Screen => capture_screen_frame(native_id),
                };

                if let Some(data) = jpeg_data {
                    let timestamp = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);

                    let frame = FrameData {
                        jpeg_base64: BASE64.encode(&data),
                        timestamp,
                        width: target_width,
                        height: target_height,
                    };

                    buffer.store_frame(frame);
                }

                // Sleep for remaining frame time
                let elapsed = start.elapsed();
                if elapsed < frame_duration {
                    thread::sleep(frame_duration - elapsed);
                }
            }
        });

        self.capture_thread = Some(handle);
        Ok(())
    }

    /// Stop capturing frames
    pub fn stop(&mut self) -> Result<(), String> {
        self.running.store(false, Ordering::Relaxed);

        if let Some(handle) = self.capture_thread.take() {
            // Give the thread a moment to finish
            let _ = handle.join();
        }

        Ok(())
    }

    /// Check if session is running
    pub fn is_running(&self) -> bool {
        self.running.load(Ordering::Relaxed)
    }

    /// Get the latest captured frame
    pub fn get_frame(&self) -> Option<FrameData> {
        self.buffer.get_frame()
    }

    /// Get frame count
    pub fn frame_count(&self) -> u64 {
        self.buffer.frame_count()
    }

    /// Get the frame buffer
    pub fn buffer(&self) -> Arc<FrameBuffer> {
        self.buffer.clone()
    }
}

impl Drop for CaptureSession {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

/// Manager for multiple capture sessions
pub struct CaptureManager {
    sessions: RwLock<HashMap<String, CaptureSession>>,
    default_fps: u32,
    default_width: u32,
    default_height: u32,
}

impl CaptureManager {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            default_fps: 15, // Lower default for polling-based capture
            default_width: 1280,
            default_height: 720,
        }
    }

    /// Start capture for a source
    pub fn start_capture(
        &self,
        source_id: String,
        source_type: SourceType,
        native_id: u32,
        fps: Option<u32>,
        width: Option<u32>,
        height: Option<u32>,
    ) -> Result<(), String> {
        let fps = fps.unwrap_or(self.default_fps).min(30); // Cap at 30fps for polling
        let width = width.unwrap_or(self.default_width);
        let height = height.unwrap_or(self.default_height);

        // Check if session already exists and is running
        {
            let sessions = self.sessions.read().map_err(|_| "Lock poisoned")?;
            if let Some(session) = sessions.get(&source_id) {
                if session.is_running() {
                    return Ok(()); // Already capturing
                }
            }
        }

        // Create new session
        let mut session = match source_type {
            SourceType::Window => {
                CaptureSession::new_window(source_id.clone(), native_id, fps, width, height)?
            }
            SourceType::Screen => {
                CaptureSession::new_screen(source_id.clone(), native_id, fps, width, height)?
            }
        };

        // Start capture
        session.start()?;

        // Store session
        {
            let mut sessions = self.sessions.write().map_err(|_| "Lock poisoned")?;
            sessions.insert(source_id, session);
        }

        Ok(())
    }

    /// Stop capture for a source
    pub fn stop_capture(&self, source_id: &str) -> Result<(), String> {
        let mut session = {
            let mut sessions = self.sessions.write().map_err(|_| "Lock poisoned")?;
            sessions.remove(source_id)
        };

        if let Some(ref mut session) = session {
            session.stop()?;
        }

        Ok(())
    }

    /// Stop all captures
    pub fn stop_all(&self) -> Result<(), String> {
        let mut sessions = {
            let mut sessions = self.sessions.write().map_err(|_| "Lock poisoned")?;
            std::mem::take(&mut *sessions)
        };

        for (_, session) in sessions.iter_mut() {
            let _ = session.stop();
        }

        Ok(())
    }

    /// Get the latest frame for a source
    pub fn get_frame(&self, source_id: &str) -> Option<FramePayload> {
        let sessions = self.sessions.read().ok()?;
        let session = sessions.get(source_id)?;
        let frame = session.get_frame()?;

        Some(FramePayload {
            source_id: source_id.to_string(),
            frame_base64: frame.jpeg_base64,
            timestamp: frame.timestamp,
            width: frame.width,
            height: frame.height,
        })
    }

    /// Check if a source is being captured
    pub fn is_capturing(&self, source_id: &str) -> bool {
        self.sessions
            .read()
            .ok()
            .and_then(|s| s.get(source_id).map(|sess| sess.is_running()))
            .unwrap_or(false)
    }

    /// Get list of active capture source IDs
    pub fn active_sources(&self) -> Vec<String> {
        self.sessions
            .read()
            .ok()
            .map(|s| {
                s.iter()
                    .filter(|(_, sess)| sess.is_running())
                    .map(|(id, _)| id.clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    /// Get frame count for a source
    pub fn frame_count(&self, source_id: &str) -> u64 {
        self.sessions
            .read()
            .ok()
            .and_then(|s| s.get(source_id).map(|sess| sess.frame_count()))
            .unwrap_or(0)
    }
}

impl Default for CaptureManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_frame_buffer() {
        let buffer = FrameBuffer::new();
        assert!(buffer.get_frame().is_none());
        assert_eq!(buffer.frame_count(), 0);

        buffer.store_frame(FrameData {
            jpeg_base64: "test".to_string(),
            timestamp: 12345,
            width: 100,
            height: 100,
        });

        assert!(buffer.get_frame().is_some());
        assert_eq!(buffer.frame_count(), 1);
    }

    #[test]
    fn test_capture_manager() {
        let manager = CaptureManager::new();
        assert!(manager.active_sources().is_empty());
    }
}
