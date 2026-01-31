// src-tauri/src/main.rs
use std::fs;
use std::path::PathBuf;

#[derive(serde::Serialize)]
struct Project {
    name: String,
    path: String
}

use std::process::Command;


#[tauri::command]
fn save_project_data(project_path: String, data: String, timestamp: u64) -> Result<(), String> {
    let mut path = PathBuf::from(&project_path);
    // Construct filename: main1712345678.project
    let filename = format!("main{}.project", timestamp);
    path.push(filename);

    fs::write(path, data).map_err(|e| e.to_string())
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init()) // Inicializa o plugin de diálogo
        .invoke_handler(tauri::generate_handler![create_project_folder, list_projects, delete_project, import_asset, list_assets, download_youtube_video, load_latest_project, save_project_data])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
