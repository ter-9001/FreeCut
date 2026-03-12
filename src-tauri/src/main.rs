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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Keyframe {
    pub id: String,
    pub time: f64,
    pub value: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Keyframes {
    pub volume: Option<Vec<Keyframe>>,
    pub opacity: Option<Vec<Keyframe>>,
    pub speed: Option<Vec<Keyframe>>,
    pub rotation3d: Option<Vec<Keyframe>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Clip {
    pub id: String,
    pub name: String,
    pub path: String,
    pub start: f64,
    pub duration: f64,
    pub beginmoment: f64,
    #[serde(rename = "trackId")]
    pub track_id: String, // Mantive String para bater com seu código anterior, mas mudei o binding
    #[serde(rename = "type")]
    pub clip_type: String,
    #[serde(default)]
    pub mute: Option<bool>,
    pub fadein: Option<f64>,
    pub fadeout: Option<f64>,
    pub fadeinAudio: Option<f64>, 
    pub fadeoutAudio: Option<f64>,
    
    // Opcional: para suportar a nova estrutura de keyframes
    pub keyframes: Option<Keyframes>,
    
    #[serde(rename = "activeKeyframeView")]
    pub active_keyframe_view: Option<String>,
}

use tauri::Emitter; // Adicione este import no topo


#[derive(Serialize)]
struct ExportPayload {
    export_path: String,
    total_duration: f64,
    clips: Vec<Clip>,
}

use tauri::{ Runtime}; // Certifique-se de usar Emitter no Tauri v2


#[tauri::command]
async fn export_video(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, ExportState>,
    project_path: String,
    export_path: String,
    clips: serde_json::Value,
) -> Result<(), String> {
    
    // 1. Criar o objeto de configuração
    let config_data = serde_json::json!({
        "project_path": project_path,
        "export_path": export_path,
        "clips": clips
    });

    // 2. Definir o caminho do JSON dentro da pasta do projeto
    let project_dir = std::path::PathBuf::from(&project_path);
    
    // Garante que a pasta do projeto existe
    if !project_dir.exists() {
        return Err(format!("A pasta do projeto não existe: {}", project_path));
    }

    let config_path = project_dir.join("export_config.json");

    // 3. Salvar/Sobrescrever o JSON
    let json_string = serde_json::to_string_pretty(&config_data)
        .map_err(|e| format!("Erro ao serializar JSON: {}", e))?;
    
    std::fs::write(&config_path, json_string)
        .map_err(|e| format!("Erro ao gravar export_config.json no projeto: {}", e))?;

    let config_path_str = config_path.to_string_lossy().to_string();

    // 4. Iniciar o Sidecar Python
    let (mut rx, child) = app_handle
        .shell()
        .sidecar("exporter")
        .map_err(|e| format!("Sidecar não encontrado: {}", e))?
        .env("PYTHONUNBUFFERED", "1")
        .arg(&config_path_str) // Passamos o caminho completo do JSON dentro do projeto
        .spawn()
        .map_err(|e| format!("Falha ao iniciar processo Python: {}", e))?;

    // Guardar processo para cancelamento
    {
        let mut lock = state.0.lock().unwrap();
        *lock = Some(child);
    }

    // 5. Monitorização do progresso (Stderr)
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stderr(line_bytes) => {
                    let raw = String::from_utf8_lossy(&line_bytes);
                    for line in raw.lines() {
                        let line = line.trim();
                        
                        if line.contains("PERCENT:") {
                            if let Some(val_str) = line.split("PERCENT:").last() {
                                if let Ok(percent) = val_str.parse::<u32>() {
                                    // Log para você acompanhar no terminal
                                    println!("Progresso Real: {}%", percent);
                                    let _ = app_handle.emit("export-progress", percent);
                                }
                            }
                        }
                        // println!("[Python Log]: {}", line); // Opcional
                    }
                }
                tauri_plugin_shell::process::CommandEvent::Terminated(status) => {
                    println!("Renderização concluída com código: {:?}", status.code);
                    // Opcional: manter o json no projeto para histórico ou apagar
                    // let _ = std::fs::remove_file(config_path);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}


pub fn build_rendering_filter(clips: &[Clip], total_duration: f64) -> String {
    let mut filters = Vec::new();
    let mut audio_outputs = Vec::new();
    let mut video_layers = Vec::new();

    let centering_filter = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2";

    for (i, clip) in clips.iter().enumerate() {
        let path_lower = clip.path.to_lowercase();
        let is_image = path_lower.ends_with(".png") || path_lower.ends_with(".jpg") || path_lower.ends_with(".jpeg");
        let is_audio = clip.clip_type == "audio" || path_lower.ends_with(".mp3") || path_lower.ends_with(".wav");

        // --- Processamento de Vídeo/Imagem ---
        if !is_audio {
            let mut v_filters = Vec::new();

        //check if has keyframes, if result 1 there is no keyframes

        let opacity_kfs = clip.keyframes.as_ref()
                .and_then(|k| k.opacity.as_ref())
                .map(|v| v.as_slice())
                .unwrap_or(&[]);

        let opacity_expression = build_opacity_expression(opacity_kfs);

        if opacity_expression == "1" 
        {
            
            if is_image {

                                
                    v_filters.push("format=yuva420p".to_string());

                    if let Some(fi) = clip.fadein {
                        if fi > 0.0 { 
                            v_filters.push(format!("fade=t=in:st=0:d={:.4}:alpha=1", fi)); 
                        }
                    }
                    if let Some(fo) = clip.fadeout {
                        if fo > 0.0 {
                            let st = clip.duration - fo;
                            v_filters.push(format!("fade=t=out:st={:.4}:d={:.4}:alpha=1", st, fo));
                        }
                    }

                    let v_effects = if v_filters.is_empty() { "".to_string() } else { format!(",{}", v_filters.join(",")) };

                    
                    filters.push(format!(
                        "[{}:v]{}{},setpts=PTS-STARTPTS+{}/TB[v{}]",
                        i, centering_filter, v_effects, clip.start, i
                    ));
                            
            } else 
            {
                        if let Some(fi) = clip.fadein {
                            if fi > 0.0 { v_filters.push(format!("fade=t=in:st=0:d={:.4}", fi)); }
                        }
                        if let Some(fo) = clip.fadeout {
                            if fo > 0.0 {
                                let st = clip.duration - fo;
                                v_filters.push(format!("fade=t=out:st={:.4}:d={:.4}", st, fo));
                            }
                        }

                        let v_effects = if v_filters.is_empty() { "".to_string() } else { format!(",{}", v_filters.join(",")) };

                        filters.push(format!(
                            "[{}:v]trim=start={:.4}:duration={:.4},setpts=PTS-STARTPTS,{}{},setpts=PTS+{}/TB[v{}]",
                            i, clip.beginmoment, clip.duration, centering_filter, v_effects, clip.start, i
                        ));
            }
                
        }
        else {
            // --- Logic for Keyframe Opacity ---
            
            // 1. Ensure alpha channel support for the pixel format
            v_filters.push("format=yuva420p".to_string());
            
            // 2. Add the opacity expression. 
            // We use single quotes for the internal math expression
            v_filters.push(format!("colorchannelmixer=aa='{}'", opacity_expression));

            let v_effects = format!(",{}", v_filters.join(","));

            if is_image {
                // For images: reset PTS so 't' in the expression starts at 0 for this clip
                filters.push(format!(
                    "[{}:v]{}{},setpts=PTS-STARTPTS+{}/TB[v{}]",
                    i, centering_filter, v_effects, clip.start, i
                ));
            } else {
                // For videos: trim first, then apply effects and timeline positioning
                filters.push(format!(
                    "[{}:v]trim=start={:.4}:duration={:.4},setpts=PTS-STARTPTS,{}{},setpts=PTS+{}/TB[v{}]",
                    i, clip.beginmoment, clip.duration, centering_filter, v_effects, clip.start, i
                ));
            }
        }



          video_layers.push((i, clip.start, clip.duration));
        }

        // --- Processamento de Áudio com Keyframes ---
        if !is_image {
            let delay_ms = (clip.start * 1000.0).round() as i64;
            
            let vol_kfs = clip.keyframes.as_ref()
                .and_then(|k| k.volume.as_ref())
                .map(|v| v.as_slice())
                .unwrap_or(&[]);

            let volume_expr = build_volume_expression(vol_kfs, clip.mute.unwrap_or(false));


            println!("--- Comando {} ---", volume_expr);

            //if volume equal 1 is because there is no keyframes audio

            if volume_expr == "1"
            {

                println!("São iguais!");
                    let delay_ms = (clip.start * 1000.0).round() as i64;
                    let volume = if clip.mute.unwrap_or(false) { "0" } else { "1" };
                    
                    let mut a_effects = Vec::new();
                    if let Some(fi) = clip.fadeinAudio {
                        if fi > 0.0 { a_effects.push(format!("afade=t=in:st=0:d={}", fi)); }
                        
                        println!("Fade in detect");
                    }
                    if let Some(fo) = clip.fadeoutAudio {
                        if fo > 0.0 {
                            a_effects.push(format!("afade=t=out:st={}:d={}", clip.duration - fo, fo));
                        }
                    }

                    let a_effects_str = if a_effects.is_empty() { String::new() } else { format!(",{}", a_effects.join(",")) };

                    filters.push(format!(
                        "[{}:a]atrim=start={}:duration={},asetpts=PTS-STARTPTS,volume={}{},adelay={}|{},aresample=async=1[a{}]",
                        i, clip.beginmoment, clip.duration, volume, a_effects_str, delay_ms, delay_ms, i
                    ));
                    audio_outputs.push(format!("[a{}]", i));
            }
            else
            {

                let mut a_filters = Vec::new();
                 // 1. Primeiro cortamos o áudio original
                a_filters.push(format!("atrim=start={:.4}:duration={:.4}", clip.beginmoment, clip.duration));
                
                // 2. Resetamos o PTS para que o áudio comece em 0 internamente
                a_filters.push("asetpts=PTS-STARTPTS".to_string());

                // 3. Aplicamos o volume (dinâmico por keyframes ou fixo)
                a_filters.push(format!("volume=eval=frame:volume='{}'", volume_expr));

                // 4. Aplicamos o delay para posicionar na timeline
                a_filters.push(format!("adelay={}|{}", delay_ms, delay_ms));

                // 5. Unimos os filtros e definimos a saída [aX]
                let filter_string = a_filters.join(",");
                filters.push(format!("[{}:a]{}[a{}]", i, filter_string, i));
                
                audio_outputs.push(format!("[a{}]", i));
            }
        }
    }

    // --- Composição Final ---
    filters.push(format!("color=s=1920x1080:c=black:r=30:d={:.4}[bg]", total_duration));
    
    let mut current_v_layer = "bg".to_string();
    for (idx, (input_idx, start, duration)) in video_layers.iter().enumerate() {
        let next_v_layer = if idx == video_layers.len() - 1 { "outv_pre".to_string() } else { format!("l{}", idx) };
        filters.push(format!(
            "[{}] [v{}] overlay=enable='between(t,{:.4},{:.4})' [ {} ]",
            current_v_layer, input_idx, start, start + duration, next_v_layer
        ));
        current_v_layer = next_v_layer;
    }
    
    filters.push(format!("[{}]format=yuv420p[outv]", if video_layers.is_empty() { "bg" } else { "outv_pre" }));

    if audio_outputs.is_empty() {
        filters.push(format!("anullsrc=r=44100:cl=stereo:d={:.4}[outa]", total_duration));
    } else {
        filters.push(format!(
            "{}amix=inputs={}:duration=longest:dropout_transition=99999[outa]",
            audio_outputs.join(""),
            audio_outputs.len()
        ));
    }

    filters.join(";")
}




fn build_volume_expression(keyframes: &[Keyframe], mute: bool) -> String {
    // 1. Se estiver mutado, volume é zero absoluto
    if mute {
        return "0".to_string();
    }

    // 2. Sem keyframes, volume padrão (1.0 = 0dB)
    if keyframes.is_empty() {
        return "1".to_string();
    }

    let mut sorted = keyframes.to_vec();
    // Ordena por tempo para garantir que a lógica de 'between' funcione corretamente
    sorted.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap_or(std::cmp::Ordering::Equal));

    // 3. Apenas um keyframe: valor constante
    if sorted.len() == 1 {
        let db = (sorted[0].value * 100.0) - 50.0;
        return format!("pow(10,({:.4})/20)", db);
    }

    let mut expr = String::new();
    let mut open_parents = 0;

    // 4. Valor fixo ANTES do primeiro keyframe
    let first_db = (sorted[0].value * 100.0) - 50.0;
    expr.push_str(&format!("if(lt(t,{:.4}),pow(10,({:.4})/20)", sorted[0].time, first_db));
    open_parents += 1;

    // 5. Interpolação Linear entre os pontos
    for i in 0..sorted.len() - 1 {
        let p1 = &sorted[i];
        let p2 = &sorted[i + 1];
        let db1 = (p1.value * 100.0) - 50.0;
        let db2 = (p2.value * 100.0) - 50.0;

        // Fórmula: db1 + (db2 - db1) * (t - t1) / (t2 - t1)
        let lerp_db = format!(
            "(({:.4})+(({:.4})-({:.4}))*(t-({:.4}))/(({:.4})-({:.4})))",
            db1, db2, db1, p1.time, p2.time, p1.time
        );

        expr.push_str(&format!(",if(between(t,{:.4},{:.4}),pow(10,{}/20)", p1.time, p2.time, lerp_db));
        open_parents += 1;
    }

    // 6. Valor fixo DEPOIS do último keyframe
    let last_db = (sorted.last().unwrap().value * 100.0) - 50.0;
    expr.push_str(&format!(",pow(10,({:.4})/20)", last_db));

    // 7. Fechar todos os parênteses dos 'if's abertos
    for _ in 0..open_parents {
        expr.push_str(")");
    }

    expr
}



//if(lt(t,2.4556),pow(10,(45.6522)/20),if(between(t,2.4556,3.3333),pow(10,((45.6522)+((-32.6087)-(45.6522))*(t-(2.4556))/((3.3333)-(2.4556)))/20),if(between(t,3.3333,4.2778),pow(10,((-32.6087)+((0.0000)-(-32.6087))*(t-(3.3333))/((4.2778)-(3.3333)))/20),pow(10,(0.0000)/20))))
//

pub fn build_opacity_expression(keyframes: &[Keyframe]) -> String {
    if keyframes.is_empty() { return "1".to_string(); }

    // Criamos uma cópia local para ordenar sem "roubar" o Vec do usuário
    let mut sorted_keys = keyframes.to_vec(); 
    sorted_keys.sort_by(|a, b| a.time.partial_cmp(&b.time).unwrap());

    // 2. Função recursiva para montar os ifs aninhados
    fn build_expression(keys: &[Keyframe], index: usize) -> String {
        let current = &keys[index];

        // Se for o último keyframe, mantemos o valor dele para o resto do vídeo
        if index == keys.len() - 1 {
            return format!("{:.3}", current.value);
        }

        let next = &keys[index + 1];
        
        // Cálculo da interpolação linear entre o ponto atual e o próximo:
        // Valor = ValorInicial + (TempoAtual - TempoInicial) * (VariaçãoValor / VariaçãoTempo)
        let delta_val = next.value - current.value;
        let delta_time = next.time - current.time;
        
        let lerp = if delta_time == 0.0 {
            format!("{:.3}", next.value)
        } else {
            format!("{:.3}+(t-{:.3})*({:.3}/{:.3})", current.value, current.time, delta_val, delta_time)
        };

        // if(t < tempo_do_proximo, interpola, recursão_para_proximos)
        format!("if(lt(t,{:.3}),{},{})", next.time, lerp, build_expression(keys, index + 1))
    }

    // Se o primeiro keyframe não começar em 0s, definimos o valor inicial até lá
    if sorted_keys[0].time > 0.0 {
        format!("if(lt(t,{:.3}),{:.3},{})", 
            sorted_keys[0].time, 
            sorted_keys[0].value, 
            build_expression(&sorted_keys, 0)
        )
    } else {
        build_expression(&sorted_keys, 0)
    }
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
fn move_file(source: String, destination: String) -> Result<String, String> {
    let src_path = Path::new(&source);
    let dest_path = Path::new(&destination);

    // 1. Check if source file exists
    if !src_path.exists() {
        return Err("Source file does not exist".to_string());
    }

    // 2. Perform the copy and delete operation (move)
    // fs::rename is the standard way to move files
    match fs::rename(src_path, dest_path) {
        Ok(_) => Ok("File transferred successfully".to_string()),
        Err(e) => Err(format!("Failed to transfer file: {}", e)),
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


#[tauri::command]
fn copy_file(source: String, destination: String) -> Result<String, String> {
    let src_path = Path::new(&source);
    let dest_path = Path::new(&destination);

    

    // Validate if the source exists before attempting to copy
    if !src_path.exists() {
        return Err("Source file not found".to_string());
    }

    // Attempt to copy the file bytes
    // fs::copy returns the number of bytes copied on success
    match fs::copy(src_path, dest_path) {
        Ok(bytes) => Ok(format!("Successfully copied {} bytes", bytes)),
        Err(e) => Err(format!("Copy failed: {}", e)),
    }
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
            cancel_export,
            move_file,
            copy_file
           
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}