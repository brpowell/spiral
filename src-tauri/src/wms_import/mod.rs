//! WMS / WMZ skin importer used by the `wms_import` CLI and the `import_wms_skin` Tauri command.

mod behavior;
mod convert;
mod fold;
mod lower;
mod map;
mod parse;
mod paths;
mod report;

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::copy;
use std::path::{Path, PathBuf};

use serde::ser::{Serialize, SerializeMap, SerializeSeq, Serializer};
use walkdir::WalkDir;
use zip::ZipArchive;

use behavior::analyze_behavior;
use convert::{
    convert_asset_jobs, parse_chroma, raster_size_from_file, write_preview_png, AssetJob,
};
use fold::{fold_jscript_attrs, parse_js_numeric_consts};
use lower::{is_builtin_image, lower_theme, LowerDeps};
use parse::{decode_wms_bytes, parse_wms_xml};
use paths::slugify;
use report::{GapReport, ReportKind};

const SCHEMA: &str =
    "https://raw.githubusercontent.com/spiral-powered/spk-format/main/schemas/skin-v1.schema.json";

const EXTENSIONS: &[&str] = &[".bmp", ".png", ".gif", ".jpg", ".jpeg"];

pub struct ImportWmsOptions {
    pub input: PathBuf,
    pub out: PathBuf,
    pub id: Option<String>,
    /// Default `#ff00ff`.
    pub chroma: Option<String>,
    pub dry_run: bool,
}

pub struct ImportWmsResult {
    pub skin_path: Option<PathBuf>,
    pub report_path: Option<PathBuf>,
    pub report_markdown: String,
    /// After `spk_format::validate_skin_contribution_at` when not dry-run.
    pub layout_ok: bool,
    pub errors: Vec<String>,
}

pub fn import_wms_skin(options: &ImportWmsOptions) -> Result<ImportWmsResult, String> {
    let chroma_str = options.chroma.as_deref().unwrap_or("#ff00ff");
    let chroma = parse_chroma(chroma_str)?;
    let mut report = GapReport::new();
    let mut cleanup: Option<PathBuf> = None;

    let result = (|| {
        let resolved = resolve_input(&options.input)?;
        cleanup = resolved.tmp.clone();

        let bytes = fs::read(&resolved.wms_path)
            .map_err(|e| format!("failed to read {}: {e}", resolved.wms_path.display()))?;
        let xml = decode_wms_bytes(&bytes);
        let mut theme = parse_wms_xml(&xml)?;

        let mut js_source = String::new();
        let mut consts = HashMap::new();
        if let Some(js_path) = companion_js(&resolved.wms_path, &resolved.asset_root) {
            let js_bytes = fs::read(&js_path)
                .map_err(|e| format!("failed to read {}: {e}", js_path.display()))?;
            js_source = decode_wms_bytes(&js_bytes);
            consts = parse_js_numeric_consts(&js_source);
            let leftover = fold_jscript_attrs(&mut theme, &consts);
            for item in leftover {
                report.add(
                    ReportKind::Jscript,
                    item.value,
                    item.node_id.as_deref(),
                    Some(&item.attr),
                );
            }
        }
        let behavior = if js_source.trim().is_empty() {
            behavior::BehaviorPlan::empty()
        } else {
            analyze_behavior(&js_source, &consts, &theme)
        };
        for note in &behavior.notes {
            report.add(
                note.kind,
                note.detail.clone(),
                note.node_id.as_deref(),
                None,
            );
        }

        let index = build_asset_index(&resolved.asset_root);
        let mut size_cache: HashMap<String, Option<(u32, u32)>> = HashMap::new();
        let mut jobs: HashMap<String, AssetJob> = HashMap::new();

        let skin_id = options
            .id
            .as_ref()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .or_else(|| {
                theme
                    .attrs
                    .get("id")
                    .map(|s| slugify(s))
                    .filter(|s| !s.is_empty())
            })
            .or_else(|| {
                let s = slugify(&basename_no_ext(&resolved.wms_path));
                if s.is_empty() {
                    None
                } else {
                    Some(s)
                }
            })
            .unwrap_or_else(|| "imported-skin".into());

        let mut resolve_source = |name: &str| resolve_asset_path(&index, name);
        let mut size_of = |name: &str| {
            if let Some(cached) = size_cache.get(name) {
                return *cached;
            }
            let path = resolve_asset_path(&index, name);
            let size = path.as_ref().and_then(|p| raster_size_from_file(p));
            size_cache.insert(name.to_string(), size);
            size
        };

        let mut deps = LowerDeps {
            report: &mut report,
            size_of: &mut size_of,
            resolve_source: &mut resolve_source,
            jobs: &mut jobs,
            behavior: &behavior,
        };
        let manifest = lower_theme(&theme, &mut deps, &skin_id)?;

        if options.dry_run {
            return Ok(ImportWmsResult {
                skin_path: None,
                report_path: None,
                report_markdown: report.to_markdown(),
                layout_ok: true,
                errors: Vec::new(),
            });
        }

        fs::create_dir_all(&options.out)
            .map_err(|e| format!("failed to create out dir {}: {e}", options.out.display()))?;

        let assets_dir = options.out.join("assets");
        let job_list: Vec<AssetJob> = jobs.values().cloned().collect();
        convert_asset_jobs(&job_list, &assets_dir, &chroma, &mut report);

        let preview_src =
            find_preview_source(&index).or_else(|| pick_largest_decoration(&jobs, &mut size_cache));
        if let Some(preview_src) = preview_src {
            if let Err(err) = write_preview_png(&preview_src, &options.out.join("preview.png")) {
                report.add(
                    ReportKind::Info,
                    format!("preview.png failed: {err}"),
                    None,
                    None,
                );
            }
        } else {
            report.add(
                ReportKind::Info,
                "no preview source image found",
                None,
                None,
            );
        }

        let mut skin_json = {
            let mut ordered = serde_json::Map::new();
            ordered.insert("$schema".into(), serde_json::json!(SCHEMA));
            if let Some(obj) = manifest.as_object() {
                for (k, v) in obj {
                    if k != "$schema" {
                        ordered.insert(k.clone(), v.clone());
                    }
                }
            }
            serde_json::Value::Object(ordered)
        };
        coerce_whole_numbers(&mut skin_json);

        let skin_path = options.out.join("skin.json");
        let report_path = options.out.join("import-report.md");
        let body = format!(
            "{}\n",
            serde_json::to_string_pretty(&OrderedJson(&skin_json)).map_err(|e| e.to_string())?
        );
        fs::write(&skin_path, body)
            .map_err(|e| format!("failed to write {}: {e}", skin_path.display()))?;
        let markdown = report.to_markdown();
        fs::write(&report_path, &markdown)
            .map_err(|e| format!("failed to write {}: {e}", report_path.display()))?;

        let mut errors = Vec::new();
        let layout_ok = match spk_format::validate_skin_contribution_at(&skin_path) {
            Ok(()) => true,
            Err(err) => {
                errors.push(err);
                false
            }
        };

        Ok(ImportWmsResult {
            skin_path: Some(skin_path),
            report_path: Some(report_path),
            report_markdown: markdown,
            layout_ok,
            errors,
        })
    })();

    if let Some(tmp) = cleanup {
        let _ = fs::remove_dir_all(tmp);
    }
    result
}

struct ResolvedInput {
    wms_path: PathBuf,
    asset_root: PathBuf,
    tmp: Option<PathBuf>,
}

fn resolve_input(input: &Path) -> Result<ResolvedInput, String> {
    let ext = input
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext == "wmz" || ext == "zip" {
        let tmp = make_temp_dir()?;
        unpack_wmz(input, &tmp)?;
        let found = find_wms_in_dir(&tmp);
        if found.is_empty() {
            return Err("archive contains no .wms file".into());
        }
        if found.len() > 1 {
            let list = found
                .iter()
                .map(|p| p.display().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            return Err(format!(
                "archive contains multiple .wms files; unpack and pass one with --input ({list})"
            ));
        }
        let wms_path = found.into_iter().next().unwrap();
        let asset_root = wms_path.parent().unwrap_or(Path::new(".")).to_path_buf();
        return Ok(ResolvedInput {
            wms_path,
            asset_root,
            tmp: Some(tmp),
        });
    }
    if ext == "wms" {
        let asset_root = input.parent().unwrap_or(Path::new(".")).to_path_buf();
        return Ok(ResolvedInput {
            wms_path: input.to_path_buf(),
            asset_root,
            tmp: None,
        });
    }
    let found = find_wms_in_dir(input);
    if found.is_empty() {
        return Err(format!("no .wms found in {}", input.display()));
    }
    if found.len() > 1 {
        let list = found
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ");
        return Err(format!(
            "folder contains multiple .wms files; pass one with --input ({list})"
        ));
    }
    let wms_path = found.into_iter().next().unwrap();
    let asset_root = wms_path.parent().unwrap_or(Path::new(".")).to_path_buf();
    Ok(ResolvedInput {
        wms_path,
        asset_root,
        tmp: None,
    })
}

fn make_temp_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join(format!(
        "wms-import-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    ));
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create temp dir: {e}"))?;
    Ok(dir)
}

fn unpack_wmz(zip_path: &Path, dest: &Path) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| format!("failed to open zip: {e}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|e| format!("failed to read zip archive: {e}"))?;

    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("failed to read zip entry {i}: {e}"))?;

        let Some(entry_path) = entry.enclosed_name().map(|p| p.to_owned()) else {
            return Err(format!("zip entry has an invalid path: {}", entry.name()));
        };

        let outpath = dest.join(&entry_path);

        if entry.is_dir() || entry.name().ends_with('/') {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("failed to create directory {}: {e}", outpath.display()))?;
            continue;
        }

        if let Some(parent) = outpath.parent() {
            fs::create_dir_all(parent).map_err(|e| {
                format!(
                    "failed to create parent directory for {}: {e}",
                    outpath.display()
                )
            })?;
        }

        let mut outfile = File::create(&outpath)
            .map_err(|e| format!("failed to create {}: {e}", outpath.display()))?;
        copy(&mut entry, &mut outfile)
            .map_err(|e| format!("failed to extract {}: {e}", entry.name()))?;
    }
    Ok(())
}

fn find_wms_in_dir(dir: &Path) -> Vec<PathBuf> {
    WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .filter(|e| {
            e.path()
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.eq_ignore_ascii_case("wms"))
                .unwrap_or(false)
        })
        .map(|e| e.into_path())
        .collect()
}

fn build_asset_index(asset_root: &Path) -> HashMap<String, PathBuf> {
    let mut index = HashMap::new();
    let Ok(entries) = fs::read_dir(asset_root) else {
        return index;
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
        index.insert(name, entry.path());
    }
    index
}

fn resolve_asset_path(index: &HashMap<String, PathBuf>, raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || is_builtin_image(trimmed) {
        return None;
    }
    let base = trimmed
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .unwrap_or(trimmed)
        .to_string();
    let lower = base.to_ascii_lowercase();
    if let Some(hit) = index.get(&lower) {
        return Some(hit.clone());
    }
    if !has_extension(&lower) {
        for ext in EXTENSIONS {
            if let Some(hit) = index.get(&format!("{lower}{ext}")) {
                return Some(hit.clone());
            }
        }
    }
    None
}

fn has_extension(name: &str) -> bool {
    name.rfind('.')
        .map(|i| name[i + 1..].chars().all(|c| c.is_ascii_alphanumeric()))
        .unwrap_or(false)
}

fn find_preview_source(index: &HashMap<String, PathBuf>) -> Option<PathBuf> {
    for name in ["preview.png", "preview.jpg", "preview.jpeg", "preview.bmp"] {
        if let Some(hit) = index.get(name) {
            return Some(hit.clone());
        }
    }
    None
}

fn companion_js(wms_path: &Path, asset_root: &Path) -> Option<PathBuf> {
    let name = format!("{}.js", basename_no_ext(wms_path));
    let index = build_asset_index(asset_root);
    index.get(&name.to_ascii_lowercase()).cloned()
}

fn basename_no_ext(path: &Path) -> String {
    path.file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn pick_largest_decoration(
    jobs: &HashMap<String, AssetJob>,
    size_cache: &mut HashMap<String, Option<(u32, u32)>>,
) -> Option<PathBuf> {
    let mut best: Option<(PathBuf, u64)> = None;
    for job in jobs.values() {
        if !job.dest_rel.starts_with("decorations/") {
            continue;
        }
        let size = size_cache
            .entry(job.source_name.clone())
            .or_insert_with(|| raster_size_from_file(&job.source_path))
            .unwrap_or((0, 0));
        let area = size.0 as u64 * size.1 as u64;
        match &best {
            Some((_, a)) if *a >= area => {}
            _ => best = Some((job.source_path.clone(), area)),
        }
    }
    best.map(|(p, _)| p)
}

/// Root `skin.json` object.
const SKIN_JSON_ROOT_KEYS: &[&str] = &[
    "$schema",
    "id",
    "name",
    "description",
    "author",
    "preview",
    "stylesheet",
    "views",
];

/// Per-view object (`views.*`).
const SKIN_JSON_VIEW_KEYS: &[&str] = &["window", "state", "layout"];

/// Canvas layout node (`views.*.layout`).
const SKIN_JSON_LAYOUT_KEYS: &[&str] = &["type", "width", "height", "children"];

/// Layout tree nodes (buttons, subviews, decorations, …).
const SKIN_JSON_NODE_KEYS: &[&str] = &["id", "name", "type", "bounds", "presentation"];

/// Pretty-print wrapper that emits a context-specific key prefix, then the rest
/// in serde_json's default (alphabetical) order.
struct OrderedJson<'a>(&'a serde_json::Value);

impl Serialize for OrderedJson<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            serde_json::Value::Array(arr) => {
                let mut seq = serializer.serialize_seq(Some(arr.len()))?;
                for v in arr {
                    seq.serialize_element(&OrderedJson(v))?;
                }
                seq.end()
            }
            serde_json::Value::Object(map) => {
                let mut ser = serializer.serialize_map(Some(map.len()))?;
                for key in ordered_object_keys(map) {
                    ser.serialize_entry(key, &OrderedJson(&map[key]))?;
                }
                ser.end()
            }
            other => other.serialize(serializer),
        }
    }
}

fn leading_keys_for(map: &serde_json::Map<String, serde_json::Value>) -> &'static [&'static str] {
    if map.contains_key("$schema") || (map.contains_key("views") && !map.contains_key("type")) {
        SKIN_JSON_ROOT_KEYS
    } else if map.contains_key("window") && map.contains_key("layout") {
        SKIN_JSON_VIEW_KEYS
    } else if map.get("type").and_then(|v| v.as_str()) == Some("canvas") {
        SKIN_JSON_LAYOUT_KEYS
    } else {
        SKIN_JSON_NODE_KEYS
    }
}

fn ordered_object_keys(map: &serde_json::Map<String, serde_json::Value>) -> Vec<&String> {
    let leading = leading_keys_for(map);
    let mut keys = Vec::with_capacity(map.len());
    for lead in leading {
        if let Some((k, _)) = map.get_key_value(*lead) {
            keys.push(k);
        }
    }
    for k in map.keys() {
        if !leading.contains(&k.as_str()) {
            keys.push(k);
        }
    }
    keys
}

/// Emit whole numbers as integers so `spk_format` sees i32 bounds.
fn coerce_whole_numbers(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::Number(n) => {
            if let Some(f) = n.as_f64() {
                if f.fract() == 0.0 && f >= i64::MIN as f64 && f <= i64::MAX as f64 {
                    *value = serde_json::json!(f as i64);
                }
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr {
                coerce_whole_numbers(v);
            }
        }
        serde_json::Value::Object(map) => {
            for v in map.values_mut() {
                coerce_whole_numbers(v);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn top_level_keys(pretty: &str) -> Vec<&str> {
        pretty
            .lines()
            .filter_map(|line| {
                let rest = line.strip_prefix("  \"")?;
                let key = rest.split('"').next()?;
                Some(key)
            })
            .collect()
    }

    #[test]
    fn skin_json_leading_keys_come_first() {
        let value = json!({
            "visibleWhen": "view.drawer.eq",
            "onClick": [{ "action": "play" }],
            "presentation": { "kind": "bitmap" },
            "bounds": { "x": 1, "y": 2, "w": 3, "h": 4 },
            "type": "button",
            "name": "Close",
            "id": "btnClose",
            "tooltip": "Close",
        });
        let pretty = serde_json::to_string_pretty(&OrderedJson(&value)).unwrap();
        assert_eq!(
            top_level_keys(&pretty),
            [
                "id",
                "name",
                "type",
                "bounds",
                "presentation",
                "onClick",
                "tooltip",
                "visibleWhen",
            ]
        );
    }

    #[test]
    fn skin_json_root_key_order() {
        let value = json!({
            "views": {},
            "stylesheet": "skin.css",
            "preview": "preview.png",
            "author": "Microsoft",
            "description": "A skin",
            "name": "Plus! Nature",
            "id": "plus-nature",
            "$schema": SCHEMA,
        });
        let pretty = serde_json::to_string_pretty(&OrderedJson(&value)).unwrap();
        assert_eq!(
            top_level_keys(&pretty),
            [
                "$schema",
                "id",
                "name",
                "description",
                "author",
                "preview",
                "stylesheet",
                "views",
            ]
        );
    }

    #[test]
    fn skin_json_view_key_order() {
        let value = json!({
            "presentation": "primary",
            "layout": {
                "children": [],
                "height": 2,
                "width": 1,
                "type": "canvas",
            },
            "state": { "drawer": { "default": "closed" } },
            "window": { "resizable": false },
        });
        let pretty = serde_json::to_string_pretty(&OrderedJson(&value)).unwrap();
        assert_eq!(
            top_level_keys(&pretty),
            ["window", "state", "layout", "presentation"]
        );
        let layout = pretty.split("\"layout\"").nth(1).expect("layout object");
        let ty = layout.find("\n    \"type\"").unwrap();
        let width = layout.find("\n    \"width\"").unwrap();
        let height = layout.find("\n    \"height\"").unwrap();
        let children = layout.find("\n    \"children\"").unwrap();
        assert!(ty < width && width < height && height < children);
    }

    #[test]
    fn skin_json_leading_keys_apply_to_nested_nodes() {
        let value = json!({
            "layout": {
                "type": "canvas",
                "width": 10,
                "children": [
                    {
                        "tooltip": "Play",
                        "type": "button",
                        "id": "play",
                        "bounds": { "x": 0, "y": 0, "w": 1, "h": 1 },
                        "presentation": { "kind": "bitmap" },
                    }
                ]
            }
        });
        let pretty = serde_json::to_string_pretty(&OrderedJson(&value)).unwrap();
        let child = pretty.split("\"children\"").nth(1).expect("children array");
        let id = child.find("\n        \"id\"").unwrap();
        let ty = child.find("\n        \"type\"").unwrap();
        let bounds = child.find("\n        \"bounds\"").unwrap();
        let presentation = child.find("\n        \"presentation\"").unwrap();
        let tooltip = child.find("\n        \"tooltip\"").unwrap();
        assert!(id < ty && ty < bounds && bounds < presentation && presentation < tooltip);
    }
}
