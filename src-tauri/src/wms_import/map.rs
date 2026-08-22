use std::collections::HashSet;

use serde_json::{json, Map, Value};

use crate::wms_import::parse::WmsNode;

fn call_matches(s: &str, object_path: &str, method: &str) -> bool {
    let s = s.trim();
    let lower = s.to_ascii_lowercase();
    let prefix = format!(
        "{}.{}",
        object_path.to_ascii_lowercase(),
        method.to_ascii_lowercase()
    );
    if !lower.starts_with(&prefix) {
        return false;
    }
    let rest = s[prefix.len()..].trim();
    if rest.is_empty() {
        return true;
    }
    if !(rest.starts_with('(') && rest.ends_with(')')) {
        return false;
    }
    rest[1..rest.len() - 1].chars().all(|c| c.is_whitespace())
}

fn call_matches_alt(s: &str, objects: &[&str], method: &str) -> bool {
    objects.iter().any(|o| call_matches(s, o, method))
}

fn match_action(stmt: &str) -> Option<&'static str> {
    let s = stmt.trim();
    if call_matches(s, "view", "close") {
        return Some("skin.exit");
    }
    if call_matches(s, "view", "minimize") {
        return Some("skin.minimize");
    }
    if call_matches(s, "view", "returnToMediaCenter") {
        return Some("skin.restoreMainWindow");
    }
    if call_matches(s, "eq", "reset") {
        return Some("eq.reset");
    }
    if call_matches_alt(s, &["Visualizer", "visEffects"], "previous") {
        return Some("visualizer.previous");
    }
    if call_matches_alt(s, &["Visualizer", "visEffects"], "next") {
        return Some("visualizer.next");
    }
    if call_matches(s, "player.controls", "play") {
        return Some("player.play");
    }
    if call_matches(s, "player.controls", "pause") {
        return Some("player.pause");
    }
    if call_matches(s, "player.controls", "previous") {
        return Some("player.previousTrack");
    }
    if call_matches(s, "player.controls", "next") {
        return Some("player.nextTrack");
    }
    if call_matches(s, "player.controls", "stop") {
        return Some("player.stop");
    }
    None
}

pub fn map_on_click(raw: Option<&str>) -> (Vec<Value>, Vec<String>) {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return (Vec::new(), Vec::new());
    };
    let mut unmapped = Vec::new();
    let mut effects = Vec::new();
    for part in split_statements(raw) {
        if let Some(action) = match_action(&part) {
            effects.push(json!({ "action": action }));
        } else {
            unmapped.push(part);
        }
    }
    (effects, unmapped)
}

pub fn implicit_element_action(tag: &str) -> Option<&'static str> {
    match tag {
        "playelement" => Some("player.play"),
        "pauseelement" => Some("player.pause"),
        "stopelement" => Some("player.stop"),
        "prevelement" => Some("player.previousTrack"),
        "nextelement" => Some("player.nextTrack"),
        _ => None,
    }
}

pub(crate) fn split_statements(raw: &str) -> Vec<String> {
    raw.split(';')
        .map(|s| strip_jscript(s).trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

pub(crate) fn strip_jscript(s: &str) -> String {
    let trimmed = s.trim();
    if trimmed.len() >= 8 && trimmed[..8].eq_ignore_ascii_case("jscript:") {
        trimmed[8..].trim().to_string()
    } else {
        trimmed.to_string()
    }
}

/// `Foo()` / `Foo` with empty parens. None when the statement has arguments or is not a call.
pub(crate) fn bare_call_name(stmt: &str) -> Option<String> {
    let s = strip_jscript(stmt);
    let s = s.trim();
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return None;
    }
    let mut i = 0usize;
    if !(bytes[0].is_ascii_alphabetic() || bytes[0] == b'_') {
        return None;
    }
    i += 1;
    while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
        i += 1;
    }
    let name = &s[..i];
    let rest = s[i..].trim();
    if rest.is_empty() {
        return Some(name.to_string());
    }
    if rest.starts_with('(')
        && rest.ends_with(')')
        && rest[1..rest.len() - 1].chars().all(|c| c.is_whitespace())
    {
        return Some(name.to_string());
    }
    None
}

pub fn map_bind(raw: Option<&str>) -> Option<String> {
    let raw = raw?;
    let value = if raw.len() >= 8 && raw[..8].eq_ignore_ascii_case("wmpprop:") {
        raw[8..].trim()
    } else {
        raw.trim()
    };
    let lower = value.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("eq.gainlevel") {
        if let Ok(n) = rest.parse::<u32>() {
            if (1..=10).contains(&n) {
                return Some(format!("eq.band.{n}"));
            }
        }
    }
    match lower.as_str() {
        "player.settings.volume" => Some("player.volume".into()),
        "player.settings.balance" => Some("player.balance".into()),
        "player.controls.currentposition" => Some("player.positionSeconds".into()),
        "player.controls.currentpositionstring" => Some("player.positionLabel".into()),
        "player.currentmedia.name" => Some("track.title".into()),
        "player.currentmedia.durationstring" => Some("player.durationLabel".into()),
        "player.currentmedia.duration" => Some("track.durationSeconds".into()),
        _ => None,
    }
}

pub fn map_wmp_enabled(raw: Option<&str>) -> Option<&'static str> {
    let raw = raw?;
    let inner = if raw.len() >= 11 && raw[..11].eq_ignore_ascii_case("wmpenabled:") {
        raw[11..].trim()
    } else {
        raw.trim()
    };
    let lower = inner.to_ascii_lowercase();
    if lower.starts_with("player.controls.pause") {
        return Some("player.isPlaying");
    }
    if lower.starts_with("player.controls.play") {
        return Some("player.notPlaying");
    }
    if lower.starts_with("player.controls.stop") {
        return Some("player.hasTrack");
    }
    None
}

pub fn map_tooltip(node: &WmsNode) -> Option<String> {
    node.attrs
        .get("uptooltip")
        .or_else(|| node.attrs.get("tooltip"))
        .cloned()
}

pub fn map_style(node: &WmsNode) -> (Option<Map<String, Value>>, Vec<(String, String)>) {
    let mut style = Map::new();
    let mut unmapped = Vec::new();
    if let Some(size) = node.attrs.get("fontsize") {
        if let Some(n) = parse_number(Some(size)) {
            style.insert("fontSize".into(), json!(n));
        }
    }
    if let Some(color) = node.attrs.get("foregroundcolor") {
        style.insert("color".into(), json!(color));
    }
    if let Some(weight) = node.attrs.get("fontstyle").map(|s| s.to_ascii_lowercase()) {
        if weight == "bold" || weight == "normal" {
            style.insert("fontWeight".into(), json!(weight));
        }
    }
    if let Some(align) = node
        .attrs
        .get("justification")
        .map(|s| s.to_ascii_lowercase())
    {
        if matches!(align.as_str(), "left" | "center" | "right") {
            style.insert("textAlign".into(), json!(align));
        }
    }
    if let Some(bg) = node.attrs.get("backgroundcolor") {
        if bg.to_ascii_lowercase() != "none" {
            style.insert("backgroundColor".into(), json!(bg));
        }
    }
    if node.attrs.contains_key("fontface")
        || node.attrs.contains_key("fonttype")
        || node.attrs.contains_key("fontsmoothing")
    {
        let (attr, value) = if let Some(v) = node.attrs.get("fontface") {
            ("fontFace", v.clone())
        } else if let Some(v) = node.attrs.get("fonttype") {
            ("fontType", v.clone())
        } else {
            (
                "fontSmoothing",
                node.attrs.get("fontsmoothing").cloned().unwrap_or_default(),
            )
        };
        unmapped.push((attr.to_string(), value));
    }
    let style = if style.is_empty() { None } else { Some(style) };
    (style, unmapped)
}

pub fn parse_number(raw: Option<&str>) -> Option<f64> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    let n: f64 = raw.parse().ok()?;
    if n.is_finite() {
        Some(n)
    } else {
        None
    }
}

pub fn is_truthy_attr(raw: Option<&str>) -> bool {
    let Some(raw) = raw.map(str::trim) else {
        return false;
    };
    matches!(raw.to_ascii_lowercase().as_str(), "true" | "1" | "yes")
}

pub fn is_false_attr(raw: Option<&str>) -> bool {
    let Some(raw) = raw.map(str::trim) else {
        return false;
    };
    matches!(raw.to_ascii_lowercase().as_str(), "false" | "0" | "no")
}

pub fn normalize_hex(color: Option<&str>) -> Option<String> {
    let color = color?.trim();
    let hex = color.strip_prefix('#').unwrap_or(color);
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    Some(format!("#{}", hex.to_ascii_lowercase()))
}

const MAPPED_ATTRS: &[&str] = &[
    "id",
    "left",
    "top",
    "width",
    "height",
    "zindex",
    "passthrough",
    "visible",
    "enabled",
    "uptooltip",
    "tooltip",
    "onclick",
    "value",
    "value_onchange",
    "ondragend",
    "image",
    "hoverimage",
    "downimage",
    "donwimage",
    "disabledimage",
    "mappingimage",
    "mappingcolor",
    "thumbimage",
    "thumbhoverimage",
    "thumbdownimage",
    "positionimage",
    "backgroundimage",
    "foregroundimage",
    "transparencycolor",
    "backgroundcolor",
    "foregroundcolor",
    "fontsize",
    "fontstyle",
    "justification",
    "direction",
    "bordersize",
    "min",
    "max",
    "slide",
    "tiled",
    "backgroundtiled",
    "tabstop",
    "resizable",
    "titlebar",
    "scriptfile",
    "onload",
    "onclose",
    "author",
    "copyright",
    "windowed",
    "shrinktofit",
    "stretchtofit",
    "currenteffecttype",
    "currentpreset",
    "dropdownvisible",
    "columnsvisible",
    "columns",
    "playlistitemsvisible",
    "useforegroundprogress",
    "foregroundprogress",
];

pub fn unmapped_attrs(node: &WmsNode, extra_known: &[&str]) -> Vec<(String, String)> {
    let mut known: HashSet<String> = MAPPED_ATTRS.iter().map(|s| (*s).to_string()).collect();
    for a in extra_known {
        known.insert(a.to_ascii_lowercase());
    }
    let mut out = Vec::new();
    for (attr, value) in &node.attrs {
        if known.contains(attr) {
            continue;
        }
        out.push((attr.clone(), value.clone()));
    }
    out
}
