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


#[derive(serde::Serialize)]
struct Project {
    name: String,
    path: String
}


#[derive(serde::Serialize)]
pub struct VideoMetadata {
    duration: f64,
}

use tauri_plugin_shell::ShellExt;


#[tauri::command]
async fn generate_thumbnail(
    app_handle: tauri::AppHandle,
    project_path: String,
    file_name: String,
    time_seconds: f64
) -> Result<String, String> {
    // Caminhos conforme sua estrutura
    let video_path = PathBuf::from(&project_path).join("videos").join(&file_name);
    let output_name = format!("{}-{}.png", file_name, time_seconds);
    let output_path = PathBuf::from(&project_path).join("thumbnails").join(&output_name);

    // Se a thumbnail já existir, não precisa gerar de novo
    if output_path.exists() {
        return Ok(output_path.to_string_lossy().into_owned());
    }

    // Executa o Sidecar FFmpeg
    // -ss: busca rápida pelo tempo / -i: input / -frames:v 1: tira um print / -q:v 2: qualidade
    let sidecar_command = app_handle
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| e.to_string())?
        .args([
            "-ss", &time_seconds.to_string(), // Busca o tempo
            "-i", &video_path.to_string_lossy(), // Input
            "-frames:v", "1", // Apenas 1 frame
            "-update", "1",   // ESSENCIAL: Diz que é uma imagem única, não uma sequência
            "-y",             // Sobrescreve se já existir (opcional, mas evita travamentos)
            &output_path.to_string_lossy(), // Caminho de saída
        ]);

    let output = sidecar_command.output().await.map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(output_path.to_string_lossy().into_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).into_owned())
    }
}

#[tauri::command]
async fn export_video(app_handle: tauri::AppHandle, name: String ,output_path: String, filter_complex: String) -> Result<String, String> {
    // Busca o binário do ffmpeg que configuramos no sidecar

    let filename = format!("{}.mp4", name);
    let sidecar_command = app_handle
        .shell()
        .sidecar("ffmpeg")
        .unwrap()
        .args(["-i",&filename, "-filter_complex", &filter_complex, &output_path]);

    let (mut _rx, mut _child) = sidecar_command
        .spawn()
        .map_err(|e| e.to_string())?;

    Ok("Render Beggin".into())
}



#[tauri::command]
fn list_project_files(project_path: String) -> Result<Vec<String>, String> {
    let paths = fs::read_dir(project_path).map_err(|e| e.to_string())?;
    let mut files: Vec<String> = paths
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.ends_with(".project"))
        .collect();
    files.sort(); // Sort by timestamp in name
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


//function to load that last state of project
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
    // 1. Constrói o caminho completo: project_path/file_name
    let mut path = PathBuf::from(&project_path);
    path.push(&file_name);

    // 2. Verifica se o arquivo existe e é um arquivo de verdade
    if !path.exists() {
        return Err(format!("Arquivo não encontrado: {}", file_name));
    }

    // 3. Lê o conteúdo e retorna como String (JSON)
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
    // Usamos PathBuf para consistência com suas outras funções como 'import_asset'
    let path_buf = std::path::PathBuf::from(&path);

    // 1. Verificações de segurança
    if !path_buf.exists() {
        return Err("File path not found".to_string());
    }

    if !path_buf.is_file() {
        return Err("The provided path is not a file".to_string());
    }

    // 2. Execução da deleção
    fs::remove_file(path_buf).map_err(|e| format!("Failed to delete file: {}", e))?;

    Ok(())
}



#[command]
async fn get_video_metadata(path: String) -> Result<VideoMetadata, String> {

// Comando: ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 path

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



fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init()) // Inicializa o plugin de diálogo
        .register_uri_scheme_protocol("stream", |_app, request| {
            use std::io::{Read, Seek, SeekFrom};
            use tauri::http::Response;

            let uri = request.uri().to_string();
            // URL format: stream://localhost/<encoded_path>
            let path = uri
                .strip_prefix("stream://localhost/")
                .or_else(|| uri.strip_prefix("stream://localhost"))
                .unwrap_or("");
            let path = percent_encoding::percent_decode_str(path)
                .decode_utf8_lossy()
                .into_owned();
            // Ensure leading slash on macOS
            let path = if !path.starts_with('/') {
                format!("/{path}")
            } else {
                path
            };

            let mime = if path.ends_with(".mp4") || path.ends_with(".m4v") {
                "video/mp4"
            } else if path.ends_with(".mov") {
                "video/quicktime"
            } else if path.ends_with(".webm") {
                "video/webm"
            } else if path.ends_with(".mkv") {
                "video/x-matroska"
            } else if path.ends_with(".wav") {
                "audio/wav"
            } else if path.ends_with(".mp3") {
                "audio/mpeg"
            } else if path.ends_with(".aac") || path.ends_with(".m4a") {
                "audio/aac"
            } else if path.ends_with(".png") {
                "image/png"
            } else if path.ends_with(".jpg") || path.ends_with(".jpeg") {
                "image/jpeg"
            } else {
                "application/octet-stream"
            };

            let mut file = match std::fs::File::open(&path) {
                Ok(f) => f,
                Err(_) => {
                    return Response::builder()
                        .status(404)
                        .header("Content-Type", "text/plain")
                        .body(format!("File not found: {path}").into_bytes())
                        .unwrap();
                }
            };

            let total_size = file.metadata().map(|m| m.len()).unwrap_or(0);

            // Check for Range header (required for video seeking)
            let range_header = request
                .headers()
                .get("range")
                .and_then(|v| v.to_str().ok())
                .map(String::from);

            if let Some(range) = range_header {
                let range = range.strip_prefix("bytes=").unwrap_or(&range);
                let parts: Vec<&str> = range.split('-').collect();
                let start: u64 = parts[0].parse().unwrap_or(0);
                let end: u64 = if parts.len() > 1 && !parts[1].is_empty() {
                    parts[1].parse().unwrap_or(total_size - 1)
                } else {
                    let chunk_size: u64 = 1024 * 1024; // 1 MB chunks
                    std::cmp::min(start + chunk_size - 1, total_size - 1)
                };

                let length = end - start + 1;
                file.seek(SeekFrom::Start(start)).ok();
                let mut buf = vec![0u8; length as usize];
                file.read_exact(&mut buf).ok();

                Response::builder()
                    .status(206)
                    .header("Content-Type", mime)
                    .header("Content-Length", length.to_string())
                    .header(
                        "Content-Range",
                        format!("bytes {start}-{end}/{total_size}"),
                    )
                    .header("Accept-Ranges", "bytes")
                    .body(buf)
                    .unwrap()
            } else {
                let mut buf = Vec::with_capacity(total_size as usize);
                file.read_to_end(&mut buf).ok();

                Response::builder()
                    .header("Content-Type", mime)
                    .header("Content-Length", total_size.to_string())
                    .header("Accept-Ranges", "bytes")
                    .body(buf)
                    .unwrap()
            }
        })
        .invoke_handler(tauri::generate_handler![create_project_folder, list_projects, delete_project, import_asset, list_assets, download_youtube_video, load_latest_project, save_project_data,list_project_files, read_specific_file, load_specific_project, rename_file, get_video_metadata, generate_thumbnail, delete_file])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
