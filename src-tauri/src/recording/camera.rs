use crate::models::CameraInfo;
use std::process::Command;

/// Enumerate available cameras using FFmpeg's avfoundation device listing.
pub fn enumerate_cameras() -> Result<Vec<CameraInfo>, String> {
    let output = Command::new("ffmpeg")
        .args(["-f", "avfoundation", "-list_devices", "true", "-i", ""])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut cameras = Vec::new();
    let mut in_video_section = false;

    for line in stderr.lines() {
        if line.contains("AVFoundation video devices:") {
            in_video_section = true;
            continue;
        }
        if line.contains("AVFoundation audio devices:") {
            break;
        }
        if !in_video_section {
            continue;
        }

        if let Some((idx, name)) = parse_device_line(line) {
            let lower = name.to_lowercase();
            // Cameras are video devices that are NOT screen captures
            if !lower.contains("screen") && !lower.contains("display") && !lower.contains("capture screen") {
                cameras.push(CameraInfo {
                    id: idx.to_string(),
                    name,
                });
            }
        }
    }

    Ok(cameras)
}

fn parse_device_line(line: &str) -> Option<(u32, String)> {
    let mut brackets: Vec<&str> = Vec::new();
    let mut rest = line;
    while let Some(start) = rest.find('[') {
        let after = &rest[start + 1..];
        if let Some(end) = after.find(']') {
            brackets.push(&after[..end]);
            rest = &after[end + 1..];
        } else {
            break;
        }
    }

    if brackets.len() < 2 {
        return None;
    }

    let idx: u32 = brackets[1].trim().parse().ok()?;
    let second_bracket_close = line.find(']').and_then(|first| {
        line[first + 1..].find(']').map(|second| first + 1 + second + 1)
    })?;
    let name = line[second_bracket_close..].trim().to_string();

    Some((idx, name))
}

pub struct CameraRecorder;

impl CameraRecorder {
    pub fn new() -> Self {
        Self
    }
}
