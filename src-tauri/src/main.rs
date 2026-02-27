/*
 * Copyright (C) 2026  Gabriel Martins Nunes
 * * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */


use std::fs;
use std::path::PathBuf;

use tauri::command;
use std::process::Command;

use std::thread;
use std::fs::File;
use tiny_http::{Server, Response, Header};
use std::io::{Read, Seek, SeekFrom};

use std::path::Path;


//use tauri::std::process::Command;
use tauri_plugin_shell::ShellExt;
use tauri::Manager;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};



use std::process::Child;
use std::sync::Mutex;
use tauri::State;

use tauri::AppHandle;
use tauri_plugin_shell::process::CommandChild;



//  Updated state to hold the Tauri Sidecar CommandChild
pub struct ExportState(pub Mutex<Option<CommandChild>>);


#[derive(serde::Serialize)]
struct Project {
    name: String,
    path: String
}


#[derive(serde::Serialize)]
pub struct VideoMetadata {
    duration: f64,
}

use serde::{Deserialize, Serialize};

//  Struct to represent the Timeline Clips from Frontend
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Clip {
    pub id: String,
    pub name: String,
    pub path: String,
    pub start: f64,
    pub duration: f64,
    pub beginmoment: f64,
    pub trackId: String,
    #[serde(rename = "type")]
    pub clip_type: String,
}


#[tauri::command]
async fn export_video_old(
    app_handle: AppHandle,
    state: State<'_, ExportState>,
    export_path: String,
    clips: Vec<Clip>,
) -> Result<(), String> {
    // Set total duration max => start+ duration
    let total_duration = clips.iter()
        .map(|c| c.start + c.duration)
        .fold(0.0f64, |a, b| a.max(b));

    // filter string
    let filter_complex = build_rendering_filter(&clips, total_duration);

    let mut args = Vec::new();
    for clip in &clips {
        let path_lower = clip.path.to_lowercase();
        
        if path_lower.ends_with(".png") || path_lower.ends_with(".jpg") || path_lower.ends_with(".jpeg") {
            args.push("-loop".to_string());
            args.push("1".to_string());
            args.push("-t".to_string());
            args.push((total_duration + 1.0).to_string());
        }
        
        args.push("-i".to_string());
        args.push(clip.path.clone());
    }

    args.extend([
        "-loglevel".to_string(), "error".to_string(),
        "-filter_complex".to_string(), filter_complex,
        "-map".to_string(), "[outv]".to_string(),
        "-map".to_string(), "[outa]".to_string(),
        "-c:v".to_string(), "libx264".to_string(),
        "-preset".to_string(), "ultrafast".to_string(),
        "-c:a".to_string(), "aac".to_string(),
        "-b:a".to_string(), "192k".to_string(),
        "-pix_fmt".to_string(), "yuv420p".to_string(),
        "-t".to_string(), total_duration.to_string(), 
        "-y".to_string(), export_path
    ]);

    // Debug para o console
    //println!("--- Comando FFmpeg Executado ---");
    //println!("ffmpeg {}", args.join(" "));

    // 5. Executar o Sidecar do Tauri
    let (mut rx, child) = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("FFmpeg sidecar não encontrado: {}", e))?
        .args(args)
        .spawn()
        .map_err(|e| format!("Falha ao iniciar FFmpeg: {}", e))?;

    {
        let mut lock = state.0.lock().unwrap();
        *lock = Some(child);
    }

    while let Some(event) = rx.recv().await {
        match event {
            tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                let mut lock = state.0.lock().unwrap();
                *lock = None;

                if payload.code == Some(0) {
                    return Ok(());
                } else {
                    return Err(format!("FFmpeg falhou com código: {:?}", payload.code));
                }
            }
            _ => {} 
        }
    }

    Err("O processo de exportação terminou inesperadamente".into())
}



#[tauri::command]
async fn export_video(
    app_handle: AppHandle,
    state: State<'_, ExportState>,
    export_path: String,
    clips: Vec<Clip>,
) -> Result<(), String> {
    // Set total duration max => start+ duration
    let total_duration = clips.iter()
        .map(|c| c.start + c.duration)
        .fold(0.0f64, |a, b| a.max(b));

    // filter string
    let filter_complex = build_rendering_filter(&clips, total_duration);

    let mut args = Vec::new();
    for clip in &clips {
        let path_lower = clip.path.to_lowercase();
        
        if path_lower.ends_with(".png") || path_lower.ends_with(".jpg") || path_lower.ends_with(".jpeg") {
            args.push("-loop".to_string());
            args.push("1".to_string());
            args.push("-t".to_string());
            args.push((total_duration + 1.0).to_string());
        }
        
        args.push("-i".to_string());
        args.push(clip.path.clone());
    }

    args.extend([
        "-filter_complex".to_string(), filter_complex,
        "-map".to_string(), "[outv]".to_string(),
        "-map".to_string(), "[outa]".to_string(),
        "-c:v".to_string(), "libx264".to_string(),
        "-preset".to_string(), "ultrafast".to_string(),
        "-c:a".to_string(), "aac".to_string(),
        "-b:a".to_string(), "192k".to_string(),
        "-pix_fmt".to_string(), "yuv420p".to_string(),
        "-t".to_string(), total_duration.to_string(), 
        "-y".to_string(), export_path
    ]);

    // Debug para o console
    //println!("--- Comando FFmpeg Executado ---");
    //println!("ffmpeg {}", args.join(" "));

    // 5. Executar o Sidecar do Tauri
    let (mut rx, child) = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("FFmpeg sidecar não encontrado: {}", e))?
        .args(args)
        .spawn()
        .map_err(|e| format!("Falha ao iniciar FFmpeg: {}", e))?;

    {
        let mut lock = state.0.lock().unwrap();
        *lock = Some(child);
    }

    
    while let Some(event) = rx.recv().await {
        match event {
            tauri_plugin_shell::process::CommandEvent::Stderr(line_bytes) => {
                let line = String::from_utf8_lossy(&line_bytes);
                // [English Comment] FFmpeg output: "time=00:00:10.50"
                if line.contains("time=") {
                    if let Some(time_part) = line.split("time=").last().and_then(|s| s.split_whitespace().next()) {
                        let hms: Vec<&str> = time_part.split(':').collect();
                        if hms.len() == 3 {
                            let hours: f64 = hms[0].parse().unwrap_or(0.0);
                            let mins: f64 = hms[1].parse().unwrap_or(0.0);
                            let secs: f64 = hms[2].parse().unwrap_or(0.0);
                            let current_seconds = hours * 3600.0 + mins * 60.0 + secs;
                            
                            let percentage = ((current_seconds / total_duration) * 100.0).min(100.0) as u32;
                            // [English Comment] Emit progress to Frontend
                            let _ = app_handle.emit("export-progress", percentage);
                        }
                    }
                }
            }
            tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                let mut lock = state.0.lock().unwrap();
                *lock = None;
                if payload.code == Some(0) { 
                    let _ = app_handle.emit("export-progress", 100);
                    return Ok(()); 
                }
                else { return Err(format!("FFmpeg error: {:?}", payload.code)); }
            }
            _ => {}
        }
    }
    Ok(())

    //Err("O processo de exportação terminou inesperadamente".into())
}


use tauri::Emitter; // Adicione este import no topo

#[tauri::command]
async fn export_video_ai(
    app_handle: AppHandle,
    state: State<'_, ExportState>,
    export_path: String,
    clips: Vec<Clip>,
) -> Result<(), String> {
    // [English Comment] Calculate total duration for progress percentage
    let total_duration = clips.iter()
        .map(|c| c.start + c.duration)
        .fold(0.0, f64::max);

    let filter_complex = build_rendering_filter(&clips, total_duration);
    let mut args = Vec::new();
    for clip in &clips {
        args.push("-i".to_string());
        args.push(clip.path.clone());
    }

    // [English Comment] Add '-progress pipe:2' to get machine-readable progress in stderr
    args.extend([
        "-filter_complex".to_string(), filter_complex,
        "-map".to_string(), "[outv]".to_string(),
        "-c:v".to_string(), "libx264".to_string(),
        "-preset".to_string(), "ultrafast".to_string(),
        "-pix_fmt".to_string(), "yuv420p".to_string(),
        "-y".to_string(), export_path,
    ]);

    let (mut rx, child) = app_handle.shell().sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args(args)
        .spawn()
        .map_err(|e| e.to_string())?;

    {
        let mut lock = state.0.lock().unwrap();
        *lock = Some(child);
    }

    while let Some(event) = rx.recv().await {
        match event {
            tauri_plugin_shell::process::CommandEvent::Stderr(line_bytes) => {
                let line = String::from_utf8_lossy(&line_bytes);
                // [English Comment] FFmpeg output: "time=00:00:10.50"
                if line.contains("time=") {
                    if let Some(time_part) = line.split("time=").last().and_then(|s| s.split_whitespace().next()) {
                        let hms: Vec<&str> = time_part.split(':').collect();
                        if hms.len() == 3 {
                            let hours: f64 = hms[0].parse().unwrap_or(0.0);
                            let mins: f64 = hms[1].parse().unwrap_or(0.0);
                            let secs: f64 = hms[2].parse().unwrap_or(0.0);
                            let current_seconds = hours * 3600.0 + mins * 60.0 + secs;
                            
                            let percentage = ((current_seconds / total_duration) * 100.0).min(100.0) as u32;
                            // [English Comment] Emit progress to Frontend
                            let _ = app_handle.emit("export-progress", percentage);
                        }
                    }
                }
            }
            tauri_plugin_shell::process::CommandEvent::Terminated(payload) => {
                let mut lock = state.0.lock().unwrap();
                *lock = None;
                if payload.code == Some(0) { 
                    let _ = app_handle.emit("export-progress", 100);
                    return Ok(()); 
                }
                else { return Err(format!("FFmpeg error: {:?}", payload.code)); }
            }
            _ => {}
        }
    }
    Ok(())
}

fn build_rendering_filter(clips: &[Clip], total_duration: f64) -> String {
    let mut filters = Vec::new();
    let mut video_outputs = Vec::new();
    let mut audio_outputs = Vec::new();

    // center video in 1920x1080 
    let centering_filter = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2";

    for (i, clip) in clips.iter().enumerate() {
        let path_lower = clip.path.to_lowercase();
        let is_image = path_lower.ends_with(".png") || path_lower.ends_with(".jpg") || path_lower.ends_with(".jpeg");
        let has_video = is_image || path_lower.ends_with(".mp4") || path_lower.ends_with(".mkv") || path_lower.ends_with(".mov") || path_lower.ends_with(".avi");
        
        // --- Process video/image ---
        if has_video {
            if is_image {
                // Images use setpoints to position themselves at time 'start'.
                filters.push(format!(
                    "[{}:v]{},setpts=PTS-STARTPTS+{}/TB[v{}]",
                    i, centering_filter, clip.start, i
                ));
            } else {
                // Videos use trim (internal cut) and setpoints (positioning on the timeline).
                filters.push(format!(
                    "[{}:v]trim=start={}:duration={},{},setpts=PTS-STARTPTS+{}/TB[v{}]",
                    i, clip.beginmoment, clip.duration, centering_filter, clip.start, i
                ));
            }
            video_outputs.push((i, clip.start, clip.duration));
        }

        // --- Audio Processing ---
        // If it's not an image, we try to extract and align the audio.
        if !is_image {
            let delay_ms = (clip.start * 1000.0) as i64;
            // Atrim cuts the original audio, delay pushes it to the correct time on the timeline.
            filters.push(format!(
                "[{}:a]atrim=start={}:duration={},adelay={}|{}[a{}]",
                i, clip.beginmoment, clip.duration, delay_ms, delay_ms, i
            ));
            audio_outputs.push(format!("[a{}]", i));
        }
    }

    // --- Final Video Layer ---
    // Creates a black background with the exact duration of the project
    filters.push(format!("color=s=1920x1080:c=black:r=30:d={}[bg]", total_duration));
    
    let mut current_v_layer = "bg".to_string();
    for (idx, (input_idx, start, duration)) in video_outputs.iter().enumerate() {
        let next_v_layer = if idx == video_outputs.len() - 1 { "outv_pre".to_string() } else { format!("l{}", idx) };
        filters.push(format!(
            "[{}] [v{}] overlay=enable='between(t,{},{})' [ {} ]",
            current_v_layer, input_idx, start, start + duration, next_v_layer
        ));
        current_v_layer = next_v_layer;
    }
    filters.push(format!("[{}]format=yuv420p[outv]", current_v_layer));

    // --- Final Audio Layer ---
    if audio_outputs.is_empty() {
        filters.push(format!("anullsrc=r=44100:cl=stereo:d={}[outa]", total_duration));
    } else {
        let n = audio_outputs.len();
        filters.push(format!(
            "{}amix=inputs={}:duration=longest[outa]",
            audio_outputs.join(""),
            n
        ));
    }

    filters.join(";")
}




#[tauri::command]
async fn cancel_export(state: State<'_, ExportState>) -> Result<(), String> {
    let mut lock = state.0.lock().unwrap();
    if let Some(child) = lock.take() {
        //  Kill the Tauri Sidecar process
        child.kill().map_err(|e| format!("Failed to kill process: {}", e))?;
    }
    Ok(())
}

#[tauri::command]
async fn generate_thumbnail(
    app_handle: tauri::AppHandle,
    project_path: String,
    file_name: String,
    time_seconds: f64
) -> Result<String, String> {

    let thumbnail_folder = std::path::Path::new(&project_path).join("thumbnails");
    
    // Create folder if does not exist
    if !thumbnail_folder.exists() {
        std::fs::create_dir_all(&thumbnail_folder).map_err(|e| e.to_string())?;
    }
    // Paths based on project structure
    let video_path = PathBuf::from(&project_path).join("videos").join(&file_name);
    let output_name = format!("{}-{}.png", file_name, time_seconds);
    let output_path = PathBuf::from(&project_path).join("thumbnails").join(&output_name);

    // If the thumbnail already exists, skip generation to save resources
    if output_path.exists() {
        return Ok(output_path.to_string_lossy().into_owned());
    }

    // Execute FFmpeg Sidecar
    // -ss: fast seek to timestamp / -i: input / -frames:v 1: capture one frame / -q:v 2: quality level
    let sidecar_command = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args([
            "-ss", &time_seconds.to_string(), // Seek to specific time
            "-i", &video_path.to_string_lossy(), // Input source
            "-frames:v", "1", // Grab exactly 1 frame
            "-update", "1",   // ESSENTIAL: Specifies a single image output rather than a sequence
            "-y",             // Overwrite if exists (prevents hanging on prompts)
            &output_path.to_string_lossy(), // Output path
        ]);

    let output = sidecar_command.output().await.map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(output_path.to_string_lossy().into_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}



fn build_complex_filter(clips: &[Clip]) -> String {
    let mut filters = Vec::new();
    let mut inputs = Vec::new();

    for (i, clip) in clips.iter().enumerate() {
        // Trim the source file and reset timestamps to the timeline start
        // [vX] represents the video stream of the current clip
        let filter = format!(
            "[{}:v]trim=start={}:duration={},setpts=PTS-STARTPTS+{}/TB[v{}]",
            i, clip.beginmoment, clip.duration, clip.start, i
        );
        filters.push(filter);
        inputs.push(format!("[v{}]", i));
    }

    // Merge all video streams into one using overlay or concat
    // For simple linear editing, we use concat. For tracks, we would use overlay.
    let concat = format!("{}concat=n={}:v=1:a=0[outv]", inputs.join(""), clips.len());
    filters.push(concat);

    filters.join(";")
}



//  Build the FFmpeg filter graph based on track priority




// Helper function to wait for the process stored in State
/*

async fn wait_for_process(state: State<'_, ExportState>) -> Result<(), String> {
    loop {
        {
            let mut lock = state.0.lock().unwrap();
            if let Some(mut child) = lock.take() {
                // Check if it finished
                match child.try_wait() {
                    Ok(Some(status)) => {
                        if status.success() { return Ok(()); }
                        else { return Err("FFmpeg failed".into()); }
                    }
                    Ok(None) => {
                        // Still running, put it back so cancel_export can kill it
                        *lock = Some(child);
                    }
                    Err(e) => return Err(e.to_string()),
                }
            } else {
                // If None, it means cancel_export was called and took the child
                return Err("Export cancelled".into());
            }
        }
        // Wait a bit before checking again to save CPU
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
}

*/

#[tauri::command]
fn list_project_files(project_path: String) -> Result<Vec<String>, String> {
    let paths = fs::read_dir(project_path).map_err(|e| e.to_string())?;
    let mut files: Vec<String> = paths
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".project"))
        .collect();
    files.sort(); // Sort by name (timestamp-based sorting)
    Ok(files)
}

#[tauri::command]
fn read_specific_file(project_path: String, file_name: String) -> Result<String, String> {
    let mut path = PathBuf::from(project_path);
    path.push(file_name);
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_project_data(project_path: String, data: String, timestamp: u64) -> Result<(), String> {
    let mut path = PathBuf::from(&project_path);
    let filename = format!("main{}.project", timestamp);
    path.push(filename);

    // 1. Write the new file
    fs::write(&path, data).map_err(|e| e.to_string())?;

    // 2. Clean up old files (Keep only the 50,000 newest)
    let paths = fs::read_dir(&project_path).map_err(|e| e.to_string())?;
    let mut project_files: Vec<_> = paths
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("project"))
        .collect();

    // Sort by name (which includes timestamp)
    project_files.sort();

    // If we exceed the limit, delete the oldest ones
    let limit = 50000;
    if project_files.len() > limit {
        let to_delete = project_files.len() - limit;
        for i in 0..to_delete {
            let _ = fs::remove_file(&project_files[i]);
        }
    }

    Ok(())
}

// Function to load the last saved state of the project
#[tauri::command]
fn load_latest_project(project_path: String) -> Result<String, String> {
    let paths = fs::read_dir(project_path).map_err(|e| e.to_string())?;
    
    // Filter files ending with .project and find the one with the highest timestamp in name
    let mut project_files: Vec<_> = paths
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|s| s.to_str()) == Some("project"))
        .collect();

    project_files.sort(); // Sorts alphabetically/numerically
    
    if let Some(latest) = project_files.last() {
        fs::read_to_string(latest).map_err(|e| e.to_string())
    } else {
        Err("No project file found".into())
    }
}

#[tauri::command]
fn load_specific_project(project_path: String, file_name: String) -> Result<String, String> {
    // 1. Construct the full path: project_path/file_name
    let mut path = PathBuf::from(&project_path);
    path.push(&file_name);

    // 2. Validate that the file exists and is indeed a file
    if !path.exists() {
        return Err(format!("File not found: {}", file_name));
    }

    // 3. Read content and return as String (JSON)
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn download_youtube_video(project_path: String, url: String) -> Result<String, String> {
    let mut download_path = std::path::PathBuf::from(&project_path);
    download_path.push("videos");

    let output = Command::new("yt-dlp")
        .args([
            "--no-check-certificate",
            "--prefer-free-formats",
            "--add-header", "User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
            "--merge-output-format", "mp4",
            "-o", &format!("{}/%(title)s.%(ext)s", download_path.to_string_lossy()),
            &url,
        ])
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp: {}", e))?;

    if output.status.success() {
        Ok("Download completed successfully".into())
    } else {
        let err = String::from_utf8_lossy(&output.stderr);
        Err(format!("yt-dlp error: {}", err))
    }
}

#[tauri::command]
async fn import_asset(project_path: String, file_path: String) -> Result<String, String> {
    let source = PathBuf::from(&file_path);
    let filename = source.file_name().ok_or("Invalid file name")?;
    
    let mut target = PathBuf::from(&project_path);
    target.push("videos");
    target.push(filename);

    fs::copy(&source, &target).map_err(|e| e.to_string())?;
    
    Ok(filename.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_assets(project_path: String) -> Result<Vec<String>, String> {
    let mut videos_path = PathBuf::from(project_path);
    videos_path.push("videos");

    let mut assets = Vec::new();
    if let Ok(entries) = fs::read_dir(videos_path) {
        for entry in entries.flatten() {
            if entry.path().is_file() {
                assets.push(entry.file_name().to_string_lossy().into_owned());
            }
        }
    }
    Ok(assets)
}

#[tauri::command]
fn create_project_folder(root_path: String, project_name: String) -> Result<String, String> {
    let mut path = std::path::PathBuf::from(root_path);
    path.push(&project_name);

    if path.exists() {
        // Return a specific error if folder already exists
        return Err("PROJECT_EXISTS".into());
    }

    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    std::fs::create_dir(path.join("videos")).map_err(|e| e.to_string())?;
    std::fs::create_dir(path.join("exports")).map_err(|e| e.to_string())?;

    Ok(path.to_string_lossy().into_owned())
}

#[tauri::command]
fn list_projects(root_path: String) -> Result<Vec<Project>, String> {
    let mut projects = Vec::new();
    let paths = fs::read_dir(root_path).map_err(|e| e.to_string())?;

    for path in paths {
        if let Ok(entry) = path {
            if entry.path().is_dir() {
                projects.push(Project {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    path: entry.path().to_string_lossy().into_owned(),
                });
            }
        }
    }
    Ok(projects)
}

#[tauri::command]
fn delete_project(path: String) -> Result<(), String> {
    let project_path = std::path::PathBuf::from(path);
    if project_path.exists() && project_path.is_dir() {
        std::fs::remove_dir_all(project_path).map_err(|e| e.to_string())?;
        Ok(())
    } else {
        Err("Project folder not found".into())
    }
}

#[tauri::command]
fn rename_file(old_path: String, new_path: String) -> Result<(), String> {
    fs::rename(old_path, new_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    // We use PathBuf for consistency with other functions like 'import_asset'
    let path_buf = std::path::PathBuf::from(&path);

    // 1. Safety checks
    if !path_buf.exists() {
        return Err("File path not found".to_string());
    }

    if !path_buf.is_file() {
        return Err("The provided path is not a file".to_string());
    }

    // 2. Execute deletion
    fs::remove_file(path_buf).map_err(|e| format!("Failed to delete file: {}", e))?;

    Ok(())
}

#[command]
async fn get_video_metadata(path: String) -> Result<VideoMetadata, String> {
    // Command: ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 path
    let output = Command::new("ffprobe")
        .args([
            "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            &path,
        ])
        .output()
        .map_err(|e| e.to_string())?;

    let duration_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let duration = duration_str.parse::<f64>().map_err(|_| "Failed to parse duration")?;

    Ok(VideoMetadata { duration })
}

use opencv::{prelude::*, videoio, core, imgcodecs};
use base64::{engine::general_purpose, Engine as _};

#[tauri::command]
async fn get_video_frame(path: String, time_ms: f64) -> Result<String, String> {
    let mut cam = videoio::VideoCapture::from_file(&path, videoio::CAP_ANY)
        .map_err(|e| e.to_string())?;
    
    // Move the video seek pointer to the desired millisecond
    cam.set(videoio::CAP_PROP_POS_MSEC, time_ms).map_err(|e| e.to_string())?;
    
    let mut frame = core::Mat::default();
    if cam.read(&mut frame).map_err(|e| e.to_string())? {
        let mut buffer = core::Vector::<u8>::new();
        imgcodecs::imencode(".jpg", &frame, &mut buffer, &core::Vector::default()).map_err(|e| e.to_string())?;
        
        let b64 = general_purpose::STANDARD.encode(buffer.as_slice());
        Ok(format!("data:image/jpeg;base64,{}", b64))
    } else {
        Err("Unable to read the video frame".into())
    }
}

#[tauri::command]
async fn extract_audio(project_path: String, file_name: String) -> Result<String, String> {
    let video_path = Path::new(&project_path).join("videos").join(&file_name);
    let output_folder = Path::new(&project_path).join("extracted_audios");
    
    // Create directory if it doesn't exist
    if !output_folder.exists() {
        fs::create_dir_all(&output_folder).map_err(|e| e.to_string())?;
    }

    // Output filename will be the same as input, but with .mp3 extension (for compatibility)
    let audio_file_name = format!("{}.mp3", Path::new(&file_name).file_stem().unwrap().to_str().unwrap());
    let output_path = output_folder.join(&audio_file_name);

    // If audio is already extracted, skip to improve performance
    if output_path.exists() {
        return Ok(audio_file_name);
    }

    // FFmpeg Command: -i (input), -vn (no video), -acodec libmp3lame (audio codec)
    let status = Command::new("ffmpeg")
        .arg("-i")
        .arg(&video_path)
        .arg("-vn")
        .arg("-acodec")
        .arg("libmp3lame")
        .arg("-q:a")
        .arg("2") // High quality setting
        .arg(&output_path)
        .output()
        .map_err(|e| e.to_string())?;

    if status.status.success() {
        Ok(audio_file_name)
    } else {
        let error = String::from_utf8_lossy(&status.stderr);
        Err(format!("Error extracting audio: {}", error))
    }
}


#[tauri::command]
async fn get_waveform_data(path: String, samples: usize) -> Result<Vec<f32>, String> {
    // Use ffmpeg to read audio and output raw data (f32)
    let output = Command::new("ffmpeg")
        .args([
            "-i", &path,
            "-ar", "8000",       // Reduce sample rate to 8kHz (sufficient for waveform visualization)
            "-ac", "1",          // Convert to Mono
            "-f", "f32le",       // Format as Float 32-bit Little Endian
            "-",                 // Direct output to stdout
        ])
        .output()
        .map_err(|e| e.to_string())?;

    let bytes = output.stdout;
    let f32_data: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes(chunk.try_into().unwrap()))
        .collect();

    if f32_data.is_empty() { return Ok(vec![]); }

    // Downsample the array to the desired number of 'samples' (e.g., 100 peaks per clip)
    let chunk_size = f32_data.len() / samples;
    let mut peaks = Vec::new();
    
    for chunk in f32_data.chunks(chunk_size.max(1)) {
        // Calculate the absolute peak value for the current chunk
        let max = chunk.iter().fold(0.0f32, |a, &b| a.max(b.abs()));
        peaks.push(max);
    }

    Ok(peaks)
}




fn main() {
    thread::spawn(move || {
    let server = Server::http("127.0.0.1:1234").unwrap();
    for request in server.incoming_requests() {
        let url = request.url().trim_start_matches('/');
        let decoded_path = percent_encoding::percent_decode_str(url).decode_utf8_lossy().into_owned();
        let path = Path::new(&decoded_path);

        if path.exists() && path.is_file() {
            let mut file = File::open(&path).unwrap();
            let metadata = file.metadata().unwrap();
            let file_size = metadata.len();

            // Lógica de Range Header
            let range_header = request.headers().iter()
                .find(|h| h.field.as_str().to_ascii_lowercase() == "range")
                .map(|h| h.value.as_str());

            let mut response = if let Some(range) = range_header {
                // Parse range: "bytes=start-end"
                let range = range.replace("bytes=", "");
                let parts: Vec<&str> = range.split('-').collect();
                let start = parts[0].parse::<u64>().unwrap_or(0);
                let end = if parts.len() > 1 && !parts[1].is_empty() {
                    parts[1].parse::<u64>().unwrap_or(file_size - 1)
                } else {
                    file_size - 1
                };

                let length = end - start + 1;
                file.seek(SeekFrom::Start(start)).unwrap();
                let mut buffer = vec![0; length as usize];
                file.read_exact(&mut buffer).unwrap();

                let mut res = Response::from_data(buffer).with_status_code(206);
                res.add_header(Header::from_bytes(&b"Content-Range"[..], 
                    format!("bytes {}-{}/{}", start, end, file_size).as_bytes()).unwrap());
                res
            } else {
                let mut buffer = Vec::new();
                file.read_to_end(&mut buffer).unwrap();
                Response::from_data(buffer).with_status_code(200)
            };

            // Headers Obrigatórios
            response.add_header(Header::from_bytes(&b"Content-Type"[..], &b"audio/mpeg"[..]).unwrap());
            response.add_header(Header::from_bytes(&b"Access-Control-Allow-Origin\""[..], &b"*"[..]).unwrap());
            response.add_header(Header::from_bytes(&b"Accept-Ranges"[..], &b"bytes"[..]).unwrap());

            let _ = request.respond(response);
        } else {
            let _ = request.respond(Response::from_string("Not Found").with_status_code(404));
        }
    }
});

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init()) // Dialog plugin for system file pickers
        // Custom protocol for serving local video files with range-request support
        .manage(ExportState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            create_project_folder, 
            list_projects, 
            delete_project, 
            import_asset, 
            list_assets, 
            download_youtube_video, 
            load_latest_project, 
            save_project_data,
            list_project_files, 
            read_specific_file, 
            load_specific_project, 
            rename_file, 
            get_video_metadata, 
            generate_thumbnail, 
            delete_file, 
            get_video_frame, 
            extract_audio, 
            get_waveform_data,
            export_video,
            cancel_export
           
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}