use crate::models::ExportConfig;
use std::io::BufRead;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};

/// Shared state for the export subsystem.
pub struct ExportManager {
    pub is_exporting: bool,
    pub cancel_flag: Arc<AtomicBool>,
    /// PID of the running FFmpeg child so we can kill it on cancel.
    ffmpeg_pid: Option<u32>,
}

impl ExportManager {
    pub fn new() -> Self {
        Self {
            is_exporting: false,
            cancel_flag: Arc::new(AtomicBool::new(false)),
            ffmpeg_pid: None,
        }
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn start_export(
    config: ExportConfig,
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<ExportManager>>,
) -> Result<(), String> {
    let cancel_flag = {
        let mut mgr = state.lock().map_err(|e| e.to_string())?;
        if mgr.is_exporting {
            return Err("Export already in progress".to_string());
        }
        mgr.is_exporting = true;
        mgr.cancel_flag.store(false, Ordering::SeqCst);
        mgr.cancel_flag.clone()
    };

    // Build the filter graph from the project data
    let graph = crate::editor::ffmpeg::build_export_filter_complex(&config.project);

    // Assemble FFmpeg arguments
    let mut args: Vec<String> = vec!["-y".into()];

    // Add inputs
    for input in &graph.input_paths {
        args.push("-i".into());
        args.push(input.clone());
    }

    // filter_complex
    if !graph.filter_complex.is_empty() {
        args.push("-filter_complex".into());
        args.push(graph.filter_complex.clone());
        args.push("-map".into());
        args.push("[outv]".into());
        if graph.has_audio {
            args.push("-map".into());
            args.push("[outa]".into());
        }
    }

    // Video codec (CRF-based quality)
    args.extend_from_slice(&[
        "-c:v".into(),
        "libx264".into(),
        "-crf".into(),
        config.crf.to_string(),
        "-preset".into(),
        "medium".into(),
        "-r".into(),
        config.fps.to_string(),
        "-s".into(),
        format!("{}x{}", config.width, config.height),
    ]);

    // Audio codec
    if graph.has_audio {
        args.extend_from_slice(&[
            "-c:a".into(),
            "aac".into(),
            "-b:a".into(),
            config.audio_bitrate.clone(),
        ]);
    }

    // Progress reporting via `-progress pipe:1`
    args.push("-progress".into());
    args.push("pipe:1".into());

    // Output path
    args.push(config.output_path.clone());

    // Compute total duration for progress percentage (video tracks only,
    // matching the filter graph which only uses video-track clips).
    let total_duration_sec: f64 = config
        .project
        .tracks
        .iter()
        .filter(|t| !t.muted && !t.locked && t.track_type == "video")
        .flat_map(|t| &t.clips)
        .map(|c| (c.source_end - c.source_start) as f64 / 1000.0)
        .sum();

    // Clone the AppHandle – it is Send+Sync so we can use it from a thread
    let app_handle = app.clone();

    // Spawn export on a background thread
    std::thread::spawn(move || {
        let result = run_export(args, cancel_flag.clone(), total_duration_sec, &app_handle);

        // Update manager state via AppHandle (scoped to drop the borrow)
        {
            let export_state: tauri::State<'_, Mutex<ExportManager>> = app_handle.state();
            if let Ok(mut mgr) = export_state.lock() {
                mgr.is_exporting = false;
                mgr.ffmpeg_pid = None;
            };
        }

        // Emit completion / error event
        match result {
            Ok(()) => {
                app_handle
                    .emit(
                        "export-progress",
                        serde_json::json!({
                            "percent": 100,
                            "done": true,
                            "error": null,
                        }),
                    )
                    .ok();
            }
            Err(e) => {
                app_handle
                    .emit(
                        "export-progress",
                        serde_json::json!({
                            "percent": 0,
                            "done": true,
                            "error": e,
                        }),
                    )
                    .ok();
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn cancel_export(
    state: tauri::State<'_, Mutex<ExportManager>>,
) -> Result<(), String> {
    let mgr = state.lock().map_err(|e| e.to_string())?;
    if !mgr.is_exporting {
        return Err("No export in progress".to_string());
    }
    mgr.cancel_flag.store(true, Ordering::SeqCst);

    // Kill FFmpeg process if we know its PID
    if let Some(pid) = mgr.ffmpeg_pid {
        unsafe {
            libc_kill(pid as i32);
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Export runner (background thread)
// ---------------------------------------------------------------------------

fn run_export(
    args: Vec<String>,
    cancel: Arc<AtomicBool>,
    total_duration_sec: f64,
    app: &tauri::AppHandle,
) -> Result<(), String> {
    let mut child = Command::new("ffmpeg")
        .args(&args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped()) // progress output goes here
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn ffmpeg: {e}"))?;

    // Read `-progress` output from stdout line by line
    let stdout = child.stdout.take().ok_or("no stdout".to_string())?;
    let reader = std::io::BufReader::new(stdout);

    for line in reader.lines() {
        if cancel.load(Ordering::Relaxed) {
            child.kill().ok();
            return Err("Export cancelled".to_string());
        }

        let line = match line {
            Ok(l) => l,
            Err(_) => break,
        };

        if let Some(secs) = crate::editor::ffmpeg::parse_ffmpeg_progress(&line) {
            let percent = if total_duration_sec > 0.0 {
                ((secs / total_duration_sec) * 100.0).min(99.0) as u32
            } else {
                0
            };
            app.emit(
                "export-progress",
                serde_json::json!({
                    "percent": percent,
                    "done": false,
                    "error": null,
                }),
            )
            .ok();
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("ffmpeg wait: {e}"))?;

    if cancel.load(Ordering::Relaxed) {
        return Err("Export cancelled".to_string());
    }

    if !status.success() {
        if let Some(mut stderr) = child.stderr.take() {
            let mut buf = String::new();
            use std::io::Read;
            stderr.read_to_string(&mut buf).ok();
            return Err(format!("FFmpeg exited with {status}: {buf}"));
        }
        return Err(format!("FFmpeg exited with {status}"));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Minimal libc helper (avoid pulling in the full `libc` crate)
// ---------------------------------------------------------------------------

unsafe fn libc_kill(pid: i32) {
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    kill(pid, 15); // SIGTERM
}
