use crate::models::{ProjectData, Segment, SilenceConfig};

#[tauri::command]
pub fn create_project(
    name: String,
    width: u32,
    height: u32,
    fps: f64,
) -> Result<ProjectData, String> {
    Ok(crate::editor::project::create_new_project(
        &name, width, height, fps,
    ))
}

#[tauri::command]
pub fn save_project(project: ProjectData, path: String) -> Result<(), String> {
    crate::editor::project::save_project_to_file(&project, &path)
}

#[tauri::command]
pub fn load_project(path: String) -> Result<ProjectData, String> {
    crate::editor::project::load_project_from_file(&path)
}

#[tauri::command]
pub fn detect_silence(
    audio_path: String,
    config: SilenceConfig,
) -> Result<Vec<Segment>, String> {
    crate::editor::silence::detect_silence_regions(&audio_path, &config)
}

/// Detect non-silent segments in a video file – **pure Rust, no Python**.
///
/// This is **non-destructive**: it does NOT create a new video file.
/// It only analyses the audio and returns the speech segments, which
/// the frontend applies to the timeline as clip boundaries.
///
/// The actual video assembly only happens when the user clicks Export.
///
/// Pipeline:
/// 1. Extract audio to a lightweight temp WAV (mono 16 kHz) via FFmpeg.
/// 2. Read the WAV and detect non-silent ranges (pydub-equivalent algorithm).
/// 3. Pad & merge segments.
/// 4. Return the segments — the original file is never touched.
#[tauri::command]
pub fn remove_silence(
    input_path: String,
    threshold_db: f64,
    min_silence_ms: u64,
    padding_ms: u64,
) -> Result<Vec<Segment>, String> {
    // Step 1 – Extract audio to lightweight temp WAV (mono, 16 kHz)
    //          This is ~5× smaller/faster than stereo 44.1 kHz and
    //          perfectly sufficient for silence detection.
    let temp_dir = std::env::temp_dir();
    let temp_wav = temp_dir.join(format!(
        "autoeditor_silence_{}.wav",
        std::process::id()
    ));
    let temp_wav_str = temp_wav
        .to_str()
        .ok_or_else(|| "invalid temp path".to_string())?;
    crate::editor::ffmpeg::extract_audio_to_wav_light(&input_path, temp_wav_str)?;
    // Step 2 – Read WAV and detect non-silent ranges
    let wav = crate::editor::audio::read_wav(temp_wav_str);
    let _ = std::fs::remove_file(&temp_wav); // clean up immediately
    let wav = wav?;
    let total_duration_ms = wav.duration_ms;
    let nonsilent_ranges =
        crate::editor::audio::detect_nonsilent_ranges(&wav, min_silence_ms, threshold_db);
    drop(wav); // free memory
    if nonsilent_ranges.is_empty() {
        return Err("No speech detected — the file appears to be entirely silent".into());
    }
    // Step 3 – Pad ranges & merge overlaps
    let segments = build_padded_segments(&nonsilent_ranges, total_duration_ms, padding_ms);
    if segments.is_empty() {
        return Err("No segments to keep after padding".into());
    }
    // Step 4 – Return segments (no video assembly – that happens on Export)
    Ok(segments)
}

/// Convert raw non-silent `(start_ms, end_ms)` ranges into padded, merged
/// [`Segment`]s – exactly like `autoeditor.py::build_segments`.
fn build_padded_segments(
    ranges: &[(u64, u64)],
    total_duration_ms: u64,
    padding_ms: u64,
) -> Vec<Segment> {
    if ranges.is_empty() {
        return vec![];
    }
    // Add padding
    let padded: Vec<(u64, u64)> = ranges
        .iter()
        .map(|&(s, e)| {
            let ps = s.saturating_sub(padding_ms);
            let pe = (e + padding_ms).min(total_duration_ms);
            (ps, pe)
        })
        .collect();
    // Merge overlapping / adjacent
    let mut merged: Vec<(u64, u64)> = vec![padded[0]];
    for &(s, e) in &padded[1..] {
        let last = merged.last_mut().unwrap();
        if s <= last.1 {
            last.1 = last.1.max(e);
        } else {
            merged.push((s, e));
        }
    }
    merged
        .into_iter()
        .map(|(s, e)| Segment {
            start_ms: s,
            end_ms: e,
        })
        .collect()
}
