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

fn action_effect(action: &'static str) -> Value {
    json!({ "action": action })
}

fn match_action(stmt: &str, view_ids: &[String]) -> Option<Value> {
    let s = stmt.trim();
    if call_matches(s, "view", "close") {
        return Some(action_effect("skin.exit"));
    }
    if call_matches(s, "view", "minimize") {
        return Some(action_effect("skin.minimize"));
    }
    if call_matches(s, "view", "returnToMediaCenter") {
        return Some(action_effect("skin.restoreMainWindow"));
    }
    if call_matches(s, "eq", "reset") {
        return Some(action_effect("eq.reset"));
    }
    if call_matches(s, "eq", "nextPreset") {
        return Some(action_effect("eq.nextPreset"));
    }
    if call_matches(s, "eq", "previousPreset") {
        return Some(action_effect("eq.previousPreset"));
    }
    if call_matches_alt(s, &["Visualizer", "visEffects"], "previous") {
        return Some(action_effect("visualizer.previous"));
    }
    if call_matches_alt(s, &["Visualizer", "visEffects"], "next") {
        return Some(action_effect("visualizer.next"));
    }
    if call_matches(s, "player.controls", "play") {
        return Some(action_effect("player.play"));
    }
    if call_matches(s, "player.controls", "pause") {
        return Some(action_effect("player.pause"));
    }
    if call_matches(s, "player.controls", "previous") {
        return Some(action_effect("player.previousTrack"));
    }
    if call_matches(s, "player.controls", "next") {
        return Some(action_effect("player.nextTrack"));
    }
    if call_matches(s, "player.controls", "stop") {
        return Some(action_effect("player.stop"));
    }
    let compact = compact_stmt(s);
    if compact == "player.settings.mute=!player.settings.mute" {
        return Some(action_effect("player.toggleMute"));
    }
    if compact == "eq.crossfade=!eq.crossfade" {
        return Some(action_effect("player.toggleCrossfade"));
    }
    if set_mode_is(&compact, "shuffle") {
        return Some(action_effect("player.toggleShuffle"));
    }
    if set_mode_is(&compact, "loop") {
        return Some(action_effect("player.toggleRepeat"));
    }
    if let Some(n) = compact.strip_prefix("player.settings.balance=") {
        if let Ok(raw) = n.parse::<f64>() {
            let balance = if raw.abs() <= 1.0 {
                raw
            } else {
                (raw / 100.0).clamp(-1.0, 1.0)
            };
            return Some(json!({
                "action": "player.setBalance",
                "payload": { "balance": balance },
            }));
        }
    }
    if let Some(name) = call_string_arg(s, "onViewClose") {
        return Some(json!({
            "action": "skin.closeView",
            "payload": { "viewId": close_view_id(&name, view_ids) },
        }));
    }
    if let Some(url) = call_string_arg(s, "player.launchURL") {
        return Some(json!({
            "action": "app.openUrl",
            "payload": { "url": url },
        }));
    }
    None
}

pub fn map_on_click(raw: Option<&str>, view_ids: &[String]) -> (Vec<Value>, Vec<String>) {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return (Vec::new(), Vec::new());
    };
    let mut unmapped = Vec::new();
    let mut effects = Vec::new();
    for part in split_statements(raw) {
        if let Some(effect) = match_action(&part, view_ids) {
            effects.push(effect);
        } else if is_ignorable_onclick(&part) {
            // Skin-sound wrappers and implied trailing calls; the mapped statement still stands.
        } else {
            unmapped.push(part);
        }
    }
    (effects, unmapped)
}

pub fn implicit_element_action(tag: &str) -> Option<&'static str> {
    match tag {
        "playelement" | "playbutton" => Some("player.play"),
        "pauseelement" | "pausebutton" => Some("player.pause"),
        "stopelement" | "stopbutton" => Some("player.stop"),
        "prevelement" | "prevbutton" => Some("player.previousTrack"),
        "nextelement" | "nextbutton" => Some("player.nextTrack"),
        _ => None,
    }
}

/// WMP skins often prefix transport clicks with a WAV play. Trailing UI helpers
/// are implied by the mapped action (preset label refresh, balance tooltip).
fn is_ignorable_onclick(stmt: &str) -> bool {
    let compact = compact_stmt(stmt);
    if compact.starts_with("checksoundpref(") {
        return true;
    }
    if compact == "setpresettext()" {
        return true;
    }
    if compact.starts_with("updatevoltooltip") || compact.starts_with("updatebaltooltip") {
        return true;
    }
    if compact.starts_with("balance.tooltip=") {
        return true;
    }
    compact.starts_with("eq.crossfadewindow=")
}

pub(crate) fn compact_stmt(stmt: &str) -> String {
    let mut s: String = strip_jscript(stmt)
        .replace("wmpprop:", "")
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    while s.ends_with(';') {
        s.pop();
    }
    s
}

fn set_mode_is(compact: &str, mode: &str) -> bool {
    let a = format!("player.settings.setmode('{mode}'");
    let b = format!("player.settings.setmode(\"{mode}\"");
    compact.starts_with(&a) || compact.starts_with(&b)
}

fn get_mode_is(compact: &str, mode: &str) -> bool {
    let a = format!("player.settings.getmode('{mode}')");
    let b = format!("player.settings.getmode(\"{mode}\")");
    compact == a || compact == b
}

fn call_string_arg(stmt: &str, callee: &str) -> Option<String> {
    let s = strip_jscript(stmt);
    let s = s.trim();
    let lower = s.to_ascii_lowercase();
    let prefix = callee.to_ascii_lowercase();
    if !lower.starts_with(&prefix) {
        return None;
    }
    let rest = s[prefix.len()..].trim();
    if rest.len() < 2 || !rest.starts_with('(') || !rest.ends_with(')') {
        return None;
    }
    parse_quoted(rest[1..rest.len() - 1].trim())
}

fn parse_quoted(s: &str) -> Option<String> {
    let bytes = s.as_bytes();
    if bytes.len() < 2 {
        return None;
    }
    let q = bytes[0];
    if (q == b'\'' || q == b'"') && bytes[bytes.len() - 1] == q {
        Some(s[1..s.len() - 1].to_string())
    } else {
        None
    }
}

/// `eqViewer` → `eqview`; `vidViewer` matches `videoview` when that slug is known.
fn close_view_id(arg: &str, known: &[String]) -> String {
    let mut key = arg.trim().to_ascii_lowercase();
    if let Some(rest) = key.strip_suffix("viewer") {
        key = rest.to_string();
    } else if let Some(rest) = key.strip_suffix("view") {
        key = rest.to_string();
    }
    let exact = format!("{key}view");
    if known.iter().any(|id| id == &exact) {
        return exact;
    }
    if let Some(id) = known.iter().find(|id| *id == &key) {
        return id.clone();
    }
    if let Some(id) = known
        .iter()
        .find(|id| id.starts_with(&key) && id.ends_with("view"))
    {
        return id.clone();
    }
    exact
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
        "player.settings.mute" => Some("player.muted".into()),
        "player.controls.currentposition" => Some("player.positionSeconds".into()),
        "player.controls.currentpositionstring" => Some("player.positionLabel".into()),
        "player.currentmedia.name" => Some("track.title".into()),
        "player.currentmedia.durationstring" => Some("player.durationLabel".into()),
        "player.currentmedia.duration" => Some("track.durationSeconds".into()),
        "eq.currentpresettitle" => Some("eq.presetLabel".into()),
        "eq.enabled" => Some("eq.enabled".into()),
        "eq.crossfade" => Some("player.crossfadeEnabled".into()),
        _ => None,
    }
}

fn is_condition_bind(bind: &str) -> bool {
    matches!(
        bind,
        "player.muted" | "player.crossfadeEnabled" | "eq.enabled"
    )
}

/// Sticky `down=` / `visible=` / `enabled=` when the contract has a bind.
pub(crate) fn map_condition(raw: Option<&str>) -> Option<String> {
    if let Some(enabled) = map_wmp_enabled(raw) {
        return Some(enabled.to_string());
    }
    let bind = map_bind(raw)?;
    is_condition_bind(&bind).then_some(bind)
}

pub(crate) fn map_active_when(raw: Option<&str>) -> Option<String> {
    let raw = raw?;
    if let Some(cond) = map_condition(Some(raw)) {
        return Some(cond);
    }
    let compact = compact_stmt(raw);
    if get_mode_is(&compact, "shuffle") {
        return Some("player.shuffle".into());
    }
    if get_mode_is(&compact, "loop") {
        return Some("player.repeatOn".into());
    }
    None
}

pub(crate) fn looks_like_bind_expr(raw: &str) -> bool {
    let t = raw.trim();
    let lower = t.to_ascii_lowercase();
    lower.starts_with("wmpprop:")
        || lower.starts_with("wmpenabled:")
        || lower.starts_with("jscript:")
}

fn map_wmp_enabled(raw: Option<&str>) -> Option<&'static str> {
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
    "down",
    "sticky",
    "downtooltip",
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
    "horizontalalignment",
    "verticalalignment",
    "direction",
    "bordersize",
    "min",
    "max",
    "slide",
    "tiled",
    "backgroundtiled",
    "tabstop",
    "minwidth",
    "minheight",
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_transport_after_sound_pref_wrapper() {
        let (effects, unmapped) = map_on_click(
            Some("checkSoundPref('button.wav');player.controls.previous()"),
            &[],
        );
        assert_eq!(effects[0]["action"], "player.previousTrack");
        assert!(unmapped.is_empty());
    }

    #[test]
    fn implicit_actions_include_standalone_transport_tags() {
        assert_eq!(implicit_element_action("playbutton"), Some("player.play"));
        assert_eq!(
            implicit_element_action("prevbutton"),
            Some("player.previousTrack")
        );
        assert_eq!(implicit_element_action("pausebutton"), Some("player.pause"));
        assert_eq!(
            implicit_element_action("nextbutton"),
            Some("player.nextTrack")
        );
        assert_eq!(implicit_element_action("stopbutton"), Some("player.stop"));
    }

    #[test]
    fn maps_toggles_presets_and_close_view() {
        let (effects, unmapped) =
            map_on_click(Some("player.settings.mute = !player.settings.mute"), &[]);
        assert_eq!(effects[0]["action"], "player.toggleMute");
        assert!(unmapped.is_empty());

        let (effects, unmapped) = map_on_click(
            Some("checkSoundPref('button.wav');player.settings.setMode('shuffle',down);"),
            &[],
        );
        assert_eq!(effects[0]["action"], "player.toggleShuffle");
        assert!(unmapped.is_empty());

        let (effects, unmapped) = map_on_click(Some("eq.nextPreset();setPresetText()"), &[]);
        assert_eq!(effects[0]["action"], "eq.nextPreset");
        assert!(unmapped.is_empty());

        let known = vec!["eqview".into(), "videoview".into()];
        let (effects, unmapped) = map_on_click(Some("onViewClose('eqViewer')"), &known);
        assert_eq!(effects[0]["action"], "skin.closeView");
        assert_eq!(effects[0]["payload"]["viewId"], "eqview");
        assert!(unmapped.is_empty());

        let (effects, _) = map_on_click(Some("onViewClose('vidViewer')"), &known);
        assert_eq!(effects[0]["payload"]["viewId"], "videoview");
    }

    #[test]
    fn maps_sticky_down_and_eq_binds() {
        assert_eq!(
            map_active_when(Some("wmpprop:player.settings.mute")),
            Some("player.muted".into())
        );
        assert_eq!(
            map_active_when(Some("jscript:player.settings.getMode('loop');")),
            Some("player.repeatOn".into())
        );
        assert_eq!(
            map_bind(Some("wmpprop:eq.currentPresetTitle")).as_deref(),
            Some("eq.presetLabel")
        );
        assert_eq!(
            map_condition(Some("wmpprop:eq.crossFade")).as_deref(),
            Some("player.crossfadeEnabled")
        );
    }
}
