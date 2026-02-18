use crate::models::ScreenInfo;
use std::process::Command;

// ---------------------------------------------------------------------------
// CoreGraphics FFI for display enumeration
// ---------------------------------------------------------------------------

type CGDirectDisplayID = u32;

#[repr(C)]
#[derive(Clone, Copy)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGSize {
    width: f64,
    height: f64,
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGGetActiveDisplayList(
        max_displays: u32,
        active_displays: *mut CGDirectDisplayID,
        display_count: *mut u32,
    ) -> i32;
    fn CGDisplayBounds(display: CGDirectDisplayID) -> CGRect;
}

/// Query macOS CoreGraphics for active display dimensions and origins.
/// Returns a vec of (width, height, origin_x, origin_y) in logical points,
/// ordered by the same index CGGetActiveDisplayList uses (which matches
/// avfoundation's "Capture screen N" ordering).
fn get_display_info() -> Vec<(u32, u32, f64, f64)> {
    let mut ids: [CGDirectDisplayID; 16] = [0; 16];
    let mut count: u32 = 0;
    let result =
        unsafe { CGGetActiveDisplayList(16, ids.as_mut_ptr(), &mut count) };
    if result != 0 {
        return Vec::new();
    }
    let count = count as usize;
    (0..count)
        .map(|i| {
            let bounds = unsafe { CGDisplayBounds(ids[i]) };
            (
                bounds.size.width as u32,
                bounds.size.height as u32,
                bounds.origin.x,
                bounds.origin.y,
            )
        })
        .collect()
}

/// Enumerate available screens using FFmpeg's avfoundation device listing,
/// enriched with actual dimensions from CoreGraphics.
pub fn enumerate_screens() -> Result<Vec<ScreenInfo>, String> {
    let output = Command::new("ffmpeg")
        .args(["-f", "avfoundation", "-list_devices", "true", "-i", ""])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {e}"))?;

    let display_info = get_display_info();

    // FFmpeg prints device list to stderr.
    // Format: [AVFoundation indev @ 0x...] [0] Capture screen 0
    let stderr = String::from_utf8_lossy(&output.stderr);
    let mut screens = Vec::new();
    let mut in_video_section = false;
    let mut screen_counter: usize = 0;

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

        // Parse lines like: [AVFoundation indev @ 0x...] [0] Capture screen 0
        if let Some(parsed) = parse_device_line(line) {
            let lower = parsed.1.to_lowercase();
            if lower.contains("screen") || lower.contains("display") || lower.contains("capture") {
                let (w, h, ox, oy) = display_info
                    .get(screen_counter)
                    .copied()
                    .unwrap_or((1920, 1080, 0.0, 0.0));
                screens.push(ScreenInfo {
                    id: parsed.0.to_string(),
                    name: parsed.1,
                    width: w,
                    height: h,
                    origin_x: ox,
                    origin_y: oy,
                });
                screen_counter += 1;
            }
        }
    }

    // Always provide at least one default screen
    if screens.is_empty() {
        let (w, h, ox, oy) = display_info
            .first()
            .copied()
            .unwrap_or((1920, 1080, 0.0, 0.0));
        screens.push(ScreenInfo {
            id: "0".to_string(),
            name: "Default Screen".to_string(),
            width: w,
            height: h,
            origin_x: ox,
            origin_y: oy,
        });
    }

    Ok(screens)
}

/// Parse an avfoundation device line and extract (index, name).
/// Input: `[AVFoundation indev @ 0x7f8...] [0] FaceTime HD Camera`
/// Returns: Some((0, "FaceTime HD Camera"))
fn parse_device_line(line: &str) -> Option<(u32, String)> {
    // Find all `[...]` bracket pairs in the line
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

    // We need at least 2 bracket pairs: [AVFoundation...] [index]
    if brackets.len() < 2 {
        return None;
    }

    let idx: u32 = brackets[1].trim().parse().ok()?;

    // The device name is everything after the second `]`
    let second_bracket_close = line.find(']').and_then(|first| {
        line[first + 1..].find(']').map(|second| first + 1 + second + 1)
    })?;
    let name = line[second_bracket_close..].trim().to_string();

    Some((idx, name))
}

/// Placeholder screen recorder (capture handled by FFmpeg in RecordingManager).
pub struct ScreenRecorder;

impl ScreenRecorder {
    pub fn new() -> Self {
        Self
    }
}
