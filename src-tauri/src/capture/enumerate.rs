//! Screen and window enumeration using Core Graphics.
//!
//! This module provides native enumeration of capturable sources without
//! requiring the browser's getDisplayMedia picker dialog.
//! Uses pure Core Graphics APIs (no Swift runtime required).

use super::types::{CapturableScreen, CapturableWindow, Rect};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use core_foundation::base::TCFType;
use core_graphics::display::{
    kCGWindowListExcludeDesktopElements, kCGWindowListOptionOnScreenOnly, CGDisplay,
    CGWindowListCopyWindowInfo,
};
use core_graphics::geometry::{CGPoint, CGRect, CGSize};
use core_graphics::window::{
    kCGWindowBounds, kCGWindowIsOnscreen, kCGWindowLayer, kCGWindowName, kCGWindowNumber,
    kCGWindowOwnerName, kCGWindowOwnerPID,
};
use std::ffi::c_void;

/// Enumerate all capturable windows using Core Graphics.
///
/// Returns a list of windows that can be captured, filtered to exclude
/// system UI elements like the Dock, menubar, and other non-user windows.
pub fn enumerate_windows() -> Result<Vec<CapturableWindow>, String> {
    let options = kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements;

    let window_list = unsafe { CGWindowListCopyWindowInfo(options, 0) };
    if window_list.is_null() {
        return Err("Failed to get window list. Make sure screen recording permission is granted.".to_string());
    }

    let mut windows: Vec<CapturableWindow> = Vec::new();

    unsafe {
        let count = core_foundation::array::CFArrayGetCount(window_list as *const _);

        for i in 0..count {
            let dict = core_foundation::array::CFArrayGetValueAtIndex(window_list as *const _, i)
                as core_foundation::dictionary::CFDictionaryRef;

            if dict.is_null() {
                continue;
            }

            // Get window number
            let window_id =
                get_cf_number(dict, kCGWindowNumber as *const c_void).unwrap_or(0) as u32;

            // Get window name
            let title = get_cf_string(dict, kCGWindowName as *const c_void).unwrap_or_default();

            // Get owner name
            let owner_name =
                get_cf_string(dict, kCGWindowOwnerName as *const c_void).unwrap_or_default();

            // Get owner PID
            let pid = get_cf_number(dict, kCGWindowOwnerPID as *const c_void).unwrap_or(0);

            // Get layer
            let layer = get_cf_number(dict, kCGWindowLayer as *const c_void).unwrap_or(0);

            // Get is_on_screen
            let is_on_screen = get_cf_bool(dict, kCGWindowIsOnscreen as *const c_void);

            // Get bounds
            let bounds = get_cg_rect(dict, kCGWindowBounds as *const c_void).unwrap_or_default();

            // Filter out system windows
            if should_filter_window(&owner_name, &title, layer) {
                continue;
            }

            // Skip windows with no size
            if bounds.width < 1.0 || bounds.height < 1.0 {
                continue;
            }

            let mut window = CapturableWindow {
                id: window_id,
                title,
                owner_name,
                bundle_id: None,
                pid,
                bounds,
                layer,
                is_on_screen,
                is_minimized: !is_on_screen,
                thumbnail: None,
            };

            window.thumbnail = generate_window_thumbnail(window_id, 200);
            windows.push(window);
        }

        core_foundation::base::CFRelease(window_list as *const _);
    }

    windows.sort_by(|a, b| a.layer.cmp(&b.layer).then(a.id.cmp(&b.id)));

    Ok(windows)
}

/// Enumerate all capturable screens/displays using Core Graphics.
pub fn enumerate_screens() -> Result<Vec<CapturableScreen>, String> {
    let main_display = CGDisplay::main();
    let main_id = main_display.id;

    // Get all active displays
    let max_displays = 16u32;
    let mut display_ids = vec![0u32; max_displays as usize];
    let mut display_count = 0u32;

    let result = unsafe {
        core_graphics::display::CGGetActiveDisplayList(
            max_displays,
            display_ids.as_mut_ptr(),
            &mut display_count,
        )
    };

    if result != 0 {
        // If we can't get the list, return at least the main display
        let width = main_display.pixels_wide() as u32;
        let height = main_display.pixels_high() as u32;
        let bounds = main_display.bounds();

        return Ok(vec![CapturableScreen {
            id: main_id,
            name: "Main Display".to_string(),
            width,
            height,
            frame: Rect {
                x: bounds.origin.x,
                y: bounds.origin.y,
                width: bounds.size.width,
                height: bounds.size.height,
            },
            is_main: true,
            thumbnail: generate_screen_thumbnail(main_id, 200),
        }]);
    }

    display_ids.truncate(display_count as usize);

    let mut screens: Vec<CapturableScreen> = Vec::new();

    for (index, &display_id) in display_ids.iter().enumerate() {
        let display = CGDisplay::new(display_id);
        let width = display.pixels_wide() as u32;
        let height = display.pixels_high() as u32;
        let bounds = display.bounds();
        let is_main = display_id == main_id;

        let name = if is_main {
            format!("Main Display ({})", index + 1)
        } else {
            format!("Display {}", index + 1)
        };

        let mut screen = CapturableScreen {
            id: display_id,
            name,
            width,
            height,
            frame: Rect {
                x: bounds.origin.x,
                y: bounds.origin.y,
                width: bounds.size.width,
                height: bounds.size.height,
            },
            is_main,
            thumbnail: None,
        };

        screen.thumbnail = generate_screen_thumbnail(display_id, 200);
        screens.push(screen);
    }

    screens.sort_by(|a, b| b.is_main.cmp(&a.is_main).then(a.id.cmp(&b.id)));

    Ok(screens)
}

/// Filter out system windows that shouldn't be shown to users.
fn should_filter_window(owner_name: &str, title: &str, layer: i32) -> bool {
    // Filter by layer - normal windows are layer 0
    // Positive layers are above normal windows (menus, etc.)
    // Very negative layers are desktop elements
    if layer != 0 {
        return true;
    }

    // Filter out known system processes
    let system_owners = [
        "Window Server",
        "Dock",
        "SystemUIServer",
        "Control Center",
        "Notification Center",
        "Spotlight",
        "loginwindow",
        "AirPlayUIAgent",
        "TextInputMenuAgent",
        "universalAccessAuthWarn",
    ];

    if system_owners.iter().any(|s| owner_name == *s) {
        return true;
    }

    // Filter windows without titles that are likely system UI
    if title.is_empty() {
        // Allow empty-title windows from known apps that might use them
        let allowed_empty_title_apps = [
            "Finder",
            "Terminal",
            "iTerm2",
            "Visual Studio Code",
            "Cursor",
        ];
        if !allowed_empty_title_apps.iter().any(|a| owner_name.contains(a)) {
            return true;
        }
    }

    false
}

/// Generate a thumbnail for a window using CGWindowListCreateImage.
pub fn generate_window_thumbnail(window_id: u32, max_width: u32) -> Option<String> {
    use core_graphics::display::CGWindowListCreateImage;
    use core_graphics::window::{
        kCGWindowImageBestResolution, kCGWindowImageBoundsIgnoreFraming,
        kCGWindowListOptionIncludingWindow,
    };

    let rect = CGRect {
        origin: CGPoint { x: 0.0, y: 0.0 },
        size: CGSize {
            width: 0.0,
            height: 0.0,
        }, // Null rect = capture window bounds
    };

    let image = unsafe {
        CGWindowListCreateImage(
            rect,
            kCGWindowListOptionIncludingWindow,
            window_id,
            kCGWindowImageBoundsIgnoreFraming | kCGWindowImageBestResolution,
        )
    };

    if image.is_null() {
        return None;
    }

    let png_data = cgimage_to_png(image as *const c_void, max_width);

    unsafe {
        core_foundation::base::CFRelease(image as *const _);
    }

    png_data.map(|data| BASE64.encode(&data))
}

/// Generate a thumbnail for a screen/display.
pub fn generate_screen_thumbnail(display_id: u32, max_width: u32) -> Option<String> {
    let display = CGDisplay::new(display_id);
    let image = display.image();

    image.and_then(|img| {
        use foreign_types::ForeignType;
        let ptr = img.as_ptr() as *const c_void;
        let png_data = cgimage_to_png(ptr, max_width);
        png_data.map(|data| BASE64.encode(&data))
    })
}

/// Capture a full-resolution frame from a window.
pub fn capture_window_frame(window_id: u32) -> Option<Vec<u8>> {
    use core_graphics::display::CGWindowListCreateImage;
    use core_graphics::window::{
        kCGWindowImageBestResolution, kCGWindowImageBoundsIgnoreFraming,
        kCGWindowListOptionIncludingWindow,
    };

    let rect = CGRect {
        origin: CGPoint { x: 0.0, y: 0.0 },
        size: CGSize {
            width: 0.0,
            height: 0.0,
        },
    };

    let image = unsafe {
        CGWindowListCreateImage(
            rect,
            kCGWindowListOptionIncludingWindow,
            window_id,
            kCGWindowImageBoundsIgnoreFraming | kCGWindowImageBestResolution,
        )
    };

    if image.is_null() {
        return None;
    }

    let result = cgimage_to_jpeg(image as *const c_void, 80);

    unsafe {
        core_foundation::base::CFRelease(image as *const _);
    }

    result
}

/// Capture a full-resolution frame from a screen.
pub fn capture_screen_frame(display_id: u32) -> Option<Vec<u8>> {
    let display = CGDisplay::new(display_id);
    let image = display.image()?;

    use foreign_types::ForeignType;
    let ptr = image.as_ptr() as *const c_void;
    cgimage_to_jpeg(ptr, 80)
}

/// Convert a CGImage to PNG data, optionally scaled to max_width.
fn cgimage_to_png(image: *const c_void, max_width: u32) -> Option<Vec<u8>> {
    use std::ptr;

    if image.is_null() {
        return None;
    }

    unsafe {
        // Create a mutable data object
        let data = core_foundation::data::CFDataCreateMutable(ptr::null(), 0);
        if data.is_null() {
            return None;
        }

        // Create image destination for PNG
        let png_type = core_foundation::string::CFString::new("public.png");
        let destination = CGImageDestinationCreateWithData(
            data as *mut _,
            png_type.as_concrete_TypeRef(),
            1,
            ptr::null(),
        );

        if destination.is_null() {
            core_foundation::base::CFRelease(data as *const _);
            return None;
        }

        // Get original image dimensions
        let orig_width = CGImageGetWidth(image);
        let orig_height = CGImageGetHeight(image);

        // Calculate scaled dimensions
        let scale = if orig_width > max_width as usize {
            max_width as f64 / orig_width as f64
        } else {
            1.0
        };
        let new_width = (orig_width as f64 * scale) as usize;
        let new_height = (orig_height as f64 * scale) as usize;

        // If we need to scale, create a scaled image
        let final_image = if scale < 1.0 {
            create_scaled_cgimage(image, new_width, new_height).unwrap_or(image)
        } else {
            image
        };

        // Add image to destination
        CGImageDestinationAddImage(destination, final_image, ptr::null());
        let success = CGImageDestinationFinalize(destination);

        // Clean up scaled image if we created one
        if scale < 1.0 && final_image != image {
            core_foundation::base::CFRelease(final_image as *const _);
        }

        core_foundation::base::CFRelease(destination as *const _);

        if !success {
            core_foundation::base::CFRelease(data as *const _);
            return None;
        }

        // Extract bytes from CFData
        let length = core_foundation::data::CFDataGetLength(data as *const _);
        let bytes_ptr = core_foundation::data::CFDataGetBytePtr(data as *const _);
        let bytes = std::slice::from_raw_parts(bytes_ptr, length as usize).to_vec();

        core_foundation::base::CFRelease(data as *const _);

        Some(bytes)
    }
}

/// Convert a CGImage to JPEG data.
fn cgimage_to_jpeg(image: *const c_void, quality: u8) -> Option<Vec<u8>> {
    use std::ptr;

    if image.is_null() {
        return None;
    }

    unsafe {
        let data = core_foundation::data::CFDataCreateMutable(ptr::null(), 0);
        if data.is_null() {
            return None;
        }

        let jpeg_type = core_foundation::string::CFString::new("public.jpeg");
        let destination = CGImageDestinationCreateWithData(
            data as *mut _,
            jpeg_type.as_concrete_TypeRef(),
            1,
            ptr::null(),
        );

        if destination.is_null() {
            core_foundation::base::CFRelease(data as *const _);
            return None;
        }

        // Create quality options
        let quality_key =
            core_foundation::string::CFString::new("kCGImageDestinationLossyCompressionQuality");
        let quality_value = core_foundation::number::CFNumber::from(quality as f64 / 100.0);

        let keys = [quality_key.as_concrete_TypeRef()];
        let values = [quality_value.as_concrete_TypeRef() as *const c_void];

        let options = core_foundation::dictionary::CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr() as *const *const c_void,
            values.as_ptr(),
            1,
            &core_foundation::dictionary::kCFTypeDictionaryKeyCallBacks,
            &core_foundation::dictionary::kCFTypeDictionaryValueCallBacks,
        );

        CGImageDestinationAddImage(destination, image, options as *const _);

        if !options.is_null() {
            core_foundation::base::CFRelease(options as *const c_void);
        }

        let success = CGImageDestinationFinalize(destination);
        core_foundation::base::CFRelease(destination as *const _);

        if !success {
            core_foundation::base::CFRelease(data as *const _);
            return None;
        }

        let length = core_foundation::data::CFDataGetLength(data as *const _);
        let bytes_ptr = core_foundation::data::CFDataGetBytePtr(data as *const _);
        let bytes = std::slice::from_raw_parts(bytes_ptr, length as usize).to_vec();

        core_foundation::base::CFRelease(data as *const _);

        Some(bytes)
    }
}

/// Create a scaled CGImage
fn create_scaled_cgimage(
    image: *const c_void,
    width: usize,
    height: usize,
) -> Option<*const c_void> {
    unsafe {
        // Create a bitmap context
        let color_space = CGColorSpaceCreateDeviceRGB();
        if color_space.is_null() {
            return None;
        }

        let context = CGBitmapContextCreate(
            std::ptr::null_mut(),
            width,
            height,
            8,
            width * 4,
            color_space,
            0x2002, // kCGImageAlphaPremultipliedLast
        );

        CGColorSpaceRelease(color_space);

        if context.is_null() {
            return None;
        }

        // Draw the image scaled
        let rect = CGRect {
            origin: CGPoint { x: 0.0, y: 0.0 },
            size: CGSize {
                width: width as f64,
                height: height as f64,
            },
        };
        CGContextDrawImage(context, rect, image);

        // Create new image from context
        let scaled_image = CGBitmapContextCreateImage(context);
        CGContextRelease(context);

        if scaled_image.is_null() {
            None
        } else {
            Some(scaled_image)
        }
    }
}

// Helper functions for CFDictionary access
unsafe fn get_cf_number(
    dict: core_foundation::dictionary::CFDictionaryRef,
    key: *const c_void,
) -> Option<i32> {
    let mut value: *const c_void = std::ptr::null();
    let found =
        core_foundation::dictionary::CFDictionaryGetValueIfPresent(dict, key, &mut value) != 0;
    if found {
        let mut num: i32 = 0;
        if core_foundation::number::CFNumberGetValue(
            value as core_foundation::number::CFNumberRef,
            core_foundation::number::kCFNumberSInt32Type,
            &mut num as *mut i32 as *mut c_void,
        ) {
            return Some(num);
        }
    }
    None
}

unsafe fn get_cf_string(
    dict: core_foundation::dictionary::CFDictionaryRef,
    key: *const c_void,
) -> Option<String> {
    let mut value: *const c_void = std::ptr::null();
    let found =
        core_foundation::dictionary::CFDictionaryGetValueIfPresent(dict, key, &mut value) != 0;
    if found {
        let cf_string = value as core_foundation::string::CFStringRef;
        if !cf_string.is_null() {
            let c_str = core_foundation::string::CFStringGetCStringPtr(
                cf_string,
                core_foundation::string::kCFStringEncodingUTF8,
            );
            if !c_str.is_null() {
                return Some(
                    std::ffi::CStr::from_ptr(c_str)
                        .to_string_lossy()
                        .into_owned(),
                );
            }
            // Fallback: use CFStringGetLength and CFStringGetCharacters
            let length = core_foundation::string::CFStringGetLength(cf_string);
            let mut buffer = vec![0u16; length as usize];
            core_foundation::string::CFStringGetCharacters(
                cf_string,
                core_foundation::base::CFRange {
                    location: 0,
                    length,
                },
                buffer.as_mut_ptr(),
            );
            return Some(String::from_utf16_lossy(&buffer));
        }
    }
    None
}

unsafe fn get_cf_bool(
    dict: core_foundation::dictionary::CFDictionaryRef,
    key: *const c_void,
) -> bool {
    let mut value: *const c_void = std::ptr::null();
    let found =
        core_foundation::dictionary::CFDictionaryGetValueIfPresent(dict, key, &mut value) != 0;
    if found && !value.is_null() {
        return core_foundation::number::CFBooleanGetValue(
            value as core_foundation::boolean::CFBooleanRef,
        );
    }
    false
}

unsafe fn get_cg_rect(
    dict: core_foundation::dictionary::CFDictionaryRef,
    key: *const c_void,
) -> Option<Rect> {
    let mut value: *const c_void = std::ptr::null();
    let found =
        core_foundation::dictionary::CFDictionaryGetValueIfPresent(dict, key, &mut value) != 0;
    if found {
        let bounds_dict = value as core_foundation::dictionary::CFDictionaryRef;
        if bounds_dict.is_null() {
            return None;
        }

        let x_key = core_foundation::string::CFString::new("X");
        let y_key = core_foundation::string::CFString::new("Y");
        let w_key = core_foundation::string::CFString::new("Width");
        let h_key = core_foundation::string::CFString::new("Height");

        let x = get_cf_number_f64(bounds_dict, x_key.as_concrete_TypeRef() as *const c_void)
            .unwrap_or(0.0);
        let y = get_cf_number_f64(bounds_dict, y_key.as_concrete_TypeRef() as *const c_void)
            .unwrap_or(0.0);
        let width = get_cf_number_f64(bounds_dict, w_key.as_concrete_TypeRef() as *const c_void)
            .unwrap_or(0.0);
        let height = get_cf_number_f64(bounds_dict, h_key.as_concrete_TypeRef() as *const c_void)
            .unwrap_or(0.0);

        return Some(Rect {
            x,
            y,
            width,
            height,
        });
    }
    None
}

unsafe fn get_cf_number_f64(
    dict: core_foundation::dictionary::CFDictionaryRef,
    key: *const c_void,
) -> Option<f64> {
    let mut value: *const c_void = std::ptr::null();
    let found =
        core_foundation::dictionary::CFDictionaryGetValueIfPresent(dict, key, &mut value) != 0;
    if found {
        let mut num: f64 = 0.0;
        if core_foundation::number::CFNumberGetValue(
            value as core_foundation::number::CFNumberRef,
            core_foundation::number::kCFNumberFloat64Type,
            &mut num as *mut f64 as *mut c_void,
        ) {
            return Some(num);
        }
    }
    None
}

// External C functions we need
#[link(name = "ImageIO", kind = "framework")]
extern "C" {
    fn CGImageDestinationCreateWithData(
        data: *mut c_void,
        type_: core_foundation::string::CFStringRef,
        count: usize,
        options: *const c_void,
    ) -> *mut c_void;
    fn CGImageDestinationAddImage(
        dest: *mut c_void,
        image: *const c_void,
        properties: *const c_void,
    );
    fn CGImageDestinationFinalize(dest: *mut c_void) -> bool;
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGImageGetWidth(image: *const c_void) -> usize;
    fn CGImageGetHeight(image: *const c_void) -> usize;
    fn CGColorSpaceCreateDeviceRGB() -> *mut c_void;
    fn CGColorSpaceRelease(space: *mut c_void);
    fn CGBitmapContextCreate(
        data: *mut c_void,
        width: usize,
        height: usize,
        bits_per_component: usize,
        bytes_per_row: usize,
        space: *mut c_void,
        bitmap_info: u32,
    ) -> *mut c_void;
    fn CGContextDrawImage(context: *mut c_void, rect: CGRect, image: *const c_void);
    fn CGContextRelease(context: *mut c_void);
    fn CGBitmapContextCreateImage(context: *mut c_void) -> *const c_void;
}
