use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::{json, Map, Value};

use crate::wms_import::behavior::{apply_behavior_tree, BehaviorPlan};
use crate::wms_import::convert::AssetJob;
use crate::wms_import::map::{
    implicit_element_action, is_false_attr, is_truthy_attr, map_bind, map_on_click, map_style,
    map_tooltip, map_wmp_enabled, normalize_hex, parse_number, unmapped_attrs,
};
use crate::wms_import::parse::WmsNode;
use crate::wms_import::paths::{spiral_asset_path, AssetRole};
use crate::wms_import::report::{GapReport, ReportKind};

pub struct LowerDeps<'a> {
    pub report: &'a mut GapReport,
    pub size_of: &'a mut dyn FnMut(&str) -> Option<(u32, u32)>,
    pub resolve_source: &'a mut dyn FnMut(&str) -> Option<PathBuf>,
    pub jobs: &'a mut HashMap<String, AssetJob>,
    pub behavior: &'a BehaviorPlan,
}

const SKIP_TAGS: &[&str] = &["equalizersettings", "player", "controls", "videosettings"];

const HANDLED_TAGS: &[&str] = &[
    "theme",
    "view",
    "subview",
    "button",
    "buttongroup",
    "buttonelement",
    "playelement",
    "pauseelement",
    "stopelement",
    "prevelement",
    "nextelement",
    "slider",
    "customslider",
    "text",
    "effects",
    "playlist",
    "video",
    "progressbar",
];

pub fn lower_theme(
    theme: &WmsNode,
    deps: &mut LowerDeps<'_>,
    skin_id: &str,
) -> Result<Value, String> {
    let views: Vec<&WmsNode> = theme.children.iter().filter(|c| c.tag == "view").collect();
    if views.is_empty() {
        return Err("WMS theme has no <view>".into());
    }
    let name = theme
        .attrs
        .get("id")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or(skin_id);
    let author = theme
        .attrs
        .get("author")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .unwrap_or("Unknown");
    let description = theme
        .attrs
        .get("copyright")
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("Imported from WMS ({name})."));

    let multi = views.len() > 1;
    let mut view_entries = Map::new();
    for (index, view_node) in views.iter().enumerate() {
        let view_id = if views.len() == 1 {
            "main".to_string()
        } else {
            slug_view_id(view_node.attrs.get("id").map(String::as_str), index)
        };
        view_entries.insert(view_id, lower_view(view_node, deps, multi, index == 0));
    }

    for (attr, value) in unmapped_attrs(theme, &["id", "author", "copyright"]) {
        deps.report.add(
            ReportKind::UnmappedAttr,
            value,
            theme.attrs.get("id").map(String::as_str),
            Some(&attr),
        );
    }

    Ok(json!({
        "id": skin_id,
        "name": name,
        "author": author,
        "description": description,
        "preview": "preview.png",
        "views": view_entries,
    }))
}

fn slug_view_id(id: Option<&str>, index: usize) -> String {
    let Some(id) = id else {
        return if index == 0 {
            "main".into()
        } else {
            format!("view-{}", index + 1)
        };
    };
    let mut s = id.to_string();
    if s.to_ascii_lowercase().ends_with("box") {
        s.truncate(s.len() - 3);
    }
    let s = s.to_ascii_lowercase();
    if s.is_empty() {
        format!("view-{}", index + 1)
    } else {
        s
    }
}

fn lower_view(node: &WmsNode, deps: &mut LowerDeps<'_>, multi: bool, is_first: bool) -> Value {
    let width = parse_number(node.attrs.get("width").map(String::as_str)).unwrap_or(0.0);
    let height = parse_number(node.attrs.get("height").map(String::as_str)).unwrap_or(0.0);
    let resizable = is_truthy_attr(node.attrs.get("resizable").map(String::as_str));
    let mut ids = IdGen::new();
    let mut children = lower_children(node, deps, &mut ids);

    if let Some(bg) = node.attrs.get("backgroundimage") {
        if !is_builtin_image(bg) {
            if let Some(deco) = background_decoration(
                "view-bg",
                bg,
                json!({ "x": 0, "y": 0, "w": width, "h": height }),
                deps,
            ) {
                children.insert(0, deco);
            }
        }
    }

    leftover_jscript(node, deps);
    for (attr, value) in unmapped_attrs(node, &[]) {
        deps.report.add(
            ReportKind::UnmappedAttr,
            value,
            node.attrs.get("id").map(String::as_str),
            Some(&attr),
        );
    }

    let mut window = json!({
        "defaultWidth": width,
        "defaultHeight": height,
        "minWidth": width,
        "minHeight": height,
        "resizable": resizable,
        "snapEnabled": false,
    });
    if !resizable {
        window["maxWidth"] = json!(width);
        window["maxHeight"] = json!(height);
    }

    let mut view = json!({
        "window": window,
        "layout": {
            "type": "canvas",
            "width": width,
            "height": height,
            "children": children,
        },
    });
    if multi && is_first {
        view["presentation"] = json!("primary");
    } else if multi {
        view["presentation"] = json!("auxiliary");
    }
    if !deps.behavior.is_empty() {
        if let Some(layout) = view.get_mut("layout") {
            apply_behavior_tree(layout, deps.behavior);
        }
        if view_owns_behavior(&view, deps.behavior) {
            view["state"] = deps.behavior.state_json();
        }
    }
    view
}

fn view_owns_behavior(view: &Value, plan: &BehaviorPlan) -> bool {
    if plan.variables.is_empty() {
        return false;
    }
    let Some(layout) = view.get("layout") else {
        return true;
    };
    plan.target_ids
        .iter()
        .any(|id| json_contains_id(layout, id))
}

fn json_contains_id(node: &Value, id: &str) -> bool {
    if node.get("id").and_then(|v| v.as_str()) == Some(id) {
        return true;
    }
    if let Some(children) = node.get("children").and_then(|c| c.as_array()) {
        if children.iter().any(|c| json_contains_id(c, id)) {
            return true;
        }
    }
    false
}

fn map_clicks(raw: Option<&str>, behavior: &BehaviorPlan) -> (Vec<Value>, Vec<String>) {
    let (mut effects, unmapped) = map_on_click(raw);
    let mut rest = Vec::new();
    for stmt in unmapped {
        if let Some(more) = behavior.effects_for_statement(&stmt) {
            effects.extend(more);
        } else {
            rest.push(stmt);
        }
    }
    (effects, rest)
}

fn leftover_jscript(node: &WmsNode, deps: &mut LowerDeps<'_>) {
    for (attr, value) in &node.attrs {
        if value.len() >= 8 && value[..8].eq_ignore_ascii_case("jscript:") {
            deps.report.add(
                ReportKind::Jscript,
                value.clone(),
                node.attrs.get("id").map(String::as_str),
                Some(attr),
            );
        }
    }
}

struct IdGen {
    n: u32,
}

impl IdGen {
    fn new() -> Self {
        Self { n: 0 }
    }
    fn next(&mut self, prefix: &str) -> String {
        self.n += 1;
        format!("{prefix}-{}", self.n)
    }
}

fn lower_children(parent: &WmsNode, deps: &mut LowerDeps<'_>, ids: &mut IdGen) -> Vec<Value> {
    let mut out = Vec::new();
    for child in &parent.children {
        out.extend(lower_node(child, deps, ids));
    }
    out
}

fn lower_node(node: &WmsNode, deps: &mut LowerDeps<'_>, ids: &mut IdGen) -> Vec<Value> {
    leftover_jscript(node, deps);

    if SKIP_TAGS.contains(&node.tag.as_str()) {
        return Vec::new();
    }

    if is_nonvisual_hidden(node) {
        let node_id = node
            .attrs
            .get("id")
            .map(String::as_str)
            .unwrap_or(&node.tag);
        deps.report.add(
            ReportKind::Hidden,
            "omitted non-visual text (tooltip/string bag)".to_string(),
            Some(node_id),
            None,
        );
        return Vec::new();
    }

    let starts_hidden = is_false_attr(node.attrs.get("visible").map(String::as_str));

    if node.tag == "video" {
        deps.report.add(
            ReportKind::UnmappedElement,
            "video has no Spiral node type",
            node.attrs.get("id").map(String::as_str),
            None,
        );
        return Vec::new();
    }

    if !HANDLED_TAGS.contains(&node.tag.as_str()) {
        deps.report.add(
            ReportKind::UnmappedElement,
            format!("<{}> skipped", node.tag),
            node.attrs.get("id").map(String::as_str),
            None,
        );
        for (attr, value) in unmapped_attrs(node, &[]) {
            deps.report.add(
                ReportKind::UnmappedAttr,
                value,
                node.attrs.get("id").map(String::as_str),
                Some(&attr),
            );
        }
        return Vec::new();
    }

    let out = match node.tag.as_str() {
        "subview" => maybe_list(lower_subview(node, deps, ids)),
        "button" => maybe_list(lower_button(node, deps, ids)),
        "buttongroup" => maybe_list(lower_button_group(node, deps, ids)),
        "slider" | "customslider" | "progressbar" => maybe_list(lower_slider(node, deps, ids)),
        "text" => maybe_list(lower_text(node, deps, ids)),
        "effects" => maybe_list(Some(lower_visualizer(node, deps, ids))),
        "playlist" => maybe_list(Some(lower_playlist(node, deps, ids))),
        _ => Vec::new(),
    };
    if starts_hidden && !out.is_empty() {
        let node_id = node
            .attrs
            .get("id")
            .map(String::as_str)
            .unwrap_or(&node.tag);
        deps.report.add(
            ReportKind::Hidden,
            "starts hidden (visible=false; JS may toggle)",
            Some(node_id),
            None,
        );
    }
    out
}

fn maybe_list(node: Option<Value>) -> Vec<Value> {
    node.into_iter().collect()
}

fn lower_subview(node: &WmsNode, deps: &mut LowerDeps<'_>, ids: &mut IdGen) -> Option<Value> {
    let id = node
        .attrs
        .get("id")
        .cloned()
        .unwrap_or_else(|| ids.next("subview"));
    let bounds = bounds_from(
        node,
        deps,
        node.attrs.get("backgroundimage").map(String::as_str),
    );
    let mut children = lower_children(node, deps, ids);
    if let Some(bg) = node.attrs.get("backgroundimage") {
        if !is_builtin_image(bg) {
            let bw = bounds.get("w").cloned().unwrap_or(json!(0));
            let bh = bounds.get("h").cloned().unwrap_or(json!(0));
            if let Some(deco) = background_decoration(
                &format!("{id}-bg"),
                bg,
                json!({ "x": 0, "y": 0, "w": bw, "h": bh }),
                deps,
            ) {
                children.insert(0, deco);
            }
        }
    }
    report_unmapped(node, deps, &[]);
    let mut subview = json!({
        "type": "subview",
        "id": id,
        "bounds": bounds,
        "children": children,
    });
    if is_truthy_attr(node.attrs.get("passthrough").map(String::as_str)) {
        subview["passthrough"] = json!(true);
    }
    Some(subview)
}

fn background_decoration(
    id: &str,
    image: &str,
    bounds: Value,
    deps: &mut LowerDeps<'_>,
) -> Option<Value> {
    let dest = register_image(image, AssetRole::Decoration, deps, Some("decorations"))?;
    Some(json!({
        "type": "decoration",
        "id": id,
        "bounds": bounds,
        "presentation": {
            "kind": "bitmap",
            "assets": { "default": dest },
        },
    }))
}

fn lower_button(node: &WmsNode, deps: &mut LowerDeps<'_>, ids: &mut IdGen) -> Option<Value> {
    let image = node.attrs.get("image");
    if let Some(image) = image {
        if is_builtin_image(image) {
            deps.report.add(
                ReportKind::BuiltinImage,
                image.clone(),
                node.attrs.get("id").map(String::as_str),
                None,
            );
            if image.to_ascii_lowercase().contains("albumart") {
                let id = node
                    .attrs
                    .get("id")
                    .cloned()
                    .unwrap_or_else(|| ids.next("artwork"));
                return Some(json!({
                    "type": "artwork",
                    "id": id,
                    "bounds": bounds_from(node, deps, None),
                    "presentation": { "kind": "css", "className": "skin-artwork" },
                }));
            }
            return None;
        }
    }

    let id = node
        .attrs
        .get("id")
        .cloned()
        .unwrap_or_else(|| ids.next("button"));
    let (effects, unmapped) =
        map_clicks(node.attrs.get("onclick").map(String::as_str), deps.behavior);
    for stmt in unmapped {
        deps.report
            .add(ReportKind::UnmappedAction, stmt, Some(&id), Some("onClick"));
    }
    let Some(assets) = interactive_assets(node, deps, "buttons") else {
        deps.report
            .add(ReportKind::Info, "button has no image", Some(&id), None);
        return None;
    };
    let mut button = json!({
        "type": "button",
        "id": id,
        "bounds": bounds_from(node, deps, image.map(String::as_str)),
        "presentation": {
            "kind": "bitmap",
            "assets": assets,
            "width": parse_number(node.attrs.get("width").map(String::as_str)),
            "height": parse_number(node.attrs.get("height").map(String::as_str)),
        },
    });
    // Drop null width/height from presentation
    if let Some(pres) = button
        .get_mut("presentation")
        .and_then(|v| v.as_object_mut())
    {
        if pres.get("width").map(|v| v.is_null()).unwrap_or(false) {
            pres.remove("width");
        }
        if pres.get("height").map(|v| v.is_null()).unwrap_or(false) {
            pres.remove("height");
        }
    }
    if !effects.is_empty() {
        button["onClick"] = Value::Array(effects);
    }
    if let Some(tip) = map_tooltip(node) {
        button["tooltip"] = json!(tip);
    }
    if let Some(enabled_when) = map_wmp_enabled(
        node.attrs
            .get("enabled")
            .or_else(|| node.attrs.get("tabstop"))
            .map(String::as_str),
    ) {
        button["enabledWhen"] = json!(enabled_when);
    }
    let visible_raw = node.attrs.get("visible").map(String::as_str);
    if let Some(vis_when) = map_wmp_enabled(visible_raw) {
        if !is_false_attr(visible_raw)
            && !visible_raw
                .map(|v| v.eq_ignore_ascii_case("true"))
                .unwrap_or(false)
        {
            button["visibleWhen"] = json!(vis_when);
        }
    }
    report_unmapped(node, deps, &[]);
    Some(button)
}

fn lower_button_group(node: &WmsNode, deps: &mut LowerDeps<'_>, ids: &mut IdGen) -> Option<Value> {
    let id = node
        .attrs
        .get("id")
        .cloned()
        .unwrap_or_else(|| ids.next("buttongroup"));
    let assets = interactive_assets(node, deps, "buttons");
    let position_map = node
        .attrs
        .get("mappingimage")
        .and_then(|map_name| register_image(map_name, AssetRole::Map, deps, Some("buttons")));
    let (Some(assets), Some(position_map)) = (assets, position_map) else {
        deps.report.add(
            ReportKind::Info,
            "buttongroup missing image or mappingImage",
            Some(&id),
            None,
        );
        return None;
    };

    let mut elements = Vec::new();
    for child in &node.children {
        let Some(mapping_color) =
            normalize_hex(child.attrs.get("mappingcolor").map(String::as_str))
        else {
            deps.report.add(
                ReportKind::UnmappedElement,
                format!("{} missing mappingColor", child.tag),
                child.attrs.get("id").map(String::as_str).or(Some(&id)),
                None,
            );
            continue;
        };
        let implicit = implicit_element_action(&child.tag);
        let (mapped_effects, mapped_unmapped) = map_clicks(
            child.attrs.get("onclick").map(String::as_str),
            deps.behavior,
        );
        for stmt in &mapped_unmapped {
            deps.report.add(
                ReportKind::UnmappedAction,
                stmt.clone(),
                child.attrs.get("id").map(String::as_str).or(Some(&id)),
                Some("onClick"),
            );
        }
        let mut effects = mapped_effects;
        if let Some(action) = implicit {
            if effects.is_empty() {
                effects.push(json!({ "action": action }));
            }
        }
        if effects.is_empty() && mapped_unmapped.is_empty() {
            deps.report.add(
                ReportKind::UnmappedAction,
                child
                    .attrs
                    .get("onclick")
                    .cloned()
                    .unwrap_or_else(|| format!("{} has no mapped onClick", child.tag)),
                child.attrs.get("id").map(String::as_str).or(Some(&id)),
                None,
            );
        }
        let mut el = json!({
            "mappingColor": mapping_color,
        });
        if !effects.is_empty() {
            el["onClick"] = Value::Array(effects);
        }
        if let Some(tip) = map_tooltip(child) {
            el["tooltip"] = json!(tip);
        }
        if let Some(enabled_when) = map_wmp_enabled(
            child
                .attrs
                .get("enabled")
                .or_else(|| child.attrs.get("tabstop"))
                .map(String::as_str),
        ) {
            el["enabledWhen"] = json!(enabled_when);
        }
        elements.push(el);
        report_unmapped(child, deps, &["mappingcolor"]);
    }

    if elements.is_empty() {
        deps.report.add(
            ReportKind::Info,
            "buttongroup had no mapped elements",
            Some(&id),
            None,
        );
        return None;
    }

    let bounds = bounds_from(node, deps, node.attrs.get("image").map(String::as_str));
    report_unmapped(node, deps, &[]);
    let bw = bounds.get("w").cloned().unwrap_or(json!(0));
    let bh = bounds.get("h").cloned().unwrap_or(json!(0));

    let mut group = json!({
        "type": "buttonGroup",
        "id": id,
        "bounds": bounds,
        "presentation": {
            "kind": "buttonGroup",
            "assets": assets,
            "positionMap": position_map,
            "width": bw,
            "height": bh,
            "elements": elements,
        },
    });
    if let Some(vis_when) = map_wmp_enabled(node.attrs.get("visible").map(String::as_str)) {
        if node
            .attrs
            .get("visible")
            .map(|v| !v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
        {
            group["visibleWhen"] = json!(vis_when);
        }
    }
    Some(group)
}

fn lower_slider(node: &WmsNode, deps: &mut LowerDeps<'_>, ids: &mut IdGen) -> Option<Value> {
    let id = node
        .attrs
        .get("id")
        .cloned()
        .unwrap_or_else(|| ids.next("slider"));
    let bind = map_bind(node.attrs.get("value").map(String::as_str));
    let direction = if node
        .attrs
        .get("direction")
        .map(|d| d.eq_ignore_ascii_case("vertical"))
        .unwrap_or(false)
    {
        "vertical"
    } else {
        "horizontal"
    };
    let bounds = bounds_from(
        node,
        deps,
        node.attrs
            .get("backgroundimage")
            .or_else(|| node.attrs.get("foregroundimage"))
            .or_else(|| node.attrs.get("thumbimage"))
            .map(String::as_str),
    );
    let Some(presentation) = slider_presentation(node, deps, &bounds, direction) else {
        deps.report.add(
            ReportKind::Info,
            "slider missing thumb/track images",
            Some(&id),
            None,
        );
        return None;
    };
    if let Some(border_note) = node.attrs.get("ondragend") {
        deps.report.add(
            ReportKind::UnmappedAttr,
            border_note.clone(),
            Some(&id),
            Some("onDragEnd"),
        );
    }
    let tip = map_tooltip(node);
    let gain = bind.as_ref().and_then(|b| {
        b.strip_prefix("eq.band.")
            .and_then(|n| n.parse::<u32>().ok())
    });
    let eq_spread_onchange = node
        .attrs
        .get("value_onchange")
        .is_some_and(|v| deps.behavior.is_eq_linear_spread_onchange(v));

    if let Some(v) = node.attrs.get("value_onchange") {
        let mapped = is_standard_volume_onchange(v)
            || eq_spread_onchange
            || gain.is_some_and(|g| is_standard_eq_identity_onchange(v, g));
        if !mapped {
            deps.report.add(
                ReportKind::UnmappedAttr,
                v.clone(),
                Some(&id),
                Some("value_onchange"),
            );
        }
    }

    if let Some(gain) = gain {
        if (1..=10).contains(&gain) {
            let mut n = json!({
                "type": "eqBand",
                "id": id,
                "band": gain,
                "bounds": bounds,
                "presentation": presentation,
            });
            if eq_spread_onchange && matches!(gain, 1 | 10) {
                n["spread"] = json!("linear");
            }
            if let Some(tip) = tip {
                n["tooltip"] = json!(tip);
            }
            report_unmapped(node, deps, &[]);
            return Some(n);
        }
    }
    if bind.as_deref() == Some("player.volume") || id.to_ascii_lowercase().contains("vol") {
        let mut n = json!({
            "type": "volume",
            "id": id,
            "bounds": bounds,
            "presentation": presentation,
        });
        if let Some(bind) = bind {
            n["bind"] = json!(bind);
        }
        if let Some(tip) = tip {
            n["tooltip"] = json!(tip);
        }
        report_unmapped(node, deps, &[]);
        return Some(n);
    }
    if bind.as_deref() == Some("player.balance") || id.to_ascii_lowercase().contains("balance") {
        let mut n = json!({
            "type": "balance",
            "id": id,
            "bounds": bounds,
            "presentation": presentation,
        });
        if let Some(bind) = bind {
            n["bind"] = json!(bind);
        }
        if let Some(tip) = tip {
            n["tooltip"] = json!(tip);
        }
        report_unmapped(node, deps, &[]);
        return Some(n);
    }

    let mut seek = json!({
        "type": "seekbar",
        "id": id,
        "bounds": bounds,
        "presentation": presentation,
    });
    if let Some(bind) = bind {
        seek["bind"] = json!(bind);
    }
    if let Some(tip) = tip {
        seek["tooltip"] = json!(tip);
    }
    report_unmapped(node, deps, &[]);
    Some(seek)
}

fn slider_presentation(
    node: &WmsNode,
    deps: &mut LowerDeps<'_>,
    bounds: &Value,
    direction: &str,
) -> Option<Value> {
    let thumb_name = node.attrs.get("thumbimage");
    let track_name = node.attrs.get("backgroundimage");
    let fill_name = node.attrs.get("foregroundimage");
    let thumb =
        thumb_name.and_then(|n| register_image(n, AssetRole::Default, deps, Some("sliders")));
    let thumb_hover = node
        .attrs
        .get("thumbhoverimage")
        .and_then(|n| register_image(n, AssetRole::Hover, deps, Some("sliders")));
    let thumb_pressed = node
        .attrs
        .get("thumbdownimage")
        .and_then(|n| register_image(n, AssetRole::Pressed, deps, Some("sliders")));
    let track = track_name.and_then(|n| register_image(n, AssetRole::Track, deps, Some("sliders")));
    let fill = fill_name.and_then(|n| register_image(n, AssetRole::Track, deps, Some("sliders")));
    let thumb_size = thumb_name.and_then(|n| (deps.size_of)(n));
    let track_size = track_name.and_then(|n| (deps.size_of)(n));
    let fill_size = fill_name.and_then(|n| (deps.size_of)(n));
    let border_size = parse_number(node.attrs.get("bordersize").map(String::as_str));
    let mut track_width = bounds
        .get("w")
        .and_then(|v| v.as_f64())
        .or_else(|| track_size.map(|(w, _)| w as f64))
        .or_else(|| fill_size.map(|(w, _)| w as f64))
        .unwrap_or(0.0);
    let mut track_height = bounds
        .get("h")
        .and_then(|v| v.as_f64())
        .or_else(|| track_size.map(|(_, h)| h as f64))
        .or_else(|| fill_size.map(|(_, h)| h as f64))
        .unwrap_or(0.0);
    let thumb_width = thumb_size.map(|(w, _)| w as f64).unwrap_or(0.0);
    let thumb_height = thumb_size.map(|(_, h)| h as f64).unwrap_or(0.0);

    if thumb.is_none() && track.is_none() && fill.is_none() {
        return None;
    }

    // Thumb-only sliders paint the groove in the panel art. WMS width/height is
    // often 1px larger than the thumb on the cross axis (Nature seek 17 vs 16,
    // volume 25 vs 24), which centers the thumb on a half-pixel and clips it.
    // Snap that axis down to the thumb; keep the travel axis and layout bounds.
    if track.is_none() && fill.is_none() {
        if direction == "vertical" {
            if thumb_width > 0.0 && thumb_width < track_width {
                track_width = thumb_width;
            }
        } else if thumb_height > 0.0 && thumb_height < track_height {
            track_height = thumb_height;
        }
    }

    let kind = if direction == "vertical" {
        "bitmapVerticalSlider"
    } else {
        "bitmapHorizontalSlider"
    };
    let mut thumb_obj = json!({
        "default": thumb
            .or_else(|| track.clone())
            .or_else(|| fill.clone())
            .unwrap_or_else(|| "sliders/missing.png".into()),
    });
    if let Some(thumb_hover) = thumb_hover {
        thumb_obj["hover"] = json!(thumb_hover);
    }
    if let Some(thumb_pressed) = thumb_pressed {
        thumb_obj["pressed"] = json!(thumb_pressed);
    }
    let mut out = json!({
        "kind": kind,
        "thumb": thumb_obj,
        "trackWidth": track_width,
        "trackHeight": track_height,
        "thumbWidth": if thumb_width > 0.0 {
            thumb_width
        } else if direction == "vertical" {
            track_width
        } else {
            12.0
        },
        "thumbHeight": if thumb_height > 0.0 {
            thumb_height
        } else if direction == "vertical" {
            12.0
        } else {
            track_height
        },
    });
    if let Some(track) = track {
        out["track"] = json!(track);
        if let Some((w, h)) = track_size {
            out["trackTileWidth"] = json!(w);
            out["trackTileHeight"] = json!(h);
        }
    }
    if let Some(fill) = fill {
        out["fill"] = json!(fill);
    }
    if let Some(border_size) = border_size {
        out["borderSize"] = json!(border_size);
    }
    Some(out)
}

fn lower_text(node: &WmsNode, deps: &mut LowerDeps<'_>, ids: &mut IdGen) -> Option<Value> {
    let id = node
        .attrs
        .get("id")
        .cloned()
        .unwrap_or_else(|| ids.next("text"));
    let bind = map_bind(node.attrs.get("value").map(String::as_str));
    let (style, unmapped) = map_style(node);
    for (attr, value) in unmapped {
        deps.report
            .add(ReportKind::UnmappedAttr, value, Some(&id), Some(&attr));
    }
    let mut text = json!({
        "type": "text",
        "id": id,
        "bounds": bounds_from(node, deps, None),
    });
    if let Some(bind) = bind {
        text["bind"] = json!(bind);
    } else if let Some(value) = node.attrs.get("value") {
        if value.len() < 8 || !value[..8].eq_ignore_ascii_case("wmpprop:") {
            text["value"] = json!(value);
        } else {
            deps.report.add(
                ReportKind::UnmappedAttr,
                value.clone(),
                Some(&id),
                Some("value"),
            );
        }
    }
    if let Some(style) = style {
        text["style"] = Value::Object(style);
    }
    report_unmapped(node, deps, &["fontface", "fonttype", "fontsmoothing"]);
    Some(text)
}

fn lower_visualizer(node: &WmsNode, deps: &mut LowerDeps<'_>, ids: &mut IdGen) -> Value {
    let id = node
        .attrs
        .get("id")
        .cloned()
        .unwrap_or_else(|| ids.next("visualizer"));
    let (effects, unmapped) =
        map_clicks(node.attrs.get("onclick").map(String::as_str), deps.behavior);
    for stmt in unmapped {
        deps.report
            .add(ReportKind::UnmappedAction, stmt, Some(&id), Some("onClick"));
    }
    report_unmapped(
        node,
        deps,
        &["currenteffecttype", "currentpreset", "windowed"],
    );
    let mut vis = json!({
        "type": "visualizer",
        "id": id,
        "bounds": bounds_from(node, deps, None),
        "presentation": { "kind": "css", "className": "skin-visualizer" },
    });
    if !effects.is_empty() {
        vis["onClick"] = Value::Array(effects);
    }
    vis
}

fn lower_playlist(node: &WmsNode, deps: &mut LowerDeps<'_>, ids: &mut IdGen) -> Value {
    let id = node
        .attrs
        .get("id")
        .cloned()
        .unwrap_or_else(|| ids.next("playlist"));
    let (style, _) = map_style(node);
    report_unmapped(
        node,
        deps,
        &[
            "dropdownvisible",
            "columnsvisible",
            "columns",
            "playlistitemsvisible",
        ],
    );
    let mut pl = json!({
        "type": "playlist",
        "id": id,
        "bounds": bounds_from(node, deps, None),
        "showDropdown": !is_false_attr(node.attrs.get("dropdownvisible").map(String::as_str)),
    });
    if let Some(style) = style {
        pl["style"] = Value::Object(style);
    }
    pl
}

fn interactive_assets(
    node: &WmsNode,
    deps: &mut LowerDeps<'_>,
    folder: &str,
) -> Option<Map<String, Value>> {
    let def = node.attrs.get("image")?;
    if is_builtin_image(def) {
        return None;
    }
    let default_path = register_image(def, AssetRole::Default, deps, Some(folder))?;
    let mut assets = Map::new();
    assets.insert("default".into(), json!(default_path));
    if let Some(hover) = node.attrs.get("hoverimage") {
        if let Some(p) = register_image(hover, AssetRole::Hover, deps, Some(folder)) {
            assets.insert("hover".into(), json!(p));
        }
    }
    let down = node
        .attrs
        .get("downimage")
        .or_else(|| node.attrs.get("donwimage"));
    if let Some(down) = down {
        if let Some(p) = register_image(down, AssetRole::Pressed, deps, Some(folder)) {
            assets.insert("pressed".into(), json!(p));
        }
    }
    if let Some(disabled) = node.attrs.get("disabledimage") {
        if let Some(p) = register_image(disabled, AssetRole::Disabled, deps, Some(folder)) {
            assets.insert("disabled".into(), json!(p));
        }
    }
    Some(assets)
}

fn register_image(
    source_name: &str,
    role: AssetRole,
    deps: &mut LowerDeps<'_>,
    folder: Option<&str>,
) -> Option<String> {
    if is_builtin_image(source_name) {
        deps.report
            .add(ReportKind::BuiltinImage, source_name, None, None);
        return None;
    }
    let folder_hint = match folder {
        Some("decorations") => Some("decorations"),
        Some("buttons") => Some("buttons"),
        Some("sliders") => Some("sliders"),
        _ => None,
    };
    let source_path = (deps.resolve_source)(source_name);
    let mut dest_rel = spiral_asset_path(source_name, role, folder_hint);
    // Single-frame GIFs are converted to PNG (static chromakey path).
    if let Some(ref path) = source_path {
        if crate::skin_convert::gif_frame_count(path) == Some(1) && dest_rel.ends_with(".gif") {
            dest_rel = dest_rel.trim_end_matches(".gif").to_string() + ".png";
        }
    }
    if source_path.is_none() {
        deps.report
            .add(ReportKind::MissingFile, source_name, None, None);
        return Some(dest_rel);
    }
    if let Some(source_path) = source_path {
        if !deps.jobs.contains_key(&dest_rel) {
            deps.jobs.insert(
                dest_rel.clone(),
                AssetJob {
                    source_name: source_name.to_string(),
                    source_path,
                    dest_rel: dest_rel.clone(),
                    preserve_color: role == AssetRole::Map,
                },
            );
        }
    }
    Some(dest_rel)
}

fn bounds_from(node: &WmsNode, deps: &mut LowerDeps<'_>, size_from: Option<&str>) -> Value {
    let raster = size_from.and_then(|name| (deps.size_of)(name));
    let x = parse_number(node.attrs.get("left").map(String::as_str));
    let y = parse_number(node.attrs.get("top").map(String::as_str));
    let mut w = parse_number(node.attrs.get("width").map(String::as_str))
        .or_else(|| raster.map(|(w, _)| w as f64));
    let mut h = parse_number(node.attrs.get("height").map(String::as_str))
        .or_else(|| raster.map(|(_, h)| h as f64));
    let z = parse_number(node.attrs.get("zindex").map(String::as_str));
    let font_size = parse_number(node.attrs.get("fontsize").map(String::as_str));
    if h.is_none() && y.is_some() {
        h = Some(match font_size {
            Some(fs) => (12.0_f64).max(fs + 3.0),
            None => 12.0,
        });
    }
    if w.is_none() && x.is_some() {
        w = Some(raster.map(|(rw, _)| rw as f64).unwrap_or(1.0));
    }
    let mut bounds = Map::new();
    if let Some(x) = x {
        bounds.insert("x".into(), json!(x));
    }
    if let Some(y) = y {
        bounds.insert("y".into(), json!(y));
    }
    if let Some(w) = w {
        bounds.insert("w".into(), json!(w));
    }
    if let Some(h) = h {
        bounds.insert("h".into(), json!(h));
    }
    if let Some(z) = z {
        bounds.insert("zIndex".into(), json!(z));
    }
    // WMS often omits left/top on children that sit at the parent origin
    // (Nature svScreenCtrls buttongroup). Spiral bounds require x and y.
    if !bounds.is_empty() {
        bounds.entry("x".to_string()).or_insert(json!(0));
        bounds.entry("y".to_string()).or_insert(json!(0));
    }
    Value::Object(bounds)
}

fn report_unmapped(node: &WmsNode, deps: &mut LowerDeps<'_>, extra: &[&str]) {
    for (attr, value) in unmapped_attrs(node, extra) {
        deps.report.add(
            ReportKind::UnmappedAttr,
            value,
            node.attrs.get("id").map(String::as_str),
            Some(&attr),
        );
    }
}

/// Identity write of the bound band — implied by `eqBand`, same as volume's `=value`.
fn is_standard_eq_identity_onchange(raw: &str, band: u32) -> bool {
    use crate::wms_import::map::split_statements;
    let stmts = split_statements(raw);
    if stmts.len() != 1 {
        return false;
    }
    let compact: String = stmts[0]
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    compact == format!("eq.gainlevel{band}=value")
}

/// WMP volume sliders often clear mute on change; Spiral `setVolume` already does that.
fn is_standard_volume_onchange(raw: &str) -> bool {
    let compact: String = raw
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    compact == "player.settings.volume=value;player.settings.mute='false';"
        || compact == "player.settings.volume=value;player.settings.mute=\"false\";"
        || compact == "player.settings.volume=value;"
}

pub fn is_builtin_image(name: &str) -> bool {
    name.trim().to_ascii_lowercase().starts_with("wmpimage_")
}

fn has_layout_box(node: &WmsNode) -> bool {
    ["left", "top", "width", "height", "backgroundimage", "image"]
        .iter()
        .any(|key| node.attrs.contains_key(*key))
}

/// Hidden text with no box is a WMP string bag (tooltips), not JS-toggled UI.
fn is_nonvisual_hidden(node: &WmsNode) -> bool {
    node.tag == "text"
        && is_false_attr(node.attrs.get("visible").map(String::as_str))
        && !has_layout_box(node)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wms_import::parse::parse_wms_xml;
    use crate::wms_import::report::{GapReport, ReportKind};

    #[test]
    fn maps_play_prev_next_and_close() {
        let root = parse_wms_xml(
            r##"
      <theme id="Plus! Nature" author="Microsoft">
        <view width="474" height="600">
          <buttongroup id="transport" left="10" top="20" width="100" height="31"
            mappingImage="map.bmp" image="sheet.bmp" hoverImage="sheet_rv.bmp">
            <prevelement mappingColor="#FF9900"/>
            <playelement mappingColor="#FF6600"/>
            <nextelement mappingColor="#FF3300"/>
            <stopelement mappingColor="#FFCC00"/>
          </buttongroup>
          <button id="quit" left="0" top="0" image="quit.bmp" onClick="view.close();" upToolTip="Close"/>
        </view>
      </theme>
    "##,
        )
        .expect("parse");
        let mut report = GapReport::new();
        let mut jobs = HashMap::new();
        let sizes: HashMap<&str, (u32, u32)> = [("sheet.bmp", (100, 31)), ("quit.bmp", (12, 12))]
            .into_iter()
            .collect();
        let mut size_of = |name: &str| sizes.get(name).copied();
        let mut resolve = |name: &str| Some(PathBuf::from(format!("/tmp/{name}")));
        let plan = BehaviorPlan::empty();
        let mut deps = LowerDeps {
            report: &mut report,
            size_of: &mut size_of,
            resolve_source: &mut resolve,
            jobs: &mut jobs,
            behavior: &plan,
        };
        let manifest = lower_theme(&root, &mut deps, "plus-nature").expect("lower");
        let children = &manifest["views"]["main"]["layout"]["children"];
        let group = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["type"] == "buttonGroup")
            .expect("group");
        let actions: Vec<_> = group["presentation"]["elements"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| e["onClick"][0]["action"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            actions,
            vec![
                "player.previousTrack",
                "player.play",
                "player.nextTrack",
                "player.stop"
            ]
        );
        assert_eq!(
            group["presentation"]["positionMap"].as_str(),
            Some("buttons/map-map.png")
        );
        let quit = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "quit")
            .expect("quit");
        assert_eq!(quit["type"], "button");
        assert_eq!(quit["onClick"][0]["action"], "skin.exit");
    }

    #[test]
    fn maps_buttongroup_disabled_image() {
        let root = parse_wms_xml(
            r##"
      <theme id="Plus! Nature">
        <view width="474" height="600">
          <buttongroup id="transport" left="10" top="20" width="171" height="55"
            mappingImage="btn_play_controls_colormap.bmp"
            image="btn_play_controls_default.bmp"
            hoverImage="btn_play_controls_rv.bmp"
            downImage="btn_play_controls_down.bmp"
            disabledImage="btn_play_controls_disabled.bmp">
            <playelement mappingColor="#FF6600" tabStop="wmpenabled:player.controls.play();"/>
          </buttongroup>
        </view>
      </theme>
    "##,
        )
        .expect("parse");
        let mut report = GapReport::new();
        let mut jobs = HashMap::new();
        let sizes: HashMap<&str, (u32, u32)> = [("btn_play_controls_default.bmp", (171, 55))]
            .into_iter()
            .collect();
        let mut size_of = |name: &str| sizes.get(name).copied();
        let mut resolve = |name: &str| Some(PathBuf::from(format!("/tmp/{name}")));
        let plan = BehaviorPlan::empty();
        let mut deps = LowerDeps {
            report: &mut report,
            size_of: &mut size_of,
            resolve_source: &mut resolve,
            jobs: &mut jobs,
            behavior: &plan,
        };
        let manifest = lower_theme(&root, &mut deps, "plus-nature").expect("lower");
        let group = &manifest["views"]["main"]["layout"]["children"][0];
        let assets = &group["presentation"]["assets"];
        assert_eq!(
            assets["default"].as_str(),
            Some("buttons/play-controls.png")
        );
        assert_eq!(
            assets["hover"].as_str(),
            Some("buttons/play-controls-hover.png")
        );
        assert_eq!(
            assets["pressed"].as_str(),
            Some("buttons/play-controls-pressed.png")
        );
        assert_eq!(
            assets["disabled"].as_str(),
            Some("buttons/play-controls-disabled.png")
        );
        assert!(jobs.contains_key("buttons/play-controls-disabled.png"));
        assert_eq!(
            group["presentation"]["elements"][0]["enabledWhen"].as_str(),
            Some("player.notPlaying")
        );
    }

    #[test]
    fn fills_missing_text_height() {
        let root = parse_wms_xml(
            r#"
      <theme id="Demo" author="MS">
        <view width="200" height="100">
          <text left="10" top="20" width="80" fontSize="9" value="Title"/>
        </view>
      </theme>
    "#,
        )
        .expect("parse");
        let mut report = GapReport::new();
        let mut jobs = HashMap::new();
        let mut size_of = |_name: &str| None;
        let mut resolve = |_name: &str| None;
        let plan = BehaviorPlan::empty();
        let mut deps = LowerDeps {
            report: &mut report,
            size_of: &mut size_of,
            resolve_source: &mut resolve,
            jobs: &mut jobs,
            behavior: &plan,
        };
        let manifest = lower_theme(&root, &mut deps, "demo").expect("lower");
        let children = &manifest["views"]["main"]["layout"]["children"];
        let text = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["type"] == "text")
            .expect("text");
        assert_eq!(text["bounds"]["x"], 10.0);
        assert_eq!(text["bounds"]["y"], 20.0);
        assert_eq!(text["bounds"]["w"], 80.0);
        assert_eq!(text["bounds"]["h"], 12.0);
    }

    #[test]
    fn maps_vertical_volume_thumb_only_slider() {
        let root = parse_wms_xml(
            r##"
      <theme id="Plus! Nature">
        <view width="474" height="600">
          <slider
            id="volume"
            left="6"
            top="3"
            width="25"
            height="82"
            borderSize="12"
            direction="vertical"
            toolTip="Volume"
            thumbImage="btn_volume_slider_default.bmp"
            thumbHoverImage="btn_volume_slider_rv.bmp"
            thumbDownImage="btn_volume_slider_down.bmp"
            min="0"
            max="100"
            value="wmpprop:player.settings.volume"
            value_onchange="player.settings.volume=value;player.settings.mute='false';"
          />
        </view>
      </theme>
    "##,
        )
        .expect("parse");
        let mut report = GapReport::new();
        let mut jobs = HashMap::new();
        let sizes: HashMap<&str, (u32, u32)> = [
            ("btn_volume_slider_default.bmp", (24, 21)),
            ("btn_volume_slider_rv.bmp", (24, 21)),
            ("btn_volume_slider_down.bmp", (24, 21)),
        ]
        .into_iter()
        .collect();
        let mut size_of = |name: &str| sizes.get(name).copied();
        let mut resolve = |name: &str| Some(PathBuf::from(format!("/tmp/{name}")));
        let plan = BehaviorPlan::empty();
        let mut deps = LowerDeps {
            report: &mut report,
            size_of: &mut size_of,
            resolve_source: &mut resolve,
            jobs: &mut jobs,
            behavior: &plan,
        };
        let manifest = lower_theme(&root, &mut deps, "plus-nature").expect("lower");
        let children = &manifest["views"]["main"]["layout"]["children"];
        let volume = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "volume")
            .expect("volume");
        assert_eq!(volume["type"], "volume");
        assert_eq!(volume["bind"], "player.volume");
        assert_eq!(volume["presentation"]["kind"], "bitmapVerticalSlider");
        assert_eq!(
            volume["presentation"]["thumb"]["default"].as_str(),
            Some("sliders/volume-slider.png")
        );
        assert_eq!(
            volume["presentation"]["thumb"]["hover"].as_str(),
            Some("sliders/volume-slider-hover.png")
        );
        assert_eq!(
            volume["presentation"]["thumb"]["pressed"].as_str(),
            Some("sliders/volume-slider-pressed.png")
        );
        assert!(volume["presentation"].get("track").is_none());
        assert_eq!(volume["presentation"]["borderSize"], 12.0);
        assert_eq!(volume["presentation"]["thumbWidth"], 24.0);
        assert_eq!(volume["presentation"]["thumbHeight"], 21.0);
        assert_eq!(volume["bounds"]["w"], 25.0);
        assert_eq!(volume["presentation"]["trackWidth"], 24.0);
        assert_eq!(volume["presentation"]["trackHeight"], 82.0);
        assert!(
            report
                .items
                .iter()
                .all(|e| e.attr.as_deref() != Some("value_onchange")),
            "standard volume value_onchange should not be reported"
        );
    }

    #[test]
    fn maps_horizontal_seek_thumb_only_slider() {
        let root = parse_wms_xml(
            r##"
      <theme id="Plus! Nature">
        <view width="474" height="600">
          <slider
            id="seek"
            left="96"
            top="185"
            width="115"
            height="17"
            borderSize="3"
            toolTip="Seek"
            thumbImage="btn_progress_slider_default.bmp"
            thumbHoverImage="btn_progress_slider_rv.bmp"
            thumbDownImage="btn_progress_slider_down.bmp"
            value="wmpprop:player.controls.currentPosition"
          />
        </view>
      </theme>
    "##,
        )
        .expect("parse");
        let mut report = GapReport::new();
        let mut jobs = HashMap::new();
        let sizes: HashMap<&str, (u32, u32)> = [
            ("btn_progress_slider_default.bmp", (9, 16)),
            ("btn_progress_slider_rv.bmp", (9, 16)),
            ("btn_progress_slider_down.bmp", (9, 16)),
        ]
        .into_iter()
        .collect();
        let mut size_of = |name: &str| sizes.get(name).copied();
        let mut resolve = |name: &str| Some(PathBuf::from(format!("/tmp/{name}")));
        let plan = BehaviorPlan::empty();
        let mut deps = LowerDeps {
            report: &mut report,
            size_of: &mut size_of,
            resolve_source: &mut resolve,
            jobs: &mut jobs,
            behavior: &plan,
        };
        let manifest = lower_theme(&root, &mut deps, "plus-nature").expect("lower");
        let children = &manifest["views"]["main"]["layout"]["children"];
        let seek = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "seek")
            .expect("seek");
        assert_eq!(seek["type"], "seekbar");
        assert_eq!(seek["bind"], "player.positionSeconds");
        assert_eq!(seek["presentation"]["kind"], "bitmapHorizontalSlider");
        assert_eq!(
            seek["presentation"]["thumb"]["default"].as_str(),
            Some("sliders/progress-slider.png")
        );
        assert_eq!(
            seek["presentation"]["thumb"]["hover"].as_str(),
            Some("sliders/progress-slider-hover.png")
        );
        assert_eq!(
            seek["presentation"]["thumb"]["pressed"].as_str(),
            Some("sliders/progress-slider-pressed.png")
        );
        assert!(seek["presentation"].get("track").is_none());
        assert!(seek["presentation"].get("fill").is_none());
        assert_eq!(seek["presentation"]["borderSize"], 3.0);
        assert_eq!(seek["presentation"]["thumbWidth"], 9.0);
        assert_eq!(seek["presentation"]["thumbHeight"], 16.0);
        assert_eq!(seek["bounds"]["h"], 17.0);
        assert_eq!(seek["presentation"]["trackHeight"], 16.0);
        assert_eq!(seek["presentation"]["trackWidth"], 115.0);
    }

    #[test]
    fn maps_horizontal_seek_track_and_fill() {
        let root = parse_wms_xml(
            r##"
      <theme id="Headspace">
        <view width="500" height="300">
          <slider
            id="seek"
            left="39"
            top="223"
            backgroundImage="progressbar.bmp"
            foregroundImage="progressbar_foreground.bmp"
            thumbImage="thumb_01_default.bmp"
            thumbHoverImage="thumb_02_rollover.bmp"
            thumbDownImage="thumb_03_down.bmp"
            borderSize="9"
            value="wmpprop:player.controls.currentPosition"
          />
        </view>
      </theme>
    "##,
        )
        .expect("parse");
        let mut report = GapReport::new();
        let mut jobs = HashMap::new();
        let sizes: HashMap<&str, (u32, u32)> = [
            ("progressbar.bmp", (163, 9)),
            ("progressbar_foreground.bmp", (163, 9)),
            ("thumb_01_default.bmp", (18, 9)),
            ("thumb_02_rollover.bmp", (18, 9)),
            ("thumb_03_down.bmp", (18, 9)),
        ]
        .into_iter()
        .collect();
        let mut size_of = |name: &str| sizes.get(name).copied();
        let mut resolve = |name: &str| Some(PathBuf::from(format!("/tmp/{name}")));
        let plan = BehaviorPlan::empty();
        let mut deps = LowerDeps {
            report: &mut report,
            size_of: &mut size_of,
            resolve_source: &mut resolve,
            jobs: &mut jobs,
            behavior: &plan,
        };
        let manifest = lower_theme(&root, &mut deps, "headspace").expect("lower");
        let children = &manifest["views"]["main"]["layout"]["children"];
        let seek = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "seek")
            .expect("seek");
        assert_eq!(seek["type"], "seekbar");
        assert_eq!(seek["presentation"]["kind"], "bitmapHorizontalSlider");
        assert_eq!(
            seek["presentation"]["track"].as_str(),
            Some("sliders/progressbar.png")
        );
        assert_eq!(
            seek["presentation"]["fill"].as_str(),
            Some("sliders/progressbar-foreground.png")
        );
        assert_eq!(
            seek["presentation"]["thumb"]["default"].as_str(),
            Some("sliders/thumb-01.png")
        );
        assert_eq!(seek["presentation"]["borderSize"], 9.0);
        assert_eq!(seek["presentation"]["trackWidth"], 163.0);
        assert_eq!(seek["presentation"]["trackHeight"], 9.0);
        assert_eq!(seek["presentation"]["thumbWidth"], 18.0);
        assert_eq!(seek["presentation"]["thumbHeight"], 9.0);
    }

    #[test]
    fn maps_vertical_eq_fill_only_slider() {
        let root = parse_wms_xml(
            r##"
      <theme id="T3">
        <view width="400" height="300">
          <slider
            id="eq1"
            left="45"
            top="48"
            width="14"
            height="116"
            thumbImage="eq_thumb.png"
            foregroundImage="eq_slider.png"
            borderSize="4"
            min="-14"
            max="14"
            value="wmpprop:eq.gainLevel1"
            direction="vertical"
          />
        </view>
      </theme>
    "##,
        )
        .expect("parse");
        let mut report = GapReport::new();
        let mut jobs = HashMap::new();
        let sizes: HashMap<&str, (u32, u32)> =
            [("eq_thumb.png", (14, 10)), ("eq_slider.png", (14, 116))]
                .into_iter()
                .collect();
        let mut size_of = |name: &str| sizes.get(name).copied();
        let mut resolve = |name: &str| Some(PathBuf::from(format!("/tmp/{name}")));
        let plan = BehaviorPlan::empty();
        let mut deps = LowerDeps {
            report: &mut report,
            size_of: &mut size_of,
            resolve_source: &mut resolve,
            jobs: &mut jobs,
            behavior: &plan,
        };
        let manifest = lower_theme(&root, &mut deps, "t3").expect("lower");
        let children = &manifest["views"]["main"]["layout"]["children"];
        let eq = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "eq1")
            .expect("eq1");
        assert_eq!(eq["type"], "eqBand");
        assert_eq!(eq["presentation"]["kind"], "bitmapVerticalSlider");
        assert!(eq["presentation"].get("track").is_none());
        assert_eq!(
            eq["presentation"]["fill"].as_str(),
            Some("sliders/eq-slider.png")
        );
        assert_eq!(
            eq["presentation"]["thumb"]["default"].as_str(),
            Some("sliders/eq-thumb.png")
        );
        assert_eq!(eq["presentation"]["borderSize"], 4.0);
    }

    fn find_id<'a>(node: &'a Value, id: &str) -> Option<&'a Value> {
        if node.get("id").and_then(|v| v.as_str()) == Some(id) {
            return Some(node);
        }
        for child in node.get("children")?.as_array()? {
            if let Some(hit) = find_id(child, id) {
                return Some(hit);
            }
        }
        None
    }

    #[test]
    fn emits_js_toggled_hidden_nodes_and_skips_string_bags() {
        let root = parse_wms_xml(
            r##"
      <theme id="Plus! Nature">
        <view width="474" height="600">
          <subview id="svDrawer" left="82" top="157">
            <button id="btnDrawerClose" left="188" top="30" visible="false"
              image="close.bmp" onClick="DrawerClose();"/>
            <playlist id="playlist" left="32" top="56" width="156" height="120" visible="false"/>
            <text id="xEqTt" enabled="false" visible="false"
              toolTip="Open audio controls" value="Close audio controls"/>
          </subview>
        </view>
      </theme>
    "##,
        )
        .expect("parse");
        let mut report = GapReport::new();
        let mut jobs = HashMap::new();
        let sizes: HashMap<&str, (u32, u32)> = [("close.bmp", (16, 16))].into_iter().collect();
        let mut size_of = |name: &str| sizes.get(name).copied();
        let mut resolve = |name: &str| Some(PathBuf::from(format!("/tmp/{name}")));
        let plan = BehaviorPlan::empty();
        let mut deps = LowerDeps {
            report: &mut report,
            size_of: &mut size_of,
            resolve_source: &mut resolve,
            jobs: &mut jobs,
            behavior: &plan,
        };
        let manifest = lower_theme(&root, &mut deps, "plus-nature").expect("lower");
        let layout = &manifest["views"]["main"]["layout"];
        assert_eq!(find_id(layout, "btnDrawerClose").unwrap()["type"], "button");
        assert_eq!(find_id(layout, "playlist").unwrap()["type"], "playlist");
        assert!(find_id(layout, "xEqTt").is_none());

        let hidden: Vec<_> = report
            .items
            .iter()
            .filter(|i| i.kind == ReportKind::Hidden)
            .map(|i| (i.node_id.as_deref(), i.detail.as_str()))
            .collect();
        assert!(hidden.contains(&(
            Some("btnDrawerClose"),
            "starts hidden (visible=false; JS may toggle)"
        )));
        assert!(hidden.contains(&(
            Some("playlist"),
            "starts hidden (visible=false; JS may toggle)"
        )));
        assert!(hidden.contains(&(
            Some("xEqTt"),
            "omitted non-visual text (tooltip/string bag)"
        )));
    }

    #[test]
    fn keeps_buttongroup_elements_without_mapped_onclick() {
        let root = parse_wms_xml(
            r##"
      <theme id="Plus! Nature">
        <view width="474" height="600">
          <buttongroup id="options" left="4" top="213" width="129" height="48"
            mappingImage="map.bmp" image="sheet.bmp">
            <buttonelement mappingColor="#3366FF" onClick="Visualizer.next();"
              upToolTip="Next visualization"/>
            <buttonelement id="btnEqualizerToggle" mappingColor="#6699FF"
              onClick="ToggleEqualizer();" upToolTip="Open audio controls"/>
          </buttongroup>
        </view>
      </theme>
    "##,
        )
        .expect("parse");
        let mut report = GapReport::new();
        let mut jobs = HashMap::new();
        let sizes: HashMap<&str, (u32, u32)> = [("sheet.bmp", (129, 48))].into_iter().collect();
        let mut size_of = |name: &str| sizes.get(name).copied();
        let mut resolve = |name: &str| Some(PathBuf::from(format!("/tmp/{name}")));
        let plan = BehaviorPlan::empty();
        let mut deps = LowerDeps {
            report: &mut report,
            size_of: &mut size_of,
            resolve_source: &mut resolve,
            jobs: &mut jobs,
            behavior: &plan,
        };
        let manifest = lower_theme(&root, &mut deps, "plus-nature").expect("lower");
        let children = &manifest["views"]["main"]["layout"]["children"];
        let group = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "options")
            .expect("group");
        let elements = group["presentation"]["elements"].as_array().unwrap();
        assert_eq!(elements.len(), 2);
        assert_eq!(
            elements[0]["onClick"][0]["action"].as_str(),
            Some("visualizer.next")
        );
        assert!(elements[1].get("onClick").is_none());
        assert_eq!(elements[1]["tooltip"].as_str(), Some("Open audio controls"));
        assert!(report.items.iter().any(|i| {
            i.kind == ReportKind::UnmappedAction && i.detail.contains("ToggleEqualizer")
        }));
    }

    #[test]
    fn wires_mutex_drawer_clicks_from_js() {
        let root = parse_wms_xml(
            r##"
      <theme id="Plus! Nature">
        <view width="474" height="600">
          <subview id="svDrawer" left="82" top="157">
            <button id="btnDrawerClose" left="188" top="30" visible="false"
              image="close.bmp" hoverImage="close_h.bmp" downImage="close_d.bmp"
              onClick="DrawerClose();"/>
            <playlist id="playlist" left="32" top="56" width="156" height="120" visible="false"/>
          </subview>
          <buttongroup id="options" left="4" top="213" width="129" height="48"
            mappingImage="map.bmp" image="sheet.bmp">
            <buttonelement mappingColor="#6699FF" onClick="ToggleEqualizer();" upToolTip="EQ"/>
            <buttonelement mappingColor="#66CCFF" onClick="TogglePlaylist();" upToolTip="PL"/>
          </buttongroup>
        </view>
      </theme>
    "##,
        )
        .expect("parse");
        let js = r#"
var iDrawerClosedPos = 157;
var iDrawerOpenedPos = 317;
function DrawerClose() {
  if (bEqualizerOpen) { ToggleEqualizer(); }
  else if (bPlaylistOpen) { TogglePlaylist(); }
}
function ToggleEqualizer() {
  if (bEqualizerOpen) { svDrawer.moveTo(svDrawer.left, iDrawerClosedPos, 120); }
  else { svDrawer.moveTo(svDrawer.left, iDrawerOpenedPos, 120); }
}
function TogglePlaylist() {
  if (bPlaylistOpen) { svDrawer.moveTo(svDrawer.left, iDrawerClosedPos, 120); }
  else { playlist.visible = true; svDrawer.moveTo(svDrawer.left, iDrawerOpenedPos, 120); }
}
"#;
        let consts = crate::wms_import::fold::parse_js_numeric_consts(js);
        let plan = crate::wms_import::behavior::analyze_behavior(js, &consts, &root);
        let mut report = GapReport::new();
        let mut jobs = HashMap::new();
        let sizes: HashMap<&str, (u32, u32)> = [
            ("close.bmp", (16, 16)),
            ("sheet.bmp", (129, 48)),
            ("map.bmp", (129, 48)),
        ]
        .into_iter()
        .collect();
        let mut size_of = |name: &str| sizes.get(name).copied();
        let mut resolve = |name: &str| Some(PathBuf::from(format!("/tmp/{name}")));
        let mut deps = LowerDeps {
            report: &mut report,
            size_of: &mut size_of,
            resolve_source: &mut resolve,
            jobs: &mut jobs,
            behavior: &plan,
        };
        let manifest = lower_theme(&root, &mut deps, "plus-nature").expect("lower");
        let layout = &manifest["views"]["main"]["layout"];
        assert_eq!(
            find_id(layout, "btnDrawerClose").unwrap()["onClick"][0]["payload"]["event"],
            "close"
        );
        let group = find_id(layout, "options").unwrap();
        let events: Vec<_> = group["presentation"]["elements"]
            .as_array()
            .unwrap()
            .iter()
            .map(|e| {
                e["onClick"][0]["payload"]["event"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(events, vec!["toggleEq", "togglePlaylist"]);
        assert!(manifest["views"]["main"]["state"]["drawer"].is_object());
        assert_eq!(
            find_id(layout, "svDrawer").unwrap()["boundsWhen"]["view.drawer.eq"]["y"].as_f64(),
            Some(317.0)
        );
        assert_eq!(
            find_id(layout, "svDrawer").unwrap()["transition"]["durationMs"].as_u64(),
            Some(120)
        );
        assert!(!report
            .items
            .iter()
            .any(|i| { i.kind == ReportKind::UnmappedAction && i.detail.contains("DrawerClose") }));
    }

    #[test]
    fn maps_horizontal_eq_slider() {
        let root = parse_wms_xml(
            r##"
      <theme id="Plus! Nature">
        <view width="474" height="600">
          <slider
            id="bass"
            left="70"
            top="0"
            width="120"
            height="20"
            borderSize="10"
            direction="horizontal"
            toolTip="Bass"
            backgroundImage="eq_bar.bmp"
            thumbImage="eq_thumb.bmp"
            min="-14"
            max="14"
            value="wmpprop:eq.gainLevel1"
          />
        </view>
      </theme>
    "##,
        )
        .expect("parse");
        let mut report = GapReport::new();
        let mut jobs = HashMap::new();
        let sizes: HashMap<&str, (u32, u32)> =
            [("eq_bar.bmp", (8, 20)), ("eq_thumb.bmp", (12, 20))]
                .into_iter()
                .collect();
        let mut size_of = |name: &str| sizes.get(name).copied();
        let mut resolve = |name: &str| Some(PathBuf::from(format!("/tmp/{name}")));
        let plan = BehaviorPlan::empty();
        let mut deps = LowerDeps {
            report: &mut report,
            size_of: &mut size_of,
            resolve_source: &mut resolve,
            jobs: &mut jobs,
            behavior: &plan,
        };
        let manifest = lower_theme(&root, &mut deps, "plus-nature").expect("lower");
        let children = &manifest["views"]["main"]["layout"]["children"];
        let bass = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "bass")
            .expect("bass");
        assert_eq!(bass["type"], "eqBand");
        assert_eq!(bass["band"], 1);
        assert_eq!(bass["presentation"]["kind"], "bitmapHorizontalSlider");
        assert_eq!(
            bass["presentation"]["track"].as_str(),
            Some("sliders/eq-bar.png")
        );
        assert!(bass.get("spread").is_none());
    }

    const NATURE_EQ_JS: &str = r#"
function AdjustAudio() {
  eq.gainLevel2 = (8*bass.value +   treble.value)/9;
  eq.gainLevel3 = (7*bass.value + 2*treble.value)/9;
  eq.gainLevel4 = (6*bass.value + 3*treble.value)/9;
  eq.gainLevel5 = (5*bass.value + 4*treble.value)/9;
  eq.gainLevel6 = (4*bass.value + 5*treble.value)/9;
  eq.gainLevel7 = (3*bass.value + 6*treble.value)/9;
  eq.gainLevel8 = (2*bass.value + 7*treble.value)/9;
  eq.gainLevel9 = (  bass.value + 8*treble.value)/9;
}
"#;

    fn nature_eq_theme(
        include_onchange: bool,
        extra_slider: &str,
    ) -> crate::wms_import::parse::WmsNode {
        let onchange_bass = if include_onchange {
            r#" value_onchange="AdjustAudio(); eq.gainLevel1 = value;""#
        } else {
            ""
        };
        let onchange_treble = if include_onchange {
            r#" value_onchange="AdjustAudio(); eq.gainLevel10 = value;""#
        } else {
            ""
        };
        let xml = format!(
            r##"
      <theme id="Plus! Nature">
        <view width="474" height="600">
          <slider
            id="bass"
            left="70"
            top="0"
            width="120"
            height="20"
            borderSize="10"
            direction="horizontal"
            toolTip="Bass"
            backgroundImage="eq_bar.bmp"
            thumbImage="eq_thumb.bmp"
            min="-14"
            max="14"
            value="wmpprop:eq.gainLevel1"
            {onchange_bass}
          />
          <slider
            id="treble"
            left="70"
            top="30"
            width="120"
            height="20"
            borderSize="10"
            direction="horizontal"
            toolTip="Treble"
            backgroundImage="eq_bar.bmp"
            thumbImage="eq_thumb.bmp"
            min="-14"
            max="14"
            value="wmpprop:eq.gainLevel10"
            {onchange_treble}
          />
          {extra_slider}
        </view>
      </theme>
    "##
        );
        parse_wms_xml(&xml).expect("parse")
    }

    fn lower_eq_theme(root: &crate::wms_import::parse::WmsNode, js: &str) -> (Value, GapReport) {
        let mut report = GapReport::new();
        let mut jobs = HashMap::new();
        let sizes: HashMap<&str, (u32, u32)> =
            [("eq_bar.bmp", (8, 20)), ("eq_thumb.bmp", (12, 20))]
                .into_iter()
                .collect();
        let mut size_of = |name: &str| sizes.get(name).copied();
        let mut resolve = |name: &str| Some(PathBuf::from(format!("/tmp/{name}")));
        let plan = crate::wms_import::behavior::analyze_behavior(js, &HashMap::new(), root);
        let mut deps = LowerDeps {
            report: &mut report,
            size_of: &mut size_of,
            resolve_source: &mut resolve,
            jobs: &mut jobs,
            behavior: &plan,
        };
        let manifest = lower_theme(root, &mut deps, "plus-nature").expect("lower");
        (manifest, report)
    }

    #[test]
    fn maps_nature_eq_tilt_spread() {
        let root = nature_eq_theme(true, "");
        let (manifest, report) = lower_eq_theme(&root, NATURE_EQ_JS);
        let children = &manifest["views"]["main"]["layout"]["children"];
        let bass = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "bass")
            .expect("bass");
        let treble = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "treble")
            .expect("treble");
        assert_eq!(bass["type"], "eqBand");
        assert_eq!(bass["band"], 1);
        assert_eq!(bass["spread"], "linear");
        assert_eq!(treble["type"], "eqBand");
        assert_eq!(treble["band"], 10);
        assert_eq!(treble["spread"], "linear");
        assert!(
            report
                .items
                .iter()
                .all(|e| e.attr.as_deref() != Some("value_onchange")),
            "Nature AdjustAudio value_onchange should not be reported"
        );
    }

    #[test]
    fn two_endpoint_eq_sliders_without_formula_do_not_spread() {
        let extra = r#"
          <slider
            id="mystery"
            left="70"
            top="60"
            width="120"
            height="20"
            borderSize="10"
            direction="horizontal"
            backgroundImage="eq_bar.bmp"
            thumbImage="eq_thumb.bmp"
            min="-14"
            max="14"
            value="wmpprop:eq.gainLevel1"
            value_onchange="DoSomethingCustom();"
          />
        "#;
        let root = nature_eq_theme(true, extra);
        let (manifest, report) = lower_eq_theme(&root, "");
        let children = &manifest["views"]["main"]["layout"]["children"];
        let bass = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "bass")
            .expect("bass");
        let treble = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "treble")
            .expect("treble");
        assert!(bass.get("spread").is_none());
        assert!(treble.get("spread").is_none());
        assert!(
            report.items.iter().any(|e| {
                e.node_id.as_deref() == Some("bass") && e.attr.as_deref() == Some("value_onchange")
            }),
            "onchange without formula should still be reported"
        );
        assert!(report.items.iter().any(|e| {
            e.node_id.as_deref() == Some("mystery") && e.attr.as_deref() == Some("value_onchange")
        }));
    }
}
