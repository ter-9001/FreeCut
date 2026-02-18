use std::process::{Child, Command, Stdio};

/// Camera overlay configuration with percentage-based positioning (used by merge step)
#[derive(Debug, Clone)]
pub struct CameraOverlayConfig {
    /// X position as percentage of screen width (0-100)
    pub x_percent: f64,
    /// Y position as percentage of screen height (0-100)
    pub y_percent: f64,
    /// Width as percentage of screen width (0-100)
    pub width_percent: f64,
    /// Height as percentage of screen height (0-100)
    pub height_percent: f64,
}

/// FFmpeg-based recording encoder for screen + microphone capture.
///
/// Camera is recorded separately by the browser via MediaRecorder and merged
/// in post-processing using `merge_with_camera()`. This avoids camera device
/// conflicts between the browser (preview) and FFmpeg (recording).
pub struct RecordingEncoder {
    ffmpeg_process: Child,
}

impl RecordingEncoder {
    /// Start screen + microphone recording.
    ///
    /// Screen and mic use **separate** avfoundation inputs to ensure audio
    /// data flows reliably (bundling them in one input often drops audio).
    pub fn start(
        output_path: &str,
        screen_idx: Option<&str>,
        mic_idx: Option<&str>,
        fps: u32,
    ) -> Result<Self, String> {
        let mut args: Vec<String> = Vec::new();
        args.push("-y".to_string());

        // ── Input 0: Screen capture (video only) ──
        let screen_part = screen_idx.unwrap_or("none");
        args.extend([
            "-f".to_string(),
            "avfoundation".to_string(),
            "-thread_queue_size".to_string(),
            "1024".to_string(),
            "-framerate".to_string(),
            fps.to_string(),
            "-capture_cursor".to_string(),
            "1".to_string(),
            "-capture_mouse_clicks".to_string(),
            "1".to_string(),
            "-i".to_string(),
            format!("{screen_part}:none"),
        ]);

        // ── Input 1: Microphone (audio only, separate input) ──
        let has_audio = mic_idx.is_some() && mic_idx != Some("none");
        if has_audio {
            let audio_part = mic_idx.unwrap();
            args.extend([
                "-f".to_string(),
                "avfoundation".to_string(),
                "-thread_queue_size".to_string(),
                "1024".to_string(),
                "-i".to_string(),
                format!("none:{audio_part}"),
            ]);
        }

        // ── Explicit stream mapping ──
        if has_audio {
            args.extend([
                "-map".to_string(),
                "0:v".to_string(),
                "-map".to_string(),
                "1:a".to_string(),
            ]);
        }

        // ── Video codec ──
        args.extend([
            "-c:v".to_string(),
            "h264_videotoolbox".to_string(),
            "-b:v".to_string(),
            "12M".to_string(),
            "-maxrate".to_string(),
            "15M".to_string(),
            "-bufsize".to_string(),
            "24M".to_string(),
            "-pix_fmt".to_string(),
            "yuv420p".to_string(),
            "-r".to_string(),
            fps.to_string(),
        ]);

        // ── Audio codec ──
        if has_audio {
            args.extend([
                "-ar".to_string(),
                "48000".to_string(),
                "-ac".to_string(),
                "2".to_string(),
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                "192k".to_string(),
            ]);
        } else {
            args.extend(["-an".to_string()]);
        }

        args.push(output_path.to_string());

        eprintln!("[encoder] FFmpeg args: {:?}", args);

        let child = Command::new("ffmpeg")
            .args(&args)
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn FFmpeg: {e}"))?;

        Ok(Self {
            ffmpeg_process: child,
        })
    }

    /// Gracefully stop recording by sending 'q' to FFmpeg's stdin.
    pub fn stop(mut self) -> Result<(), String> {
        // Send 'q' to FFmpeg to stop recording gracefully
        if let Some(mut stdin) = self.ffmpeg_process.stdin.take() {
            use std::io::Write;
            stdin.write_all(b"q").ok();
            drop(stdin);
        }

        // Read stderr in a background thread to avoid pipe buffer deadlock
        let stderr_handle = self.ffmpeg_process.stderr.take().map(|stderr| {
            std::thread::spawn(move || {
                use std::io::Read;
                let mut output = String::new();
                let mut reader = std::io::BufReader::new(stderr);
                reader.read_to_string(&mut output).ok();
                output
            })
        });

        // Wait for FFmpeg to finish
        match self.ffmpeg_process.wait() {
            Ok(status) => {
                let stderr_output = stderr_handle
                    .and_then(|h| h.join().ok())
                    .unwrap_or_default();

                if !stderr_output.is_empty() {
                    let tail = if stderr_output.len() > 1000 {
                        &stderr_output[stderr_output.len() - 1000..]
                    } else {
                        &stderr_output
                    };
                    eprintln!("[encoder] FFmpeg stderr (last 1000 chars):\n{tail}");
                }

                if status.success() || status.code() == Some(255) {
                    // 255 is normal for 'q' quit
                    Ok(())
                } else {
                    let tail = if stderr_output.len() > 500 {
                        &stderr_output[stderr_output.len() - 500..]
                    } else {
                        &stderr_output
                    };
                    Err(format!(
                        "FFmpeg exited with status: {status}\nFFmpeg output: {tail}"
                    ))
                }
            }
            Err(e) => Err(format!("Failed to wait for FFmpeg: {e}")),
        }
    }

    /// Force-kill the FFmpeg process.
    pub fn kill(&mut self) {
        self.ffmpeg_process.kill().ok();
    }

    /// Probe a video file to get its actual resolution.
    pub fn probe_resolution(path: &str) -> Result<(u32, u32), String> {
        let output = Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=width,height",
                "-of",
                "csv=p=0:s=x",
                path,
            ])
            .output()
            .map_err(|e| format!("ffprobe failed: {e}"))?;

        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let parts: Vec<&str> = stdout.split('x').collect();
        if parts.len() != 2 {
            return Err(format!("Unexpected ffprobe output: '{stdout}'"));
        }

        let w: u32 = parts[0]
            .trim()
            .parse()
            .map_err(|_| format!("Bad width: {}", parts[0]))?;
        let h: u32 = parts[1]
            .trim()
            .parse()
            .map_err(|_| format!("Bad height: {}", parts[1]))?;
        Ok((w, h))
    }

    /// Merge screen recording with camera recording using overlay.
    ///
    /// This is called after both recordings stop. Uses `ffprobe` to detect
    /// the actual screen capture resolution so overlay positioning is exact.
    pub fn merge_with_camera(
        screen_path: &str,
        camera_path: &str,
        output_path: &str,
        overlay: &CameraOverlayConfig,
    ) -> Result<(), String> {
        // Detect actual screen capture resolution (handles retina automatically)
        let (screen_w, screen_h) = Self::probe_resolution(screen_path)?;
        eprintln!(
            "[encoder] Screen capture resolution: {}x{}",
            screen_w, screen_h
        );

        // Calculate pixel positions from percentages (ensure even dimensions)
        let cam_w = ((overlay.width_percent / 100.0 * screen_w as f64) as i32 / 2 * 2).max(2);
        let cam_h = ((overlay.height_percent / 100.0 * screen_h as f64) as i32 / 2 * 2).max(2);
        let cam_x = (overlay.x_percent / 100.0 * screen_w as f64) as i32;
        let cam_y = (overlay.y_percent / 100.0 * screen_h as f64) as i32;

        // Use force_original_aspect_ratio=increase + crop to match CSS object-cover:
        // scales up to fill the bounding box (preserving aspect ratio), then crops overflow.
        let filter = format!(
            "[1:v]scale={cam_w}:{cam_h}:force_original_aspect_ratio=increase,crop={cam_w}:{cam_h}[cam];\
             [0:v][cam]overlay={cam_x}:{cam_y}[vout]"
        );

        let args: Vec<String> = vec![
            "-y".to_string(),
            "-i".to_string(),
            screen_path.to_string(),
            "-i".to_string(),
            camera_path.to_string(),
            "-filter_complex".to_string(),
            filter.clone(),
            "-map".to_string(),
            "[vout]".to_string(),
            "-map".to_string(),
            "0:a?".to_string(),
            "-c:v".to_string(),
            "h264_videotoolbox".to_string(),
            "-b:v".to_string(),
            "12M".to_string(),
            "-c:a".to_string(),
            "copy".to_string(),
            "-shortest".to_string(),
            output_path.to_string(),
        ];

        eprintln!("[encoder] Merge filter: {filter}");
        eprintln!("[encoder] Merge args: {:?}", args);

        let output = Command::new("ffmpeg")
            .args(&args)
            .output()
            .map_err(|e| format!("FFmpeg merge failed to run: {e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let tail = if stderr.len() > 500 {
                &stderr[stderr.len() - 500..]
            } else {
                &stderr
            };
            return Err(format!("FFmpeg merge failed: {tail}"));
        }

        eprintln!("[encoder] Merge completed successfully");
        Ok(())
    }
}
