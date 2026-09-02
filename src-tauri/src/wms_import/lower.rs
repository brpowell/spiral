use std::collections::HashMap;
use std::path::PathBuf;

use serde_json::{json, Map, Value};

use crate::wms_import::behavior::{apply_behavior_tree, BehaviorPlan};
use crate::wms_import::convert::AssetJob;
use crate::wms_import::map::{
    compact_stmt, implicit_element_action, is_false_attr, is_truthy_attr, looks_like_bind_expr,
    map_active_when, map_bind, map_condition, map_on_click, map_style, map_tooltip, normalize_hex,
    parse_number, strip_jscript, unmapped_attrs,
};
use crate::wms_import::parse::{visit_wms, WmsNode};
use crate::wms_import::paths::{spiral_asset_path, AssetRole};
use crate::wms_import::report::{GapReport, ReportKind};

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct KnownBox {
    x: Option<f64>,
    y: Option<f64>,
    w: Option<f64>,
    h: Option<f64>,
}

pub struct LowerDeps<'a> {
    pub report: &'a mut GapReport,
    pub size_of: &'a mut dyn FnMut(&str) -> Option<(u32, u32)>,
    pub resolve_source: &'a mut dyn FnMut(&str) -> Option<PathBuf>,
    pub jobs: &'a mut HashMap<String, AssetJob>,
    pub behavior: &'a BehaviorPlan,
    pub(crate) known_geom: HashMap<String, KnownBox>,
    pub(crate) close_action: &'static str,
    pub(crate) view_ids: Vec<String>,
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
    "listbox",
    "editbox",
    "video",
    "progressbar",
    "prevbutton",
    "playbutton",
    "pausebutton",
    "nextbutton",
    "stopbutton",
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

    let primary_index = pick_primary_view_index(&views);
    deps.view_ids = views
        .iter()
        .enumerate()
        .map(|(index, view_node)| {
            if views.len() == 1 {
                "main".to_string()
            } else {
                slug_view_id(view_node.attrs.get("id").map(String::as_str), index)
            }
        })
        .collect();
    let mut ordered: Vec<(String, Value)> = Vec::new();
    for (index, view_node) in views.iter().enumerate() {
        let view_id = if views.len() == 1 {
            "main".to_string()
        } else {
            slug_view_id(view_node.attrs.get("id").map(String::as_str), index)
        };
        if let Some(view) = lower_view(view_node, deps) {
            ordered.push((view_id, view));
        }
    }
    if ordered.is_empty() {
        return Err("WMS theme has no visual <view>".into());
    }
    let multi = ordered.len() > 1;
    let wanted_primary = if views.len() == 1 {
        "main".to_string()
    } else {
        slug_view_id(
            views[primary_index].attrs.get("id").map(String::as_str),
            primary_index,
        )
    };
    let primary_id = if ordered.iter().any(|(id, _)| id == &wanted_primary) {
        wanted_primary
    } else {
        ordered[0].0.clone()
    };
    let mut view_entries = Map::new();
    for (id, mut view) in ordered {
        if multi {
            view["presentation"] = if id == primary_id {
                json!("primary")
            } else {
                json!("auxiliary")
            };
        }
        view_entries.insert(id, view);
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

fn pick_primary_view_index(views: &[&WmsNode]) -> usize {
    for (i, view) in views.iter().enumerate() {
        if is_main_view_id(view.attrs.get("id").map(String::as_str)) {
            return i;
        }
    }
    for (i, view) in views.iter().enumerate() {
        if is_splash_or_control_view(view) {
            continue;
        }
        if view_declared_size(view).is_some() {
            return i;
        }
    }
    views
        .iter()
        .position(|view| view_declared_size(view).is_some())
        .unwrap_or(0)
}

fn is_main_view_id(id: Option<&str>) -> bool {
    let Some(id) = id else {
        return false;
    };
    let lower = id.to_ascii_lowercase();
    let stripped = lower.strip_suffix("box").unwrap_or(&lower);
    stripped == "main" || stripped == "mainview" || stripped.ends_with("main")
}

fn is_splash_or_control_view(view: &WmsNode) -> bool {
    let id = view
        .attrs
        .get("id")
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();
    id.contains("preview") || id.contains("splash") || id.contains("control")
}

fn view_declared_size(view: &WmsNode) -> Option<(f64, f64)> {
    let w = parse_number(view.attrs.get("width").map(String::as_str))?;
    let h = parse_number(view.attrs.get("height").map(String::as_str))?;
    if w >= 1.0 && h >= 1.0 {
        Some((w, h))
    } else {
        None
    }
}

fn lower_view(node: &WmsNode, deps: &mut LowerDeps<'_>) -> Option<Value> {
    let (mut width, mut height) = view_canvas_size(node, deps);
    let resizable = is_truthy_attr(node.attrs.get("resizable").map(String::as_str));
    deps.close_action =
        if deps.view_ids.len() <= 1 || is_main_view_id(node.attrs.get("id").map(String::as_str)) {
            "skin.exit"
        } else {
            "skin.closeView"
        };
    deps.known_geom = collect_known_geom(node, &mut *deps.size_of);
    let mut ids = IdGen::new();
    let mut children = lower_view_children(node, deps, &mut ids);

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

    if width < 1.0 && height < 1.0 && children.is_empty() {
        deps.report.add(
            ReportKind::Info,
            "omitted script-only view (no size, no visuals)",
            node.attrs.get("id").map(String::as_str),
            None,
        );
        return None;
    }
    if width < 1.0 {
        width = 1.0;
    }
    if height < 1.0 {
        height = 1.0;
    }

    let min_width = window_min_px(
        node.attrs.get("minwidth").map(String::as_str),
        width,
        resizable,
    );
    let min_height = window_min_px(
        node.attrs.get("minheight").map(String::as_str),
        height,
        resizable,
    );

    let mut window = json!({
        "defaultWidth": width,
        "defaultHeight": height,
        "minWidth": min_width,
        "minHeight": min_height,
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
    if !deps.behavior.is_empty() {
        if let Some(layout) = view.get_mut("layout") {
            apply_behavior_tree(layout, deps.behavior);
        }
        if view_owns_behavior(&view, deps.behavior) {
            view["state"] = deps.behavior.state_json();
        }
    }
    Some(view)
}

fn view_canvas_size(node: &WmsNode, deps: &mut LowerDeps<'_>) -> (f64, f64) {
    let mut width = parse_number(node.attrs.get("width").map(String::as_str)).unwrap_or(0.0);
    let mut height = parse_number(node.attrs.get("height").map(String::as_str)).unwrap_or(0.0);
    if width >= 1.0 && height >= 1.0 {
        return (width, height);
    }
    if let Some(bg) = node.attrs.get("backgroundimage") {
        if !is_builtin_image(bg) {
            if let Some((rw, rh)) = (deps.size_of)(bg) {
                if width < 1.0 {
                    width = rw as f64;
                }
                if height < 1.0 {
                    height = rh as f64;
                }
            }
        }
    }
    (width, height)
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

fn map_clicks(raw: Option<&str>, deps: &LowerDeps<'_>) -> (Vec<Value>, Vec<String>) {
    let (mut effects, unmapped) = map_on_click(raw, &deps.view_ids);
    if deps.close_action == "skin.closeView" {
        for effect in &mut effects {
            if effect.get("action").and_then(|v| v.as_str()) == Some("skin.exit") {
                effect["action"] = json!("skin.closeView");
            }
        }
    }
    let mut rest = Vec::new();
    for stmt in unmapped {
        if let Some(more) = deps.behavior.effects_for_statement(&stmt) {
            effects.extend(more);
        } else {
            rest.push(stmt);
        }
    }
    (effects, rest)
}

fn leftover_jscript(node: &WmsNode, deps: &mut LowerDeps<'_>) {
    for (attr, value) in &node.attrs {
        if attr == "onclick" || attr == "value_onchange" {
            continue;
        }
        if attr == "down" && map_active_when(Some(value)).is_some() {
            continue;
        }
        if value.len() < 8 || !value[..8].eq_ignore_ascii_case("jscript:") {
            continue;
        }
        if matches!(attr.as_str(), "left" | "top" | "width" | "height")
            && parse_geom(Some(value), attr, &deps.known_geom).is_some()
        {
            continue;
        }
        deps.report.add(
            ReportKind::Jscript,
            value.clone(),
            node.attrs.get("id").map(String::as_str),
            Some(attr),
        );
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

fn lower_view_children(parent: &WmsNode, deps: &mut LowerDeps<'_>, ids: &mut IdGen) -> Vec<Value> {
    let mut chrome = Vec::new();
    let mut rest = Vec::new();
    for child in &parent.children {
        if is_frame_chrome_subview(child) {
            chrome.push(child);
        } else {
            rest.push(child);
        }
    }
    let mut out = Vec::new();
    if let Some(mut frame) = lower_tiled_frame(&chrome, deps, ids) {
        if let Some(inset) = infer_client_content_inset(&rest, deps) {
            frame["presentation"]["contentInset"] = inset;
        }
        out.push(frame);
    } else {
        for child in chrome {
            out.extend(lower_node(child, deps, ids));
        }
    }
    for child in rest {
        out.extend(lower_node(child, deps, ids));
    }
    out
}

fn lower_node(node: &WmsNode, deps: &mut LowerDeps<'_>, ids: &mut IdGen) -> Vec<Value> {
    leftover_jscript(node, deps);

    if SKIP_TAGS.contains(&node.tag.as_str()) {
        return Vec::new();
    }

    if is_string_bag_text(node) {
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
        "button" | "prevbutton" | "playbutton" | "pausebutton" | "nextbutton" | "stopbutton" => {
            maybe_list(lower_button(node, deps, ids))
        }
        "buttongroup" => maybe_list(lower_button_group(node, deps, ids)),
        "slider" | "customslider" | "progressbar" => maybe_list(lower_slider(node, deps, ids)),
        "text" => maybe_list(lower_text(node, deps, ids)),
        "effects" => maybe_list(Some(lower_visualizer(node, deps, ids))),
        "playlist" => maybe_list(Some(lower_playlist(node, deps, ids))),
        "listbox" => maybe_list(Some(lower_listbox(node, deps, ids))),
        "editbox" => maybe_list(Some(lower_editbox(node, deps, ids))),
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
            if let Some(deco) =
                background_decoration(&format!("{id}-bg"), bg, origin_fill_bounds(&bounds), deps)
            {
                children.insert(0, deco);
            }
        }
    }
    let (style, style_unmapped) = map_style(node);
    for (attr, value) in style_unmapped {
        deps.report
            .add(ReportKind::UnmappedAttr, value, Some(&id), Some(&attr));
    }
    let bg_only = is_background_only(node);
    if children.is_empty() && style.is_none() && (!has_layout_box(node) || bg_only) {
        deps.report.add(
            ReportKind::Info,
            if bg_only {
                "omitted subview with missing background image".to_string()
            } else {
                "omitted empty subview (no visuals)".to_string()
            },
            Some(&id),
            None,
        );
        return None;
    }
    report_unmapped(node, deps, &["fontface", "fonttype", "fontsmoothing"]);
    let mut subview = json!({
        "type": "subview",
        "id": id,
        "bounds": bounds,
        "children": children,
    });
    if let Some(style) = style {
        subview["style"] = Value::Object(style);
    }
    if is_truthy_attr(node.attrs.get("passthrough").map(String::as_str)) {
        subview["passthrough"] = json!(true);
    }
    apply_bind_conditions(node, &mut subview, deps);
    Some(subview)
}

fn background_decoration(
    id: &str,
    image: &str,
    bounds: Value,
    deps: &mut LowerDeps<'_>,
) -> Option<Value> {
    let dest = register_image(
        image,
        AssetRole::Decoration,
        deps,
        Some("decorations"),
        Some(id),
    )?;
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
    let (mut effects, unmapped) = map_clicks(node.attrs.get("onclick").map(String::as_str), deps);
    for stmt in unmapped {
        deps.report
            .add(ReportKind::UnmappedAction, stmt, Some(&id), Some("onClick"));
    }
    if effects.is_empty() {
        if let Some(action) = implicit_element_action(&node.tag) {
            effects.push(json!({ "action": action }));
        }
    }
    let Some(assets) = interactive_assets(node, deps, "buttons") else {
        if node.attrs.get("image").is_none() {
            deps.report
                .add(ReportKind::Info, "button has no image", Some(&id), None);
        }
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
    apply_bind_conditions(node, &mut button, deps);
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
    let position_map = node.attrs.get("mappingimage").and_then(|map_name| {
        register_image(map_name, AssetRole::Map, deps, Some("buttons"), Some(&id))
    });
    let (Some(assets), Some(position_map)) = (assets, position_map) else {
        if node.attrs.get("image").is_none() && node.attrs.get("mappingimage").is_none() {
            deps.report.add(
                ReportKind::Info,
                "buttongroup missing image or mappingImage",
                Some(&id),
                None,
            );
        }
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
        let (mapped_effects, mapped_unmapped) =
            map_clicks(child.attrs.get("onclick").map(String::as_str), deps);
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
        apply_bind_conditions(child, &mut el, deps);
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
    apply_bind_conditions(node, &mut group, deps);
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
            .or_else(|| node.attrs.get("positionimage"))
            .map(String::as_str),
    );
    let Some(presentation) = slider_presentation(node, deps, &bounds, direction) else {
        if node.attrs.get("image").is_none()
            && node.attrs.get("thumbimage").is_none()
            && node.attrs.get("backgroundimage").is_none()
            && node.attrs.get("foregroundimage").is_none()
        {
            deps.report.add(
                ReportKind::Info,
                "slider missing thumb/track images",
                Some(&id),
                None,
            );
        }
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
        let mapped = eq_spread_onchange || is_implied_slider_onchange(v, gain, bind.as_deref());
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
                "type": "slider",
                "control": "eq",
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
            "type": "slider",
            "control": "volume",
            "id": id,
            "bounds": bounds,
            "presentation": presentation,
        });
        if let Some(tip) = tip {
            n["tooltip"] = json!(tip);
        }
        report_unmapped(node, deps, &[]);
        return Some(n);
    }
    if bind.as_deref() == Some("player.balance") || id.to_ascii_lowercase().contains("balance") {
        let mut n = json!({
            "type": "slider",
            "control": "balance",
            "id": id,
            "bounds": bounds,
            "presentation": presentation,
        });
        if let Some(tip) = tip {
            n["tooltip"] = json!(tip);
        }
        report_unmapped(node, deps, &[]);
        return Some(n);
    }
    if bind.as_deref() == Some("player.positionSeconds") || id.to_ascii_lowercase().contains("seek")
    {
        let mut seek = json!({
            "type": "slider",
            "control": "seek",
            "id": id,
            "bounds": bounds,
            "presentation": presentation,
        });
        if let Some(tip) = tip {
            seek["tooltip"] = json!(tip);
        }
        report_unmapped(node, deps, &[]);
        return Some(seek);
    }

    let mut unbound = json!({
        "type": "slider",
        "id": id,
        "bounds": bounds,
        "presentation": presentation,
    });
    if let Some(bind) = bind {
        unbound["bind"] = json!(bind);
    }
    if let Some(tip) = tip {
        unbound["tooltip"] = json!(tip);
    }
    report_unmapped(node, deps, &[]);
    Some(unbound)
}

const WINDOW_MIN_FLOOR: f64 = 160.0;

fn window_min_px(raw: Option<&str>, declared: f64, resizable: bool) -> f64 {
    let mut min = parse_number(raw).unwrap_or(declared);
    if !resizable {
        min = min.min(declared);
    }
    min.max(WINDOW_MIN_FLOOR)
}

fn collect_known_geom(
    view: &WmsNode,
    size_of: &mut dyn FnMut(&str) -> Option<(u32, u32)>,
) -> HashMap<String, KnownBox> {
    let mut out = HashMap::new();
    visit_wms(view, &mut |node| {
        let Some(id) = node.attrs.get("id") else {
            return;
        };
        let raster = node
            .attrs
            .get("backgroundimage")
            .or_else(|| node.attrs.get("positionimage"))
            .or_else(|| node.attrs.get("image"))
            .or_else(|| node.attrs.get("thumbimage"))
            .and_then(|name| size_of(name));
        out.insert(
            id.to_ascii_lowercase(),
            KnownBox {
                x: parse_number(node.attrs.get("left").map(String::as_str)),
                y: parse_number(node.attrs.get("top").map(String::as_str)),
                w: parse_number(node.attrs.get("width").map(String::as_str))
                    .or_else(|| raster.map(|(w, _)| w as f64)),
                h: parse_number(node.attrs.get("height").map(String::as_str))
                    .or_else(|| raster.map(|(_, h)| h as f64)),
            },
        );
    });
    out
}

fn strip_slider_presentation(
    node: &WmsNode,
    deps: &mut LowerDeps<'_>,
    bounds: &Value,
) -> Option<Value> {
    let strip_name = node.attrs.get("image")?;
    if is_builtin_image(strip_name) {
        return None;
    }
    let map_name = node.attrs.get("positionimage");
    let strip_size = (deps.size_of)(strip_name)?;
    let map_size = map_name.and_then(|name| (deps.size_of)(name));
    let (frame_width, frame_height, frame_count) =
        infer_strip_frames(strip_size, map_size, bounds)?;
    let node_id = node.attrs.get("id").map(String::as_str);
    let strip = register_image(
        strip_name,
        AssetRole::Default,
        deps,
        Some("sliders"),
        node_id,
    )?;
    let map = map_name
        .and_then(|name| register_image(name, AssetRole::Map, deps, Some("sliders"), node_id));
    let direction = node
        .attrs
        .get("direction")
        .map(|d| d.to_ascii_lowercase())
        .filter(|d| d == "vertical" || d == "horizontal")
        .unwrap_or_else(|| {
            if frame_width < frame_height {
                "vertical".into()
            } else {
                "horizontal".into()
            }
        });
    let mut out = json!({
        "kind": "stripSlider",
        "strip": strip,
        "frameWidth": frame_width,
        "frameHeight": frame_height,
        "frameCount": frame_count,
        "direction": direction,
    });
    if let Some(map) = map {
        out["positionMap"] = json!(map);
    }
    Some(out)
}

fn infer_strip_frames(
    strip: (u32, u32),
    map: Option<(u32, u32)>,
    bounds: &Value,
) -> Option<(f64, f64, u32)> {
    let mut frames: Vec<(f64, f64)> = Vec::new();
    if let Some((w, h)) = map {
        frames.push((w as f64, h as f64));
    }
    if let (Some(w), Some(h)) = (
        bounds.get("w").and_then(|v| v.as_f64()),
        bounds.get("h").and_then(|v| v.as_f64()),
    ) {
        if w >= 1.0 && h >= 1.0 {
            frames.push((w, h));
        }
    }
    let sw = strip.0 as f64;
    let sh = strip.1 as f64;
    for (fw, fh) in frames {
        if fw < 1.0 || fh < 1.0 {
            continue;
        }
        let nx = sw / fw;
        let ny = sh / fh;
        if (sh - fh).abs() < 0.5 && nx >= 2.0 && (nx - nx.round()).abs() < 0.01 {
            return Some((fw, fh, nx.round() as u32));
        }
        if (sw - fw).abs() < 0.5 && ny >= 2.0 && (ny - ny.round()).abs() < 0.01 {
            return Some((fw, fh, ny.round() as u32));
        }
    }
    None
}

fn slider_presentation(
    node: &WmsNode,
    deps: &mut LowerDeps<'_>,
    bounds: &Value,
    direction: &str,
) -> Option<Value> {
    if let Some(strip) = strip_slider_presentation(node, deps, bounds) {
        return Some(strip);
    }
    let thumb_name = node.attrs.get("thumbimage");
    let track_name = node.attrs.get("backgroundimage");
    let fill_name = node.attrs.get("foregroundimage");
    let node_id = node.attrs.get("id").map(String::as_str);
    let thumb = thumb_name
        .and_then(|n| register_image(n, AssetRole::Default, deps, Some("sliders"), node_id));
    let thumb_hover = node
        .attrs
        .get("thumbhoverimage")
        .and_then(|n| register_image(n, AssetRole::Hover, deps, Some("sliders"), node_id));
    let thumb_pressed = node
        .attrs
        .get("thumbdownimage")
        .and_then(|n| register_image(n, AssetRole::Pressed, deps, Some("sliders"), node_id));
    let track = track_name
        .and_then(|n| register_image(n, AssetRole::Track, deps, Some("sliders"), node_id));
    let fill =
        fill_name.and_then(|n| register_image(n, AssetRole::Track, deps, Some("sliders"), node_id));
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
    let (effects, unmapped) = map_clicks(node.attrs.get("onclick").map(String::as_str), deps);
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
    apply_bind_conditions(node, &mut pl, deps);
    pl
}

fn lower_listbox(node: &WmsNode, deps: &mut LowerDeps<'_>, ids: &mut IdGen) -> Value {
    let id = node
        .attrs
        .get("id")
        .cloned()
        .unwrap_or_else(|| ids.next("listbox"));
    deps.report.add(
        ReportKind::Info,
        "listbox stubbed as playlist",
        Some(&id),
        None,
    );
    let (style, _) = map_style(node);
    report_unmapped(
        node,
        deps,
        &[
            "border",
            "popup",
            "fontface",
            "selecteditem_onchange",
            "ondblclick",
            "itemplayingcolor",
            "itemplayingbackgroundcolor",
        ],
    );
    let mut pl = json!({
        "type": "playlist",
        "id": id,
        "bounds": bounds_from(node, deps, None),
        "showDropdown": false,
    });
    if let Some(style) = style {
        pl["style"] = Value::Object(style);
    }
    apply_bind_conditions(node, &mut pl, deps);
    pl
}

fn lower_editbox(node: &WmsNode, deps: &mut LowerDeps<'_>, ids: &mut IdGen) -> Value {
    let id = node
        .attrs
        .get("id")
        .cloned()
        .unwrap_or_else(|| ids.next("editbox"));
    deps.report.add(
        ReportKind::Info,
        "editbox mapped as input (playlist.setFilter on change)",
        Some(&id),
        None,
    );
    let (style, _) = map_style(node);
    report_unmapped(
        node,
        deps,
        &[
            "border",
            "editstyle",
            "onkeyup",
            "onfocus",
            "onblur",
            "fontface",
        ],
    );
    let mut input = json!({
        "type": "input",
        "id": id,
        "bounds": bounds_from(node, deps, None),
        "onChange": [{ "action": "playlist.setFilter" }],
    });
    if let Some(placeholder) = node.attrs.get("value") {
        if !placeholder.is_empty() {
            input["placeholder"] = json!(placeholder);
        }
    }
    if let Some(limit) = node.attrs.get("textlimit") {
        if let Ok(max_length) = limit.parse::<u32>() {
            if max_length > 0 {
                input["maxLength"] = json!(max_length);
            }
        }
    }
    if let Some(style) = style {
        input["style"] = Value::Object(style);
    }
    apply_bind_conditions(node, &mut input, deps);
    input
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
    let node_id = node.attrs.get("id").map(String::as_str);
    let default_path = register_image(def, AssetRole::Default, deps, Some(folder), node_id)?;
    let mut assets = Map::new();
    assets.insert("default".into(), json!(default_path));
    if let Some(hover) = node.attrs.get("hoverimage") {
        if let Some(p) = register_image(hover, AssetRole::Hover, deps, Some(folder), node_id) {
            assets.insert("hover".into(), json!(p));
        }
    }
    let down = node
        .attrs
        .get("downimage")
        .or_else(|| node.attrs.get("donwimage"));
    if let Some(down) = down {
        if let Some(p) = register_image(down, AssetRole::Pressed, deps, Some(folder), node_id) {
            assets.insert("pressed".into(), json!(p));
        }
    }
    if let Some(disabled) = node.attrs.get("disabledimage") {
        if let Some(p) = register_image(disabled, AssetRole::Disabled, deps, Some(folder), node_id)
        {
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
    node_id: Option<&str>,
) -> Option<String> {
    if is_builtin_image(source_name) {
        deps.report
            .add(ReportKind::BuiltinImage, source_name, node_id, None);
        return None;
    }
    let folder_hint = match folder {
        Some("decorations") => Some("decorations"),
        Some("buttons") => Some("buttons"),
        Some("sliders") => Some("sliders"),
        Some("frame") => Some("frame"),
        _ => None,
    };
    let Some(source_path) = (deps.resolve_source)(source_name) else {
        deps.report
            .add(ReportKind::MissingFile, source_name, node_id, None);
        return None;
    };
    let mut dest_rel = spiral_asset_path(source_name, role, folder_hint);
    // Single-frame GIFs are converted to PNG (static chromakey path).
    if crate::skin_convert::gif_frame_count(&source_path) == Some(1) && dest_rel.ends_with(".gif") {
        dest_rel = dest_rel.trim_end_matches(".gif").to_string() + ".png";
    }
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
    Some(dest_rel)
}

fn origin_fill_bounds(parent: &Value) -> Value {
    let mut bounds = Map::new();
    bounds.insert("x".into(), json!(0));
    bounds.insert("y".into(), json!(0));
    if parent.get("w").is_some() {
        bounds.insert("w".into(), parent.get("w").cloned().unwrap_or(json!(1)));
    } else {
        bounds.insert("right".into(), json!(0));
    }
    if parent.get("h").is_some() {
        bounds.insert("h".into(), parent.get("h").cloned().unwrap_or(json!(1)));
    } else {
        bounds.insert("bottom".into(), json!(0));
    }
    Value::Object(bounds)
}

fn bounds_from(node: &WmsNode, deps: &mut LowerDeps<'_>, size_from: Option<&str>) -> Value {
    let raster = size_from.and_then(|name| (deps.size_of)(name));
    let font_size = parse_number(node.attrs.get("fontsize").map(String::as_str));
    let text_h = if node.tag == "text" {
        Some(match font_size {
            Some(fs) => (12.0_f64).max(fs + 3.0),
            None => 12.0,
        })
    } else {
        None
    };
    let h_axis = axis_bounds(
        parse_geom(
            node.attrs.get("left").map(String::as_str),
            "left",
            &deps.known_geom,
        ),
        parse_geom(
            node.attrs.get("width").map(String::as_str),
            "width",
            &deps.known_geom,
        ),
        align_h(node),
        raster.map(|(w, _)| w as f64),
        None,
        Geom::ViewW,
    );
    let v_axis = axis_bounds(
        parse_geom(
            node.attrs.get("top").map(String::as_str),
            "top",
            &deps.known_geom,
        ),
        parse_geom(
            node.attrs.get("height").map(String::as_str),
            "height",
            &deps.known_geom,
        ),
        align_v(node),
        raster.map(|(_, h)| h as f64),
        text_h,
        Geom::ViewH,
    );
    let mut bounds = Map::new();
    insert_axis(&mut bounds, "x", "right", "w", &h_axis);
    insert_axis(&mut bounds, "y", "bottom", "h", &v_axis);
    if let Some(z) = parse_number(node.attrs.get("zindex").map(String::as_str)) {
        bounds.insert("zIndex".into(), json!(z));
    }
    complete_axis(
        &mut bounds,
        "x",
        "right",
        "w",
        h_axis.size.or_else(|| raster.map(|(w, _)| w as f64)),
        1.0,
        true,
    );
    complete_axis(
        &mut bounds,
        "y",
        "bottom",
        "h",
        v_axis
            .size
            .or_else(|| raster.map(|(_, h)| h as f64))
            .or(text_h),
        text_h.unwrap_or(1.0),
        node.tag != "text",
    );
    Value::Object(bounds)
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Geom {
    Px(f64),
    ViewW,
    ViewH,
    ViewWMinus(f64),
    ViewHMinus(f64),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Align {
    Near,
    Far,
    Stretch,
}

struct Axis {
    near: Option<f64>,
    far: Option<f64>,
    size: Option<f64>,
}

fn parse_geom(raw: Option<&str>, attr: &str, known: &HashMap<String, KnownBox>) -> Option<Geom> {
    let raw = raw?.trim();
    if raw.is_empty() {
        return None;
    }
    if let Some(n) = parse_number(Some(raw)) {
        return Some(Geom::Px(n));
    }
    let expr: String = strip_jscript(raw)
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    match expr.as_str() {
        "view.width" => Some(Geom::ViewW),
        "view.height" => Some(Geom::ViewH),
        _ => {
            if let Some(rest) = expr.strip_prefix("view.width-") {
                rest.parse().ok().map(Geom::ViewWMinus)
            } else if let Some(rest) = expr.strip_prefix("view.height-") {
                rest.parse().ok().map(Geom::ViewHMinus)
            } else {
                parse_ident_geom(&expr, attr, known)
            }
        }
    }
}

fn parse_ident_geom(expr: &str, attr: &str, known: &HashMap<String, KnownBox>) -> Option<Geom> {
    let (id, rest) = expr.split_once('.')?;
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return None;
    }
    let (prop, delta) = split_prop_delta(rest)?;
    match (prop, delta, attr) {
        ("width", None, "width") => Some(Geom::ViewW),
        ("height", None, "height") => Some(Geom::ViewH),
        ("width", Some(n), "width") if n < 0.0 => Some(Geom::ViewWMinus(-n)),
        ("height", Some(n), "height") if n < 0.0 => Some(Geom::ViewHMinus(-n)),
        ("width", Some(n), "left") if n < 0.0 => Some(Geom::ViewWMinus(-n)),
        ("height", Some(n), "top") if n < 0.0 => Some(Geom::ViewHMinus(-n)),
        ("left", delta, "left") => known
            .get(id)
            .and_then(|b| b.x)
            .map(|x| Geom::Px(x + delta.unwrap_or(0.0))),
        ("top", delta, "top") => known
            .get(id)
            .and_then(|b| b.y)
            .map(|y| Geom::Px(y + delta.unwrap_or(0.0))),
        ("height", delta, "top") => known
            .get(id)
            .and_then(|b| b.h)
            .map(|h| Geom::Px(h + delta.unwrap_or(0.0))),
        ("width", delta, "left") => known
            .get(id)
            .and_then(|b| b.w)
            .map(|w| Geom::Px(w + delta.unwrap_or(0.0))),
        _ => None,
    }
}

/// `width-178` → ("width", Some(-178)); `left+18` → ("left", Some(18)).
fn split_prop_delta(rest: &str) -> Option<(&str, Option<f64>)> {
    if rest == "width" || rest == "height" || rest == "left" || rest == "top" {
        return Some((rest, None));
    }
    for prop in ["width", "height", "left", "top"] {
        if let Some(tail) = rest.strip_prefix(prop) {
            if tail.starts_with('+') || tail.starts_with('-') {
                let n: f64 = tail.parse().ok()?;
                return Some((prop, Some(n)));
            }
        }
    }
    None
}

fn align_h(node: &WmsNode) -> Align {
    match node
        .attrs
        .get("horizontalalignment")
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("right") => Align::Far,
        Some("stretch") => Align::Stretch,
        _ => Align::Near,
    }
}

fn align_v(node: &WmsNode) -> Align {
    match node
        .attrs
        .get("verticalalignment")
        .map(|s| s.to_ascii_lowercase())
        .as_deref()
    {
        Some("bottom") => Align::Far,
        Some("stretch") => Align::Stretch,
        _ => Align::Near,
    }
}

fn geom_minus(geom: Geom, view_kind: Geom) -> Option<f64> {
    match (geom, view_kind) {
        (Geom::ViewWMinus(n), Geom::ViewW) => Some(n),
        (Geom::ViewHMinus(n), Geom::ViewH) => Some(n),
        _ => None,
    }
}

fn geom_is_view_span(geom: Geom, view_kind: Geom) -> bool {
    matches!(
        (geom, view_kind),
        (Geom::ViewW, Geom::ViewW) | (Geom::ViewH, Geom::ViewH)
    )
}

fn axis_bounds(
    near: Option<Geom>,
    size: Option<Geom>,
    align: Align,
    raster: Option<f64>,
    font_fallback: Option<f64>,
    view_kind: Geom,
) -> Axis {
    if let Some(g) = size {
        if geom_is_view_span(g, view_kind) {
            let x = match near {
                Some(Geom::Px(n)) => n,
                _ => 0.0,
            };
            return Axis {
                near: Some(x),
                far: Some(0.0),
                size: None,
            };
        }
        if let Some(n) = geom_minus(g, view_kind) {
            let x = match near {
                Some(Geom::Px(l)) => l,
                _ => 0.0,
            };
            return Axis {
                near: Some(x),
                far: Some((n - x).max(0.0)),
                size: None,
            };
        }
    }
    if let Some(g) = near {
        if let Some(n) = geom_minus(g, view_kind) {
            let w = match size {
                Some(Geom::Px(w)) => w,
                _ => raster.filter(|r| *r > 0.0).unwrap_or(n),
            };
            return Axis {
                near: None,
                far: Some((n - w).max(0.0)),
                size: Some(w.max(1.0)),
            };
        }
    }
    if align == Align::Stretch {
        let x = match near {
            Some(Geom::Px(n)) => n,
            _ => 0.0,
        };
        return Axis {
            near: Some(x),
            far: Some(0.0),
            size: None,
        };
    }
    let x = match near {
        Some(Geom::Px(n)) => Some(n),
        _ => None,
    };
    let w = match size {
        Some(Geom::Px(n)) => Some(n),
        _ => raster.filter(|r| *r > 0.0).or(font_fallback),
    };
    Axis {
        near: x,
        far: None,
        size: w,
    }
}

fn insert_axis(bounds: &mut Map<String, Value>, near: &str, far: &str, size: &str, axis: &Axis) {
    if let Some(n) = axis.near {
        bounds.insert(near.into(), json!(n));
    }
    if let Some(f) = axis.far {
        bounds.insert(far.into(), json!(f));
    }
    if let Some(s) = axis.size {
        if axis.far.is_none() || axis.near.is_none() {
            bounds.insert(size.into(), json!(s));
        }
    }
}

fn complete_axis(
    bounds: &mut Map<String, Value>,
    near: &str,
    far: &str,
    size: &str,
    preferred_size: Option<f64>,
    fallback_size: f64,
    allow_fill: bool,
) {
    if bounds.get(near).is_none() && bounds.get(far).is_none() {
        bounds.insert(near.into(), json!(0));
    }
    if bounds.get(size).is_some() || bounds.get(far).is_some() {
        return;
    }
    if let Some(s) = preferred_size.filter(|n| *n > 0.0) {
        bounds.insert(size.into(), json!(s));
        return;
    }
    if allow_fill && bounds.get(near).is_some() {
        bounds.insert(far.into(), json!(0));
        return;
    }
    bounds.insert(size.into(), json!(fallback_size.max(1.0)));
}

fn apply_bind_conditions(node: &WmsNode, obj: &mut Value, deps: &mut LowerDeps<'_>) {
    let id = node.attrs.get("id").map(String::as_str);
    if let Some(when) = map_active_when(node.attrs.get("down").map(String::as_str)) {
        obj["activeWhen"] = json!(when);
        if let Some(down_tip) = node.attrs.get("downtooltip") {
            if obj.get("tooltip").and_then(|v| v.as_str()).is_some() {
                let mut tips = Map::new();
                tips.insert(when, json!(down_tip));
                obj["tooltipWhen"] = Value::Object(tips);
            }
        }
    } else if let Some(raw) = node.attrs.get("down") {
        if looks_like_bind_expr(raw) && !raw.to_ascii_lowercase().starts_with("jscript:") {
            deps.report
                .add(ReportKind::UnmappedAttr, raw.clone(), id, Some("down"));
        }
    }

    let enabled_raw = node
        .attrs
        .get("enabled")
        .or_else(|| node.attrs.get("tabstop"))
        .map(String::as_str);
    apply_when_field(obj, "enabledWhen", enabled_raw, "enabled", id, deps);

    let vis = node.attrs.get("visible").map(String::as_str);
    if !is_false_attr(vis) && !vis.map(|v| v.eq_ignore_ascii_case("true")).unwrap_or(true) {
        apply_when_field(obj, "visibleWhen", vis, "visible", id, deps);
    }
}

fn apply_when_field(
    obj: &mut Value,
    field: &str,
    raw: Option<&str>,
    attr: &str,
    id: Option<&str>,
    deps: &mut LowerDeps<'_>,
) {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return;
    };
    if raw.eq_ignore_ascii_case("true") || is_false_attr(Some(raw)) {
        return;
    }
    if let Some(cond) = map_condition(Some(raw)) {
        obj[field] = json!(cond);
    } else if looks_like_bind_expr(raw) {
        deps.report
            .add(ReportKind::UnmappedAttr, raw.to_string(), id, Some(attr));
    }
}

const MIN_FRAME_TILES: usize = 4;

fn is_frame_chrome_subview(node: &WmsNode) -> bool {
    if node.tag != "subview" || !node.children.is_empty() {
        return false;
    }
    let Some(name) = node.attrs.get("backgroundimage") else {
        return false;
    };
    if is_strict_window_frame_asset(name) {
        return true;
    }
    is_generic_frame_corner_asset(name) && is_flush_window_corner(node, name)
}

fn frame_asset_stem(name: &str) -> String {
    let file = name.replace('\\', "/");
    let file = file.rsplit('/').next().unwrap_or(name);
    file.rsplit_once('.')
        .map(|(s, _)| s)
        .unwrap_or(file)
        .to_ascii_lowercase()
        .replace('-', "_")
}

/// `f_*` / `x_*` 9-slice chrome, always treated as window frame tiles.
fn is_strict_window_frame_asset(name: &str) -> bool {
    let stem = frame_asset_stem(name);
    if let Some(rest) = stem.strip_prefix("x_f_") {
        return is_frame_slice_role(rest);
    }
    if let Some(rest) = stem.strip_prefix("f_") {
        return is_frame_slice_role(rest);
    }
    if let Some(rest) = stem.strip_prefix("x_") {
        return is_frame_slice_role(rest);
    }
    false
}

/// Playlist-style `pl_top_left` outer caps. Inner bezels like `vis_top_left` share this name shape.
fn is_generic_frame_corner_asset(name: &str) -> bool {
    let stem = frame_asset_stem(name);
    if let Some((prefix, rest)) = stem.split_once('_') {
        prefix.len() <= 3
            && matches!(
                rest,
                "top_left"
                    | "top_right"
                    | "bot_left"
                    | "bot_right"
                    | "bottom_left"
                    | "bottom_right"
            )
    } else {
        false
    }
}

fn attr_is_zero(raw: Option<&str>) -> bool {
    parse_number(raw).is_some_and(|n| n == 0.0)
}

fn is_view_width_edge(raw: Option<&str>) -> bool {
    let Some(raw) = raw else {
        return false;
    };
    let compact: String = raw
        .trim()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    compact.starts_with("jscript:view.width")
}

fn is_view_height_edge(raw: Option<&str>) -> bool {
    let Some(raw) = raw else {
        return false;
    };
    let compact: String = raw
        .trim()
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    compact.starts_with("jscript:view.height")
}

/// Generic `{prefix}_top_left` is window chrome only when flush with a window corner.
/// Inset overlays (`vis_top_left` at left=19,top=43) stay as ordinary decorations.
fn is_flush_window_corner(node: &WmsNode, name: &str) -> bool {
    let stem = frame_asset_stem(name);
    let Some((_, rest)) = stem.split_once('_') else {
        return false;
    };
    let left = node.attrs.get("left").map(String::as_str);
    let top = node.attrs.get("top").map(String::as_str);
    let h_right = node
        .attrs
        .get("horizontalalignment")
        .is_some_and(|s| s.eq_ignore_ascii_case("right"))
        || is_view_width_edge(left);
    let v_bottom = node
        .attrs
        .get("verticalalignment")
        .is_some_and(|s| s.eq_ignore_ascii_case("bottom"))
        || is_view_height_edge(top);
    let at_left = left.is_none() || attr_is_zero(left);
    let at_top = top.is_none() || attr_is_zero(top);
    match rest {
        "top_left" => at_left && at_top,
        "top_right" => h_right && at_top,
        "bot_left" | "bottom_left" => at_left && v_bottom,
        "bot_right" | "bottom_right" => h_right && v_bottom,
        _ => false,
    }
}

fn inset_u64(bounds: &Value, key: &str) -> Option<u64> {
    bounds.get(key).and_then(|v| v.as_u64()).or_else(|| {
        bounds
            .get(key)
            .and_then(|v| v.as_f64())
            .map(|n| n.round() as u64)
    })
}

fn bounds_f64(bounds: &Value, key: &str) -> Option<f64> {
    bounds.get(key).and_then(|v| {
        v.as_f64()
            .or_else(|| v.as_u64().map(|n| n as f64))
            .or_else(|| v.as_i64().map(|n| n as f64))
    })
}

struct CornerCap {
    x: Option<f64>,
    y: Option<f64>,
    right: Option<f64>,
    bottom: Option<f64>,
    w: Option<f64>,
    h: Option<f64>,
    z: i64,
}

fn json_i64(v: &Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_u64().map(|n| n as i64))
        .or_else(|| v.as_f64().map(|n| n.round() as i64))
}

fn tile_z_index(tile: &Value) -> i64 {
    tile.get("zIndex")
        .and_then(json_i64)
        .or_else(|| {
            tile.get("bounds")
                .and_then(|b| b.get("zIndex"))
                .and_then(json_i64)
        })
        .unwrap_or(0)
}

/// WMS stretch tiles run to the window edge under the caps. Caps have
/// transparent outer radii, so opaque under-tiles show through as a square.
/// Stop those at the overlapping cap. Overlay strips (higher zIndex, e.g.
/// `f_top_tile`) keep stretching over the cap so the top edge stays blended.
fn inset_stretch_tiles_from_corner_caps(tiles: &mut [Value]) {
    let caps: Vec<CornerCap> = tiles
        .iter()
        .filter(|t| t.get("repeat").is_none())
        .filter_map(|t| {
            let bounds = t.get("bounds")?;
            Some(CornerCap {
                x: bounds_f64(bounds, "x"),
                y: bounds_f64(bounds, "y"),
                right: bounds_f64(bounds, "right"),
                bottom: bounds_f64(bounds, "bottom"),
                w: bounds_f64(bounds, "w"),
                h: bounds_f64(bounds, "h"),
                z: tile_z_index(t),
            })
        })
        .collect();

    for tile in tiles.iter_mut() {
        let Some(repeat) = tile.get("repeat").and_then(|v| v.as_str()) else {
            continue;
        };
        let Some(bounds) = tile.get("bounds").cloned() else {
            continue;
        };
        let stretch_z = tile_z_index(tile);
        match repeat {
            "horizontal" => {
                if bounds_f64(&bounds, "right") != Some(0.0) {
                    continue;
                }
                let stretch_bottom = bounds_f64(&bounds, "bottom");
                let stretch_y = bounds_f64(&bounds, "y");
                let cap_w = caps.iter().find_map(|cap| {
                    if cap.right != Some(0.0) {
                        return None;
                    }
                    if stretch_z > cap.z {
                        return None;
                    }
                    let w = cap.w?;
                    let same_band = match (stretch_bottom, cap.bottom) {
                        (Some(a), Some(b)) if a == b => true,
                        (None, None) => stretch_y.unwrap_or(0.0) == cap.y.unwrap_or(0.0),
                        _ => false,
                    };
                    same_band.then_some(w)
                });
                if let Some(w) = cap_w {
                    tile["bounds"]["right"] = json!(w);
                }
            }
            "vertical" => {
                if bounds_f64(&bounds, "bottom") != Some(0.0) {
                    continue;
                }
                let stretch_x = bounds_f64(&bounds, "x");
                let stretch_right = bounds_f64(&bounds, "right");
                let cap_h = caps.iter().find_map(|cap| {
                    if cap.bottom != Some(0.0) {
                        return None;
                    }
                    if stretch_z > cap.z {
                        return None;
                    }
                    let h = cap.h?;
                    let same_side = match (stretch_x, cap.x) {
                        (Some(a), Some(b)) if a == b => true,
                        _ => match (stretch_right, cap.right) {
                            (Some(a), Some(b)) if a == b => true,
                            _ => false,
                        },
                    };
                    same_side.then_some(h)
                });
                if let Some(h) = cap_h {
                    tile["bounds"]["bottom"] = json!(h);
                }
            }
            _ => {}
        }
    }
}

/// Stretch `backgroundColor` client hole → tiledFrame contentInset.
fn infer_client_content_inset(rest: &[&WmsNode], deps: &mut LowerDeps<'_>) -> Option<Value> {
    let mut best: Option<(u64, Value)> = None;
    for node in rest {
        if node.tag != "subview" {
            continue;
        }
        let Some(bg) = node.attrs.get("backgroundcolor") else {
            continue;
        };
        if bg.eq_ignore_ascii_case("none") {
            continue;
        }
        if !matches!(align_h(node), Align::Stretch) || !matches!(align_v(node), Align::Stretch) {
            continue;
        }
        let bounds = bounds_from(node, deps, None);
        let (Some(left), Some(top), Some(right), Some(bottom)) = (
            inset_u64(&bounds, "x"),
            inset_u64(&bounds, "y"),
            inset_u64(&bounds, "right"),
            inset_u64(&bounds, "bottom"),
        ) else {
            continue;
        };
        let perimeter = left + top + right + bottom;
        if perimeter == 0 {
            continue;
        }
        let inset = json!({
            "left": left,
            "top": top,
            "right": right,
            "bottom": bottom,
        });
        if best.as_ref().is_none_or(|(p, _)| perimeter < *p) {
            best = Some((perimeter, inset));
        }
    }
    best.map(|(_, inset)| inset)
}

fn is_frame_slice_role(rest: &str) -> bool {
    matches!(
        rest,
        "top_left"
            | "top_right"
            | "bot_left"
            | "bot_right"
            | "bottom_left"
            | "bottom_right"
            | "top_tile"
            | "top_tile2"
            | "bot_tile"
            | "left_tile"
            | "right_tile"
            | "top_s"
            | "top_s_2"
            | "bot_s"
            | "bot_s_2"
            | "left_s"
            | "right_s"
            | "top"
            | "bot"
            | "left"
            | "right"
            | "top_center"
            | "bot_center"
            | "bottom_center"
            | "top2"
            | "bot2"
            | "left2"
            | "right2"
    )
}

fn lower_tiled_frame(
    chrome: &[&WmsNode],
    deps: &mut LowerDeps<'_>,
    ids: &mut IdGen,
) -> Option<Value> {
    if chrome.len() < MIN_FRAME_TILES {
        return None;
    }
    let mut tiles = Vec::new();
    for node in chrome {
        let Some(bg) = node.attrs.get("backgroundimage") else {
            continue;
        };
        let Some(asset) = register_image(
            bg,
            AssetRole::Decoration,
            deps,
            Some("frame"),
            node.attrs.get("id").map(String::as_str),
        ) else {
            continue;
        };
        let mut bounds = bounds_from(node, deps, Some(bg));
        let z_index = bounds.as_object_mut().and_then(|o| o.remove("zIndex"));
        let mut tile = json!({
            "asset": asset,
            "bounds": bounds,
        });
        if is_truthy_attr(node.attrs.get("backgroundtiled").map(String::as_str)) {
            let h_stretch = node
                .attrs
                .get("horizontalalignment")
                .map(|s| s.eq_ignore_ascii_case("stretch"))
                .unwrap_or(false);
            let v_stretch = node
                .attrs
                .get("verticalalignment")
                .map(|s| s.eq_ignore_ascii_case("stretch"))
                .unwrap_or(false);
            if h_stretch {
                tile["repeat"] = json!("horizontal");
            } else if v_stretch {
                tile["repeat"] = json!("vertical");
            }
        }
        if let Some((w, h)) = (deps.size_of)(bg) {
            if w >= 1 && h >= 1 {
                tile["tileUnit"] = json!({ "w": w, "h": h });
            }
        }
        if let Some(z) = z_index {
            tile["zIndex"] = z;
        }
        leftover_jscript(node, deps);
        report_unmapped(node, deps, &[]);
        tiles.push(tile);
    }
    if tiles.is_empty() {
        return None;
    }
    inset_stretch_tiles_from_corner_caps(&mut tiles);
    Some(json!({
        "type": "tiledFrame",
        "id": ids.next("frame"),
        "presentation": {
            "kind": "tiledFrame",
            "contentInset": { "left": 0, "top": 0, "right": 0, "bottom": 0 },
            "tiles": tiles,
        },
        "children": [],
    }))
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

/// Identity write implied by the slider bind; trailing unknown calls are ignored.
fn is_implied_slider_onchange(raw: &str, gain: Option<u32>, bind: Option<&str>) -> bool {
    use crate::wms_import::map::split_statements;
    split_statements(raw).iter().any(|stmt| {
        let compact = compact_stmt(stmt);
        if let Some(band) = gain {
            if compact == format!("eq.gainlevel{band}=value") {
                return true;
            }
        }
        match bind {
            Some("player.volume") => compact == "player.settings.volume=value",
            Some("player.balance") => compact == "player.settings.balance=value",
            _ => false,
        }
    })
}

pub fn is_builtin_image(name: &str) -> bool {
    name.trim().to_ascii_lowercase().starts_with("wmpimage_")
}

const LAYOUT_BOX_ATTRS: &[&str] = &["left", "top", "width", "height", "image"];

fn has_layout_box(node: &WmsNode) -> bool {
    node.attrs.contains_key("backgroundimage")
        || LAYOUT_BOX_ATTRS
            .iter()
            .any(|key| node.attrs.contains_key(*key))
}

fn is_background_only(node: &WmsNode) -> bool {
    node.attrs.contains_key("backgroundimage")
        && !LAYOUT_BOX_ATTRS
            .iter()
            .any(|key| node.attrs.contains_key(*key))
}

fn has_displayable_value(node: &WmsNode) -> bool {
    node.attrs
        .get("value")
        .map(|s| {
            let t = s.trim();
            let lower = t.to_ascii_lowercase();
            !t.is_empty() && !lower.starts_with("wmpprop:") && !lower.starts_with("jscript:")
        })
        .unwrap_or(false)
}

/// Tooltip dictionaries and hidden labels with no layout box — not on-screen UI.
fn is_string_bag_text(node: &WmsNode) -> bool {
    node.tag == "text"
        && !has_layout_box(node)
        && (is_false_attr(node.attrs.get("visible").map(String::as_str))
            || !has_displayable_value(node))
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
            known_geom: HashMap::new(),
            close_action: "skin.exit",
            view_ids: Vec::new(),
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
            known_geom: HashMap::new(),
            close_action: "skin.exit",
            view_ids: Vec::new(),
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
            known_geom: HashMap::new(),
            close_action: "skin.exit",
            view_ids: Vec::new(),
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
            known_geom: HashMap::new(),
            close_action: "skin.exit",
            view_ids: Vec::new(),
        };
        let manifest = lower_theme(&root, &mut deps, "plus-nature").expect("lower");
        let children = &manifest["views"]["main"]["layout"]["children"];
        let volume = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "volume")
            .expect("volume");
        assert_eq!(volume["type"], "slider");
        assert_eq!(volume["control"], "volume");
        assert!(volume.get("bind").is_none());
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
            known_geom: HashMap::new(),
            close_action: "skin.exit",
            view_ids: Vec::new(),
        };
        let manifest = lower_theme(&root, &mut deps, "plus-nature").expect("lower");
        let children = &manifest["views"]["main"]["layout"]["children"];
        let seek = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "seek")
            .expect("seek");
        assert_eq!(seek["type"], "slider");
        assert_eq!(seek["control"], "seek");
        assert!(seek.get("bind").is_none());
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
            known_geom: HashMap::new(),
            close_action: "skin.exit",
            view_ids: Vec::new(),
        };
        let manifest = lower_theme(&root, &mut deps, "headspace").expect("lower");
        let children = &manifest["views"]["main"]["layout"]["children"];
        let seek = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "seek")
            .expect("seek");
        assert_eq!(seek["type"], "slider");
        assert_eq!(seek["control"], "seek");
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
            known_geom: HashMap::new(),
            close_action: "skin.exit",
            view_ids: Vec::new(),
        };
        let manifest = lower_theme(&root, &mut deps, "t3").expect("lower");
        let children = &manifest["views"]["main"]["layout"]["children"];
        let eq = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "eq1")
            .expect("eq1");
        assert_eq!(eq["type"], "slider");
        assert_eq!(eq["control"], "eq");
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
            known_geom: HashMap::new(),
            close_action: "skin.exit",
            view_ids: Vec::new(),
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
            known_geom: HashMap::new(),
            close_action: "skin.exit",
            view_ids: Vec::new(),
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
            known_geom: HashMap::new(),
            close_action: "skin.exit",
            view_ids: Vec::new(),
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
            known_geom: HashMap::new(),
            close_action: "skin.exit",
            view_ids: Vec::new(),
        };
        let manifest = lower_theme(&root, &mut deps, "plus-nature").expect("lower");
        let children = &manifest["views"]["main"]["layout"]["children"];
        let bass = children
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == "bass")
            .expect("bass");
        assert_eq!(bass["type"], "slider");
        assert_eq!(bass["control"], "eq");
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
            known_geom: HashMap::new(),
            close_action: "skin.exit",
            view_ids: Vec::new(),
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
        assert_eq!(bass["type"], "slider");
        assert_eq!(bass["control"], "eq");
        assert_eq!(bass["band"], 1);
        assert_eq!(bass["spread"], "linear");
        assert_eq!(treble["type"], "slider");
        assert_eq!(treble["control"], "eq");
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
            report
                .items
                .iter()
                .all(|e| e.node_id.as_deref() != Some("bass")
                    || e.attr.as_deref() != Some("value_onchange")),
            "eq identity plus unknown calls should be implied without a spread formula"
        );
        assert!(report.items.iter().any(|e| {
            e.node_id.as_deref() == Some("mystery") && e.attr.as_deref() == Some("value_onchange")
        }));
    }

    fn lower_xml(xml: &str, sizes: &[(&str, (u32, u32))]) -> (Value, GapReport) {
        lower_xml_resolve(xml, sizes, &[])
    }

    fn lower_xml_resolve(
        xml: &str,
        sizes: &[(&str, (u32, u32))],
        missing: &[&str],
    ) -> (Value, GapReport) {
        let root = parse_wms_xml(xml).expect("parse");
        let mut report = GapReport::new();
        let mut jobs = HashMap::new();
        let size_map: HashMap<&str, (u32, u32)> = sizes.iter().copied().collect();
        let mut size_of = |name: &str| size_map.get(name).copied();
        let mut resolve = |name: &str| {
            if missing.iter().any(|m| *m == name) {
                None
            } else {
                Some(PathBuf::from(format!("/tmp/{name}")))
            }
        };
        let plan = BehaviorPlan::empty();
        let manifest = {
            let mut deps = LowerDeps {
                report: &mut report,
                size_of: &mut size_of,
                resolve_source: &mut resolve,
                jobs: &mut jobs,
                behavior: &plan,
                known_geom: HashMap::new(),
                close_action: "skin.exit",
                view_ids: Vec::new(),
            };
            lower_theme(&root, &mut deps, "lost-planet").expect("lower")
        };
        (manifest, report)
    }

    #[test]
    fn pins_view_width_minus_to_right_and_stretch() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="mainView" width="376" height="216">
          <subview id="botRight" left="jscript:view.width-178" top="jscript:view.height-102"
            verticalAlignment="bottom" horizontalAlignment="right"
            backgroundImage="f_bot_right.png"/>
          <subview id="botTile" left="178" top="jscript:view.height-102"
            verticalAlignment="bottom" horizontalAlignment="stretch"
            backgroundImage="f_bot_tile.png"/>
          <subview id="fill" width="jscript:view.width" height="jscript:view.height"/>
        </view>
      </theme>
    "##;
        let (manifest, report) = lower_xml(
            xml,
            &[
                ("f_bot_right.png", (178, 102)),
                ("f_bot_tile.png", (8, 102)),
            ],
        );
        let layout = &manifest["views"]["main"]["layout"];
        let corner = find_id(layout, "botRight").expect("corner");
        assert!(corner["bounds"].get("x").is_none());
        assert_eq!(corner["bounds"]["right"], 0.0);
        assert_eq!(corner["bounds"]["w"], 178.0);
        assert!(corner["bounds"].get("y").is_none());
        assert_eq!(corner["bounds"]["bottom"], 0.0);
        assert_eq!(corner["bounds"]["h"], 102.0);
        let tile = find_id(layout, "botTile").expect("tile");
        assert_eq!(tile["bounds"]["x"], 178.0);
        assert_eq!(tile["bounds"]["right"], 0.0);
        assert!(tile["bounds"].get("w").is_none());
        assert_eq!(tile["bounds"]["bottom"], 0.0);
        assert_eq!(tile["bounds"]["h"], 102.0);
        let fill = find_id(layout, "fill").expect("fill");
        assert_eq!(fill["bounds"]["x"], 0.0);
        assert_eq!(fill["bounds"]["y"], 0.0);
        assert_eq!(fill["bounds"]["right"], 0.0);
        assert_eq!(fill["bounds"]["bottom"], 0.0);
        assert!(fill["bounds"].get("w").is_none());
        assert!(fill["bounds"].get("h").is_none());
        assert!(
            report
                .items
                .iter()
                .filter(|i| i.kind == ReportKind::Jscript)
                .all(|i| !matches!(i.attr.as_deref(), Some("left" | "top" | "width" | "height"))),
            "folded view.* geometry should not be leftover JScript: {:?}",
            report
                .items
                .iter()
                .filter(|i| i.kind == ReportKind::Jscript)
                .map(|i| (i.node_id.as_deref(), i.attr.as_deref(), i.detail.as_str()))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn maps_standalone_transport_buttons_and_strips_sound_pref() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="mainView" width="331" height="291">
          <prevbutton left="194" top="25" image="m_prev_no.png"
            onClick="checkSoundPref('button.wav');player.controls.previous()"/>
          <playbutton left="231" top="52" image="m_play_no.png"
            onClick="checkSoundPref('button.wav');player.controls.play()"/>
          <stopbutton left="234" top="184" image="m_stop_no.png"
            onClick="checkSoundPref('button.wav');player.controls.stop()"/>
        </view>
      </theme>
    "##;
        let (manifest, report) = lower_xml(
            xml,
            &[
                ("m_prev_no.png", (24, 24)),
                ("m_play_no.png", (24, 24)),
                ("m_stop_no.png", (24, 24)),
            ],
        );
        let layout = &manifest["views"]["main"]["layout"];
        let actions: Vec<_> = layout["children"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|n| n["type"] == "button")
            .map(|n| n["onClick"][0]["action"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(
            actions,
            vec!["player.previousTrack", "player.play", "player.stop"]
        );
        assert!(
            report
                .items
                .iter()
                .filter(|i| i.kind == ReportKind::UnmappedAction)
                .all(|i| !i.detail.to_ascii_lowercase().contains("checksoundpref")),
            "sound-pref wrappers should be ignored"
        );
    }

    #[test]
    fn prefers_main_view_as_primary_and_omits_script_only() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="previewView" backgroundImage="preview.png"/>
        <view id="controlView">
          <player/>
        </view>
        <view id="mainView" width="331" height="291">
          <button id="quit" left="0" top="0" image="quit.png" onClick="view.close();"/>
        </view>
      </theme>
    "##;
        let (manifest, report) =
            lower_xml(xml, &[("preview.png", (400, 300)), ("quit.png", (12, 12))]);
        let views = manifest["views"].as_object().unwrap();
        assert!(views.contains_key("previewview"));
        assert!(views.contains_key("mainview"));
        assert!(!views.contains_key("controlview"));
        assert_eq!(views["mainview"]["presentation"], "primary");
        assert_eq!(views["previewview"]["presentation"], "auxiliary");
        assert_eq!(views["previewview"]["layout"]["width"], 400.0);
        assert_eq!(views["previewview"]["layout"]["height"], 300.0);
        assert!(report.items.iter().any(|i| {
            i.kind == ReportKind::Info
                && i.node_id.as_deref() == Some("controlView")
                && i.detail.contains("script-only")
        }));
    }

    #[test]
    fn omits_tooltip_string_bags_and_empty_wrapper() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="mainView" width="331" height="291">
          <subview id="locSub">
            <text id="locShowPl" toolTip="Show Playlist"/>
            <text id="locHidePl" toolTip="Hide Playlist"/>
          </subview>
          <text id="title" left="10" top="10" width="80" fontSize="9" value="Hello"/>
        </view>
      </theme>
    "##;
        let (manifest, report) = lower_xml(xml, &[]);
        let layout = &manifest["views"]["main"]["layout"];
        assert!(find_id(layout, "locShowPl").is_none());
        assert!(find_id(layout, "locSub").is_none());
        let title = find_id(layout, "title").expect("title");
        assert_eq!(title["value"], "Hello");
        assert_eq!(title["bounds"]["h"], 12.0);
        let bags: Vec<_> = report
            .items
            .iter()
            .filter(|i| i.kind == ReportKind::Hidden)
            .map(|i| i.node_id.as_deref())
            .collect();
        assert!(bags.contains(&Some("locShowPl")));
        assert!(bags.contains(&Some("locHidePl")));
    }

    #[test]
    fn sizes_background_only_subview_from_raster() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="mainView" width="331" height="291">
          <subview id="mainBack" backgroundImage="main_back.png"/>
        </view>
      </theme>
    "##;
        let (manifest, _) = lower_xml(xml, &[("main_back.png", (331, 291))]);
        let back = find_id(&manifest["views"]["main"]["layout"], "mainBack").unwrap();
        assert_eq!(back["bounds"]["x"], 0.0);
        assert_eq!(back["bounds"]["y"], 0.0);
        assert_eq!(back["bounds"]["w"], 331.0);
        assert_eq!(back["bounds"]["h"], 291.0);
    }

    #[test]
    fn omits_subview_when_background_file_is_missing() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="mainView" width="331" height="291">
          <subview id="plCopyLeft" zIndex="26" backgroundImage="pl_copy_left.png"/>
          <subview id="mainBack" backgroundImage="main_back.png"/>
        </view>
      </theme>
    "##;
        let (manifest, report) =
            lower_xml_resolve(xml, &[("main_back.png", (331, 291))], &["pl_copy_left.png"]);
        let layout = &manifest["views"]["main"]["layout"];
        assert!(find_id(layout, "plCopyLeft").is_none());
        assert!(find_id(layout, "mainBack").is_some());
        let json = layout.to_string();
        assert!(!json.contains("pl-copy-left"));
        assert!(report.items.iter().any(|i| {
            i.kind == ReportKind::MissingFile
                && i.detail == "pl_copy_left.png"
                && i.node_id.as_deref() == Some("plCopyLeft-bg")
        }));
    }

    #[test]
    fn maps_custom_slider_image_and_position_map() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="mainView" width="331" height="291">
          <customSlider id="volume" left="56" top="49" min="0" max="100"
            image="volume.png" positionImage="volume_map.png"
            value="wmpprop:player.settings.volume"
            value_onchange="wmpprop:player.settings.volume = value;updateVolToolTip('volume');player.settings.mute = false;" />
          <customSlider id="seek" left="56" top="183"
            image="seek.png" positionImage="seek_map.png" />
        </view>
      </theme>
    "##;
        let (manifest, report) = lower_xml(
            xml,
            &[
                ("volume.png", (4428, 60)),
                ("volume_map.png", (164, 60)),
                ("seek.png", (4428, 60)),
                ("seek_map.png", (164, 60)),
            ],
        );
        let layout = &manifest["views"]["main"]["layout"];
        let volume = find_id(layout, "volume").expect("volume");
        assert_eq!(volume["type"], "slider");
        assert_eq!(volume["control"], "volume");
        assert_eq!(volume["presentation"]["kind"], "stripSlider");
        assert_eq!(volume["presentation"]["strip"], "sliders/volume.png");
        assert_eq!(
            volume["presentation"]["positionMap"],
            "sliders/volume-map.png"
        );
        assert_eq!(volume["presentation"]["frameWidth"], 164.0);
        assert_eq!(volume["presentation"]["frameHeight"], 60.0);
        assert_eq!(volume["presentation"]["frameCount"], 27);
        assert_eq!(volume["presentation"]["direction"], "horizontal");
        assert_eq!(volume["bounds"]["w"], 164.0);
        assert_eq!(volume["bounds"]["h"], 60.0);
        let seek = find_id(layout, "seek").expect("seek");
        assert_eq!(seek["type"], "slider");
        assert_eq!(seek["control"], "seek");
        assert_eq!(seek["presentation"]["kind"], "stripSlider");
        assert_eq!(seek["presentation"]["frameCount"], 27);
        assert!(
            report
                .items
                .iter()
                .filter(|i| i.attr.as_deref() == Some("value_onchange"))
                .all(|i| i.node_id.as_deref() != Some("volume")),
            "volume identity plus trailing calls should not be leftover: {:?}",
            report.items
        );
        assert!(report
            .items
            .iter()
            .all(|i| { i.kind != ReportKind::Info || !i.detail.contains("missing thumb/track") }));
    }

    #[test]
    fn uses_wms_view_min_width_height() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="plView" width="376" height="216" minWidth="565" minHeight="310" resizable="true">
          <subview id="fill" width="jscript:view.width" height="jscript:view.height"/>
        </view>
        <view id="mainView" width="331" height="291">
          <button id="play" image="m_play.png" onClick="player.controls.play();"/>
        </view>
      </theme>
    "##;
        let (manifest, _) = lower_xml(xml, &[("m_play.png", (20, 20))]);
        let pl = &manifest["views"]["plview"]["window"];
        assert_eq!(pl["defaultWidth"], 376.0);
        assert_eq!(pl["minWidth"], 565.0);
        assert_eq!(pl["minHeight"], 310.0);
        assert_eq!(pl["resizable"], true);
        let main = &manifest["views"]["mainview"]["window"];
        assert_eq!(main["minWidth"], 331.0);
        assert_eq!(main["minHeight"], 291.0);
    }

    #[test]
    fn folds_sibling_and_parent_ident_geometry() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="plView" width="376" height="216" resizable="true">
          <subview id="cPos" left="19" top="43" width="jscript:view.width-34"
            height="jscript:view.height-81" verticalAlignment="stretch" horizontalAlignment="stretch"/>
          <subview id="cBack" left="jscript:cPos.left" top="jscript:cPos.top" backgroundImage="c_back.png"/>
          <subview id="plFrame" left="20" top="47" width="jscript:view.width-178"
            height="jscript:view.height-111" verticalAlignment="stretch" horizontalAlignment="stretch">
            <playlist id="playlist1" width="jscript:plFrame.width" height="jscript:plFrame.height"
              horizontalAlignment="stretch" verticalAlignment="stretch"/>
            <subview id="pinRight" left="jscript:plFrame.width-43" backgroundImage="pl_copy_right.png"
              horizontalAlignment="right"/>
          </subview>
          <button id="galSet1" left="15" top="jscript:cBack.height" image="c_set1.png"/>
        </view>
        <view id="mainView" width="331" height="291">
          <button id="play" image="m_play.png"/>
        </view>
      </theme>
    "##;
        let (manifest, report) = lower_xml(
            xml,
            &[
                ("c_back.png", (300, 80)),
                ("pl_copy_right.png", (43, 21)),
                ("c_set1.png", (20, 20)),
                ("m_play.png", (20, 20)),
            ],
        );
        let layout = &manifest["views"]["plview"]["layout"];
        let back = find_id(layout, "cBack").expect("cBack");
        assert_eq!(back["bounds"]["x"], 19.0);
        assert_eq!(back["bounds"]["y"], 43.0);
        let playlist = find_id(layout, "playlist1").expect("playlist");
        assert_eq!(playlist["bounds"]["x"], 0.0);
        assert_eq!(playlist["bounds"]["right"], 0.0);
        assert!(playlist["bounds"].get("w").is_none());
        let pin = find_id(layout, "pinRight").expect("pin");
        assert!(pin["bounds"].get("x").is_none());
        assert_eq!(pin["bounds"]["right"], 0.0);
        assert_eq!(pin["bounds"]["w"], 43.0);
        let gal = find_id(layout, "galSet1").expect("gal");
        assert_eq!(gal["bounds"]["y"], 80.0);
        let leftover: Vec<_> = report
            .items
            .iter()
            .filter(|i| i.kind == ReportKind::Jscript)
            .filter(|i| matches!(i.attr.as_deref(), Some("left" | "top" | "width" | "height")))
            .collect();
        assert!(
            leftover.is_empty(),
            "folded ident geometry should not be leftover JScript: {leftover:?}"
        );
    }

    #[test]
    fn eq_identity_onchange_ignores_trailing_calls() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="mainView" width="331" height="291">
          <slider id="eq1" left="36" top="67" thumbImage="eq_thumb.png" foregroundImage="eq_slider.png"
            min="-14" max="14" value="wmpprop:eq.gainLevel1"
            value_onchange="eq.gainLevel1=value;setPresetText()" direction="vertical"/>
        </view>
      </theme>
    "##;
        let (manifest, report) = lower_xml(
            xml,
            &[("eq_thumb.png", (12, 8)), ("eq_slider.png", (8, 80))],
        );
        let eq1 = find_id(&manifest["views"]["main"]["layout"], "eq1").expect("eq1");
        assert_eq!(eq1["type"], "slider");
        assert_eq!(eq1["control"], "eq");
        assert_eq!(eq1["band"], 1);
        assert!(
            report
                .items
                .iter()
                .all(|i| i.attr.as_deref() != Some("value_onchange")),
            "eq identity plus setPresetText should be implied: {:?}",
            report.items
        );
    }

    #[test]
    fn maps_mute_shuffle_presets_and_aux_close() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="eqView" width="376" height="216">
          <button id="mute" image="m_mute.png" onClick="player.settings.mute = !player.settings.mute"
            down="wmpprop:player.settings.mute" sticky="true" upToolTip="Mute" downToolTip="Sound"/>
          <button id="btnShuffle" image="pl_shuff.png"
            down="jscript:player.settings.getMode('shuffle');"
            onClick="checkSoundPref('button.wav');player.settings.setMode('shuffle',down);"
            upTooltip="Turn Shuffle On" downTooltip="Turn Shuffle Off" sticky="true"/>
          <button id="eqNext" image="eq_next.png"
            onClick="checkSoundPref('button.wav');eq.nextPreset();setPresetText()"/>
          <button id="eqClose" image="f_close.png" onClick="onViewClose('eqViewer')"/>
        </view>
        <view id="mainView" width="331" height="291">
          <button id="play" image="m_play.png" onClick="player.controls.play();"/>
        </view>
      </theme>
    "##;
        let (manifest, report) = lower_xml(
            xml,
            &[
                ("m_mute.png", (16, 16)),
                ("pl_shuff.png", (16, 16)),
                ("eq_next.png", (16, 16)),
                ("f_close.png", (16, 16)),
                ("m_play.png", (20, 20)),
            ],
        );
        let layout = &manifest["views"]["eqview"]["layout"];
        let mute = find_id(layout, "mute").expect("mute");
        assert_eq!(mute["onClick"][0]["action"], "player.toggleMute");
        assert_eq!(mute["activeWhen"], "player.muted");
        assert_eq!(mute["tooltip"], "Mute");
        assert_eq!(mute["tooltipWhen"]["player.muted"], "Sound");
        let shuffle = find_id(layout, "btnShuffle").expect("shuffle");
        assert_eq!(shuffle["onClick"][0]["action"], "player.toggleShuffle");
        assert_eq!(shuffle["activeWhen"], "player.shuffle");
        let next = find_id(layout, "eqNext").expect("next");
        assert_eq!(next["onClick"][0]["action"], "eq.nextPreset");
        let close = find_id(layout, "eqClose").expect("close");
        assert_eq!(close["onClick"][0]["action"], "skin.closeView");
        assert_eq!(close["onClick"][0]["payload"]["viewId"], "eqview");
        let leftover_down: Vec<_> = report
            .items
            .iter()
            .filter(|i| i.attr.as_deref() == Some("down"))
            .collect();
        assert!(
            leftover_down.is_empty(),
            "mapped sticky down should not be leftover: {leftover_down:?}"
        );
        assert!(report.items.iter().all(|i| {
            i.attr.as_deref() != Some("onClick")
                || !i.detail.contains("eq.nextPreset") && !i.detail.contains("setMode")
        }));
    }

    #[test]
    fn stubs_listbox_and_editbox() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="mainView" width="376" height="216">
          <listbox id="plListBox1" left="0" top="0" width="110" height="80"
            backgroundColor="#0C1321" foregroundColor="#C1D0E7"/>
          <editbox id="plSearchEdit" left="2" top="1" width="80" height="14"
            value="Search..." backgroundColor="#000000" foregroundColor="#C1D0E7"/>
        </view>
      </theme>
    "##;
        let (manifest, report) = lower_xml(xml, &[]);
        let layout = &manifest["views"]["main"]["layout"];
        let list = find_id(layout, "plListBox1").expect("listbox");
        assert_eq!(list["type"], "playlist");
        assert_eq!(list["showDropdown"], false);
        assert_eq!(list["style"]["color"], "#C1D0E7");
        let edit = find_id(layout, "plSearchEdit").expect("editbox");
        assert_eq!(edit["type"], "input");
        assert_eq!(edit["placeholder"], "Search...");
        assert_eq!(edit["onChange"][0]["action"], "playlist.setFilter");
        assert!(report.items.iter().any(|i| {
            i.node_id.as_deref() == Some("plListBox1")
                && i.detail.contains("listbox stubbed as playlist")
        }));
        assert!(report.items.iter().any(|i| {
            i.node_id.as_deref() == Some("plSearchEdit")
                && i.detail.contains("editbox mapped as input")
        }));
        assert!(report
            .items
            .iter()
            .all(|i| i.kind != ReportKind::UnmappedElement
                || (!i.detail.contains("<listbox>") && !i.detail.contains("<editbox>"))));
    }

    #[test]
    fn collapses_nine_slice_chrome_into_tiled_frame() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="plView" width="376" height="216">
          <subview zIndex="5" backgroundImage="f_top_left.png"/>
          <subview zIndex="5" left="jscript:view.width-178" horizontalAlignment="right" backgroundImage="f_top_right.png"/>
          <subview zIndex="5" top="jscript:view.height-102" verticalAlignment="bottom" backgroundImage="f_bot_left.png"/>
          <subview zIndex="5" left="jscript:view.width-178" top="jscript:view.height-102"
            verticalAlignment="bottom" horizontalAlignment="right" backgroundImage="f_bot_right.png"/>
          <subview zIndex="6" left="178" horizontalAlignment="stretch" backgroundImage="f_top_tile.png" backgroundTiled="true"/>
          <subview zIndex="4" top="104" verticalAlignment="stretch" backgroundImage="f_left_tile.png" backgroundTiled="true"/>
          <button id="plClose" image="f_close.png" onClick="onViewClose('plViewer')"/>
        </view>
        <view id="mainView" width="331" height="291">
          <button id="play" image="m_play.png"/>
        </view>
      </theme>
    "##;
        let (manifest, _) = lower_xml(
            xml,
            &[
                ("f_top_left.png", (178, 104)),
                ("f_top_right.png", (178, 104)),
                ("f_bot_left.png", (178, 102)),
                ("f_bot_right.png", (178, 102)),
                ("f_top_tile.png", (8, 104)),
                ("f_left_tile.png", (178, 8)),
                ("f_close.png", (16, 16)),
                ("m_play.png", (20, 20)),
            ],
        );
        let children = manifest["views"]["plview"]["layout"]["children"]
            .as_array()
            .unwrap();
        let frame = children
            .iter()
            .find(|n| n["type"] == "tiledFrame")
            .expect("tiledFrame");
        let tiles = frame["presentation"]["tiles"].as_array().unwrap();
        assert!(
            tiles.len() >= 6,
            "expected 9-slice tiles, got {}",
            tiles.len()
        );
        assert!(tiles.iter().any(|t| t["asset"]
            .as_str()
            .is_some_and(|a| a.starts_with("frame/") && a.contains("top-left"))));
        assert!(tiles
            .iter()
            .any(|t| t.get("repeat").and_then(|v| v.as_str()) == Some("horizontal")));
        let top_tile = tiles
            .iter()
            .find(|t| t["asset"].as_str().is_some_and(|a| a.contains("top-tile")))
            .expect("top tile");
        assert_eq!(top_tile["bounds"]["right"], 0.0);
        let left_tile = tiles
            .iter()
            .find(|t| t["asset"].as_str().is_some_and(|a| a.contains("left-tile")))
            .expect("left tile");
        assert_eq!(left_tile["bounds"]["bottom"], 102.0);
        assert!(children.iter().all(|n| n["id"] != "botRight"));
        let close = find_id(&manifest["views"]["plview"]["layout"], "plClose").expect("close");
        assert_eq!(close["onClick"][0]["action"], "skin.closeView");
        assert_eq!(close["onClick"][0]["payload"]["viewId"], "plview");
    }

    #[test]
    fn vis_inner_bezel_stays_out_of_tiled_frame() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="visView" width="376" height="216">
          <subview backgroundImage="f_top_left.png"/>
          <subview left="jscript:view.width-178" horizontalAlignment="right" backgroundImage="f_top_right.png"/>
          <subview top="jscript:view.height-102" verticalAlignment="bottom" backgroundImage="f_bot_left.png"/>
          <subview left="jscript:view.width-178" top="jscript:view.height-102"
            verticalAlignment="bottom" horizontalAlignment="right" backgroundImage="f_bot_right.png"/>
          <subview zIndex="41" left="19" top="43" backgroundImage="vis_top_left.png" passThrough="true"/>
          <subview zIndex="6" left="16" top="42" width="jscript:view.width-32"
            height="jscript:view.height-79" verticalAlignment="stretch" horizontalAlignment="stretch"
            backgroundColor="#000000"/>
          <subview id="visFrame" left="20" top="44" width="jscript:view.width-40"
            height="jscript:view.height-79" verticalAlignment="stretch" horizontalAlignment="stretch"
            backgroundColor="#000000"/>
        </view>
        <view id="mainView" width="331" height="291">
          <button id="play" image="m_play.png"/>
        </view>
      </theme>
    "##;
        let (manifest, _) = lower_xml(
            xml,
            &[
                ("f_top_left.png", (178, 104)),
                ("f_top_right.png", (178, 104)),
                ("f_bot_left.png", (178, 102)),
                ("f_bot_right.png", (178, 102)),
                ("vis_top_left.png", (227, 110)),
                ("m_play.png", (20, 20)),
            ],
        );
        let layout = &manifest["views"]["visview"]["layout"];
        let frame = layout["children"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["type"] == "tiledFrame")
            .expect("tiledFrame");
        let tiles = frame["presentation"]["tiles"].as_array().unwrap();
        assert!(tiles.iter().all(|t| t["asset"]
            .as_str()
            .is_none_or(|a| !a.contains("vis-top-left"))));
        assert_eq!(frame["presentation"]["contentInset"]["left"], 16);
        assert_eq!(frame["presentation"]["contentInset"]["top"], 42);
        assert_eq!(frame["presentation"]["contentInset"]["right"], 16);
        assert_eq!(frame["presentation"]["contentInset"]["bottom"], 37);
        let vis_tl = layout["children"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| {
                n["presentation"]["assets"]["default"]
                    .as_str()
                    .is_some_and(|a| a.contains("vis-top-left"))
                    || n["children"].as_array().is_some_and(|c| {
                        c.iter().any(|ch| {
                            ch["presentation"]["assets"]["default"]
                                .as_str()
                                .is_some_and(|a| a.contains("vis-top-left"))
                        })
                    })
            })
            .expect("vis_top_left decoration");
        assert_ne!(vis_tl["type"], "tiledFrame");
        let fill = layout["children"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["style"]["backgroundColor"] == "#000000" && n["id"] != "visFrame")
            .expect("black fill");
        assert_eq!(fill["style"]["backgroundColor"], "#000000");
        assert_eq!(
            find_id(layout, "visFrame").unwrap()["style"]["backgroundColor"],
            "#000000"
        );
    }

    #[test]
    fn playlist_prefix_corner_still_folds_into_tiled_frame() {
        let xml = r##"
      <theme id="Lost Planet">
        <view id="plView" width="376" height="216">
          <subview backgroundImage="pl_top_left.png"/>
          <subview left="jscript:view.width-178" horizontalAlignment="right" backgroundImage="f_top_right.png"/>
          <subview top="jscript:view.height-102" verticalAlignment="bottom" backgroundImage="f_bot_left.png"/>
          <subview left="jscript:view.width-178" top="jscript:view.height-102"
            verticalAlignment="bottom" horizontalAlignment="right" backgroundImage="f_bot_right.png"/>
        </view>
        <view id="mainView" width="331" height="291">
          <button id="play" image="m_play.png"/>
        </view>
      </theme>
    "##;
        let (manifest, _) = lower_xml(
            xml,
            &[
                ("pl_top_left.png", (178, 104)),
                ("f_top_right.png", (178, 104)),
                ("f_bot_left.png", (178, 102)),
                ("f_bot_right.png", (178, 102)),
                ("m_play.png", (20, 20)),
            ],
        );
        let tiles = manifest["views"]["plview"]["layout"]["children"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["type"] == "tiledFrame")
            .expect("tiledFrame")["presentation"]["tiles"]
            .as_array()
            .unwrap();
        assert!(tiles.iter().any(|t| t["asset"]
            .as_str()
            .is_some_and(|a| a.contains("pl-top-left"))));
    }
}
