pub mod audio;
pub mod camera;
pub mod encoder;
pub mod mouse_tracker;
pub mod screen;

use crate::models::{RecordingConfig, RecordingState, ZoomMarker};
use std::time::Instant;

/// Central manager that coordinates FFmpeg-based recording and mouse tracking.
pub struct RecordingManager {
    pub state: RecordingState,
    pub encoder: Option<encoder::RecordingEncoder>,
    pub mouse_tracker: Option<mouse_tracker::MouseTracker>,
    pub output_path: Option<String>,
    pub zoom_markers: Vec<ZoomMarker>,
    pub recording_start: Option<Instant>,
    pub is_zoomed_in: bool,
    pub screen_width: u32,
    pub screen_height: u32,
    /// Display origin X in the global coordinate space (for multi-monitor)
    pub screen_origin_x: f64,
    /// Display origin Y in the global coordinate space (for multi-monitor)
    pub screen_origin_y: f64,
}

impl RecordingManager {
    pub fn new() -> Self {
        Self {
            state: RecordingState::Idle,
            encoder: None,
            mouse_tracker: None,
            output_path: None,
            zoom_markers: Vec::new(),
            recording_start: None,
            is_zoomed_in: false,
            screen_width: 1920,
            screen_height: 1080,
            screen_origin_x: 0.0,
            screen_origin_y: 0.0,
        }
    }

    pub fn start_recording(&mut self, config: &RecordingConfig) -> Result<String, String> {
        if self.state != RecordingState::Idle {
            return Err("Recording is already in progress".to_string());
        }

        let screen_idx = config.screen_id.as_deref();
        let mic_idx = config.mic_id.as_deref();

        // Camera is recorded separately by the browser (MediaRecorder)
        // and merged in post-processing, so we only record screen + mic here.
        let enc = encoder::RecordingEncoder::start(
            &config.output_path,
            screen_idx,
            mic_idx,
            30,
        )?;
        self.encoder = Some(enc);

        let mut tracker = mouse_tracker::MouseTracker::new();
        tracker.start();
        self.mouse_tracker = Some(tracker);

        self.output_path = Some(config.output_path.clone());
        self.zoom_markers.clear();
        self.recording_start = Some(Instant::now());
        self.is_zoomed_in = false;
        self.screen_width = config.screen_width.max(1);
        self.screen_height = config.screen_height.max(1);
        self.screen_origin_x = config.screen_origin_x;
        self.screen_origin_y = config.screen_origin_y;
        self.state = RecordingState::Recording;

        Ok(config.output_path.clone())
    }

    pub fn pause_recording(&mut self) -> Result<(), String> {
        if self.state != RecordingState::Recording {
            return Err("Not currently recording".to_string());
        }
        // Note: FFmpeg avfoundation doesn't natively support pause.
        // We track the paused state so the UI reflects it, but the
        // recording continues. A proper implementation would stop and
        // restart FFmpeg, concatenating segments on stop.
        self.state = RecordingState::Paused;
        Ok(())
    }

    pub fn resume_recording(&mut self) -> Result<(), String> {
        if self.state != RecordingState::Paused {
            return Err("Not currently paused".to_string());
        }
        self.state = RecordingState::Recording;
        Ok(())
    }

    pub fn stop_recording(&mut self) -> Result<String, String> {
        if self.state == RecordingState::Idle {
            return Err("No recording in progress".to_string());
        }

        // Stop FFmpeg encoder
        if let Some(enc) = self.encoder.take() {
            enc.stop()?;
        }

        // Stop mouse tracker and persist data
        if let Some(mut tracker) = self.mouse_tracker.take() {
            tracker.stop();
            if let Some(ref out) = self.output_path {
                let mouse_path = format!("{}.mouse.json", out);
                tracker.save_to_file(&mouse_path).ok();
            }
        }

        // Close any open zoom segment (user zoomed in but didn't zoom out)
        if self.is_zoomed_in {
            if let Some(last) = self.zoom_markers.last_mut() {
                if last.end_ms == 0 {
                    last.end_ms = self
                        .recording_start
                        .map(|s| s.elapsed().as_millis() as u64)
                        .unwrap_or(0);
                }
            }
            self.is_zoomed_in = false;
        }
        // Save zoom markers (filter out incomplete segments)
        let complete: Vec<_> = self
            .zoom_markers
            .iter()
            .filter(|m| m.end_ms > m.start_ms)
            .cloned()
            .collect();
        if !complete.is_empty() {
            if let Some(ref out) = self.output_path {
                let zoom_path = format!("{}.zoom.json", out);
                if let Ok(json) = serde_json::to_string_pretty(&complete) {
                    std::fs::write(&zoom_path, json).ok();
                }
            }
        }

        self.recording_start = None;
        self.state = RecordingState::Idle;
        let path = self.output_path.take().unwrap_or_default();
        Ok(path)
    }

    /// Toggle zoom: first call zooms in at mouse position, second call zooms out.
    pub fn toggle_zoom(&mut self, scale: f64) -> Result<Option<ZoomMarker>, String> {
        if self.state != RecordingState::Recording {
            return Err("Not currently recording".to_string());
        }
        let now_ms = self
            .recording_start
            .map(|s| s.elapsed().as_millis() as u64)
            .unwrap_or(0);

        let (mx, my) = mouse_tracker::get_current_mouse_position();
        // Convert global mouse coordinates to screen-relative by subtracting display origin
        let rel_x = mx - self.screen_origin_x;
        let rel_y = my - self.screen_origin_y;
        let x = (rel_x / self.screen_width as f64 * 100.0).clamp(0.0, 100.0);
        let y = (rel_y / self.screen_height as f64 * 100.0).clamp(0.0, 100.0);

        if self.is_zoomed_in {
            if let Some(last) = self.zoom_markers.last_mut() {
                if last.end_ms == 0 {
                    last.end_ms = now_ms;
                }
            }
            self.is_zoomed_in = false;
            Ok(None)
        } else {
            let marker = ZoomMarker {
                start_ms: now_ms,
                end_ms: 0,
                x,
                y,
                scale,
            };
            self.zoom_markers.push(marker.clone());
            self.is_zoomed_in = true;
            Ok(Some(marker))
        }
    }
}
