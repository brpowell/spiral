#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AssetRole {
    Default,
    Hover,
    Pressed,
    Disabled,
    Map,
    Track,
    Decoration,
}

pub fn spiral_asset_path(source_name: &str, role: AssetRole, folder_hint: Option<&str>) -> String {
    let file = source_name
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or(source_name)
        .to_string();
    let ext_in = ext_of(&file);
    let ext_out = dest_ext(&ext_in, role);
    let mut stem = file
        .rsplit_once('.')
        .map(|(s, _)| s.to_string())
        .unwrap_or_else(|| file.clone())
        .to_ascii_lowercase();
    if let Some(rest) = stem.strip_prefix("btn_") {
        stem = rest.to_string();
    } else if let Some(rest) = stem.strip_prefix("img_") {
        stem = rest.to_string();
    }
    for suffix in [
        "_default",
        "_no",
        "_hov",
        "_hover",
        "_rv",
        "_do",
        "_down",
        "_pressed",
        "_colormap",
        "_map",
        "_disabled",
    ] {
        if stem.ends_with(suffix) {
            stem.truncate(stem.len() - suffix.len());
            break;
        }
    }
    stem = stem.replace('_', "-");
    match role {
        AssetRole::Hover => stem.push_str("-hover"),
        AssetRole::Pressed => stem.push_str("-pressed"),
        AssetRole::Disabled => stem.push_str("-disabled"),
        AssetRole::Map => stem.push_str("-map"),
        _ => {}
    }
    let folder = folder_hint.unwrap_or_else(|| folder_for(&file, role));
    format!("{folder}/{stem}{ext_out}")
}

fn folder_for(file: &str, role: AssetRole) -> &'static str {
    if matches!(role, AssetRole::Decoration | AssetRole::Track) {
        return "decorations";
    }
    let lower = file.to_ascii_lowercase();
    if role == AssetRole::Map {
        return "buttons";
    }
    if looks_like_slider(&lower) {
        return "sliders";
    }
    if lower.starts_with("img_") || role == AssetRole::Decoration {
        return "decorations";
    }
    if lower.starts_with("btn_")
        || matches!(
            role,
            AssetRole::Hover | AssetRole::Pressed | AssetRole::Disabled
        )
    {
        return "buttons";
    }
    "buttons"
}

fn looks_like_slider(lower: &str) -> bool {
    lower.contains("thumb")
        || lower.contains("slider")
        || lower.contains("progress")
        || lower.contains("seek")
        || lower.contains("vol")
        || lower.contains("eq_h")
        || lower.contains("eq-h")
        || lower.contains("vertical_slider")
        || lower.contains("horizontal_slider")
}

fn ext_of(file: &str) -> String {
    file.rfind('.')
        .map(|i| file[i..].to_ascii_lowercase())
        .unwrap_or_default()
}

fn dest_ext(src_ext: &str, role: AssetRole) -> &'static str {
    if src_ext == ".gif"
        && matches!(
            role,
            AssetRole::Hover | AssetRole::Pressed | AssetRole::Default | AssetRole::Disabled
        )
    {
        ".gif"
    } else {
        ".png"
    }
}

pub fn slugify(value: &str) -> String {
    let mut out = String::new();
    let mut last_dash = false;
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    while out.starts_with('-') {
        out.remove(0);
    }
    while out.ends_with('-') {
        out.pop();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spiral_asset_path_normalizes_wms_names() {
        assert_eq!(
            spiral_asset_path("btn_quit_default.bmp", AssetRole::Default, Some("buttons")),
            "buttons/quit.png"
        );
        assert_eq!(
            spiral_asset_path("btn_quit_rv.bmp", AssetRole::Hover, Some("buttons")),
            "buttons/quit-hover.png"
        );
        assert_eq!(
            spiral_asset_path(
                "btn_play_controls_colormap.bmp",
                AssetRole::Map,
                Some("buttons")
            ),
            "buttons/play-controls-map.png"
        );
        assert_eq!(
            spiral_asset_path(
                "btn_play_controls_disabled.bmp",
                AssetRole::Disabled,
                Some("buttons")
            ),
            "buttons/play-controls-disabled.png"
        );
        assert_eq!(slugify("Plus! Nature"), "plus-nature");
    }
}
