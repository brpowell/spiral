//! Bounded matcher for WMP companion JS drawer / toggle / EQ-tilt idioms.
//!
//! Not a JScript VM. Recovers paired `moveTo` endpoints and `.visible` flips
//! that a button actually clicks, then emits Spiral `view.state` +
//! `applyStateEvent` / `boundsWhen` / `visibleWhen`. Also detects the
//! Nature/Optik bass–treble linear tilt so `eqBand` sliders can emit `spread`.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde_json::{json, Map, Value};

use crate::wms_import::fold::eval_const_expr;
use crate::wms_import::map::{bare_call_name, split_statements};
use crate::wms_import::parse::{visit_wms, WmsNode};
use crate::wms_import::report::ReportKind;

const MAX_SLIDE_IDS: usize = 6;
const MAX_VIS_IDS: usize = 6;

#[derive(Debug, Clone, Default)]
pub struct BehaviorPlan {
    /// State variables to attach to the view that owns the target nodes.
    pub variables: BTreeMap<String, StateVar>,
    /// Lowercase function name → click effects.
    fn_effects: HashMap<String, Vec<Value>>,
    /// Layout node id → `visibleWhen`.
    pub visible_when: HashMap<String, Value>,
    /// Layout node id → `boundsWhen`.
    pub bounds_when: HashMap<String, Value>,
    /// Node ids this plan cares about (for attaching `state` on the right view).
    pub target_ids: HashSet<String>,
    /// Lowercase companion-JS functions that implement the Nature/Optik
    /// bass–treble linear tilt (`gainLevel2`…`9` weighted averages).
    pub eq_linear_spread_fns: HashSet<String>,
    pub notes: Vec<PlanNote>,
}

#[derive(Debug, Clone)]
pub struct PlanNote {
    pub kind: ReportKind,
    pub detail: String,
    pub node_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StateVar {
    pub default: String,
    pub on: BTreeMap<String, Vec<Value>>,
}

impl BehaviorPlan {
    pub fn empty() -> Self {
        Self::default()
    }

    pub fn is_empty(&self) -> bool {
        self.variables.is_empty()
    }

    pub fn effects_for_statement(&self, stmt: &str) -> Option<Vec<Value>> {
        let name = bare_call_name(stmt)?;
        self.fn_effects.get(&name.to_ascii_lowercase()).cloned()
    }

    /// `AdjustAudio(); eq.gainLevel1 = value;` — identity write plus the tilt fn.
    pub fn is_eq_linear_spread_onchange(&self, raw: &str) -> bool {
        if self.eq_linear_spread_fns.is_empty() {
            return false;
        }
        let stmts = split_statements(raw);
        if stmts.is_empty() {
            return false;
        }
        let mut saw_spread = false;
        for stmt in stmts {
            if let Some(name) = bare_call_name(&stmt) {
                if self
                    .eq_linear_spread_fns
                    .contains(&name.to_ascii_lowercase())
                {
                    saw_spread = true;
                    continue;
                }
                return false;
            }
            if is_eq_identity_assign(&stmt) {
                continue;
            }
            return false;
        }
        saw_spread
    }

    pub fn state_json(&self) -> Value {
        let mut map = Map::new();
        for (name, var) in &self.variables {
            let mut on = Map::new();
            for (event, branches) in &var.on {
                on.insert(event.clone(), Value::Array(branches.clone()));
            }
            map.insert(
                name.clone(),
                json!({
                    "default": var.default,
                    "on": on,
                }),
            );
        }
        Value::Object(map)
    }
}

#[derive(Clone, Debug)]
struct NodeInfo {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Clone, Debug, Default)]
struct FnBody {
    moves: Vec<MoveCall>,
    vis: Vec<(String, bool)>,
    callees: Vec<String>,
    mentions_last_open: bool,
}

#[derive(Clone, Debug)]
struct MoveCall {
    target: String,
    x: Coord,
    y: Coord,
}

#[derive(Clone, Debug, PartialEq)]
enum Coord {
    Num(f64),
    Keep,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Axis {
    X,
    Y,
}

#[derive(Clone, Debug)]
struct Slide {
    id: String,
    axis: Axis,
    closed: f64,
    open: f64,
}

pub fn analyze_behavior(js: &str, consts: &HashMap<String, f64>, theme: &WmsNode) -> BehaviorPlan {
    let nodes = collect_nodes(theme);
    let clicked = collect_clicked_fns(theme);
    if clicked.is_empty() && js.trim().is_empty() {
        return BehaviorPlan::empty();
    }

    let (view_w, view_h) = first_view_size(theme);
    let bodies = parse_functions(js);
    let eq_linear_spread_fns = detect_eq_linear_spread_fns(&bodies);
    let ctx = ResolveCtx {
        consts,
        nodes: &nodes,
        view_w,
        view_h,
    };

    let mut resolved: HashMap<String, FnBody> = HashMap::new();
    for (name, raw) in &bodies {
        resolved.insert(name.clone(), interpret_body(name, raw, &bodies, &ctx));
    }

    let clicked_lc: HashSet<String> = clicked.iter().map(|s| s.to_ascii_lowercase()).collect();
    let reachable = reachable_fns(&clicked_lc, &resolved);

    let slides = pair_slides(&resolved, &reachable, &nodes, &ctx);
    let mut plan = BehaviorPlan::empty();
    plan.eq_linear_spread_fns = eq_linear_spread_fns;

    if slides.len() > MAX_SLIDE_IDS {
        let ids: Vec<_> = slides.iter().map(|s| s.id.as_str()).collect();
        plan.notes.push(PlanNote {
            kind: ReportKind::Info,
            detail: format!(
                "skipped drawer mapping ({} sliding ids, cap is {MAX_SLIDE_IDS}): {}",
                slides.len(),
                ids.join(", ")
            ),
            node_id: None,
        });
    } else if !slides.is_empty() {
        emit_slides(&mut plan, &slides, &resolved, &reachable, &clicked_lc);
    }

    emit_visibility_toggles(&mut plan, &resolved, &reachable, &clicked_lc, &nodes);

    plan
}

struct ResolveCtx<'a> {
    consts: &'a HashMap<String, f64>,
    nodes: &'a HashMap<String, NodeInfo>,
    view_w: f64,
    view_h: f64,
}

fn collect_nodes(theme: &WmsNode) -> HashMap<String, NodeInfo> {
    let mut out = HashMap::new();
    visit_wms(theme, &mut |n| {
        let Some(id) = n.attrs.get("id") else {
            return;
        };
        if id.is_empty() {
            return;
        }
        let x = parse_f(n.attrs.get("left")).unwrap_or(0.0);
        let y = parse_f(n.attrs.get("top")).unwrap_or(0.0);
        let w = parse_f(n.attrs.get("width")).unwrap_or(0.0);
        let h = parse_f(n.attrs.get("height")).unwrap_or(0.0);
        out.insert(id.clone(), NodeInfo { x, y, w, h });
    });
    out
}

fn collect_clicked_fns(theme: &WmsNode) -> Vec<String> {
    let mut names = Vec::new();
    visit_wms(theme, &mut |n| {
        let Some(raw) = n.attrs.get("onclick") else {
            return;
        };
        for stmt in split_statements(raw) {
            if let Some(name) = bare_call_name(&stmt) {
                names.push(name);
            }
        }
    });
    names
}

fn first_view_size(theme: &WmsNode) -> (f64, f64) {
    let Some(view) = theme.children.iter().find(|c| c.tag == "view") else {
        return (0.0, 0.0);
    };
    (
        parse_f(view.attrs.get("width")).unwrap_or(0.0),
        parse_f(view.attrs.get("height")).unwrap_or(0.0),
    )
}

fn parse_f(raw: Option<&String>) -> Option<f64> {
    let s = raw?.trim();
    s.parse().ok()
}

fn reachable_fns(clicked: &HashSet<String>, bodies: &HashMap<String, FnBody>) -> HashSet<String> {
    let mut out = clicked.clone();
    let mut stack: Vec<String> = clicked.iter().cloned().collect();
    while let Some(name) = stack.pop() {
        let Some(body) = bodies.get(&name) else {
            continue;
        };
        for callee in &body.callees {
            let lc = callee.to_ascii_lowercase();
            if out.insert(lc.clone()) {
                stack.push(lc);
            }
        }
    }
    out
}

fn pair_slides(
    bodies: &HashMap<String, FnBody>,
    reachable: &HashSet<String>,
    nodes: &HashMap<String, NodeInfo>,
    ctx: &ResolveCtx<'_>,
) -> Vec<Slide> {
    let mut points: HashMap<String, BTreeSet<(i64, i64)>> = HashMap::new();
    for (fname, body) in bodies {
        if !reachable.contains(&fname.to_ascii_lowercase()) {
            continue;
        }
        for mv in &body.moves {
            if !nodes.contains_key(&mv.target) {
                continue;
            }
            let Some(pt) = point_of(mv, nodes.get(&mv.target).unwrap()) else {
                continue;
            };
            points.entry(mv.target.clone()).or_default().insert(pt);
        }
    }

    let mut slides = Vec::new();
    for (id, pts) in points {
        if pts.len() != 2 {
            continue;
        }
        let mut iter = pts.iter();
        let a = *iter.next().unwrap();
        let b = *iter.next().unwrap();
        let node = nodes.get(&id).unwrap();
        let default = (q(node.x), q(node.y));
        let (closed_pt, open_pt) = if a == default {
            (a, b)
        } else if b == default {
            (b, a)
        } else {
            // Prefer the point closer to layout as closed.
            let da = (a.0 as f64 - node.x).abs() + (a.1 as f64 - node.y).abs();
            let db = (b.0 as f64 - node.x).abs() + (b.1 as f64 - node.y).abs();
            if da <= db {
                (a, b)
            } else {
                (b, a)
            }
        };
        let dx = (open_pt.0 - closed_pt.0).abs();
        let dy = (open_pt.1 - closed_pt.1).abs();
        if dx < 1 && dy < 1 {
            continue;
        }
        let (axis, closed, open) = if dx >= dy {
            (Axis::X, closed_pt.0 as f64, open_pt.0 as f64)
        } else {
            (Axis::Y, closed_pt.1 as f64, open_pt.1 as f64)
        };
        let _ = ctx;
        slides.push(Slide {
            id,
            axis,
            closed,
            open,
        });
    }
    slides.sort_by(|a, b| a.id.cmp(&b.id));
    slides
}

fn point_of(mv: &MoveCall, node: &NodeInfo) -> Option<(i64, i64)> {
    let x = match mv.x {
        Coord::Num(n) => n,
        Coord::Keep => node.x,
        Coord::Unknown => return None,
    };
    let y = match mv.y {
        Coord::Num(n) => n,
        Coord::Keep => node.y,
        Coord::Unknown => return None,
    };
    Some((q(x), q(y)))
}

fn q(n: f64) -> i64 {
    n.round() as i64
}

fn emit_slides(
    plan: &mut BehaviorPlan,
    slides: &[Slide],
    bodies: &HashMap<String, FnBody>,
    reachable: &HashSet<String>,
    clicked: &HashSet<String>,
) {
    let slide_by_id: HashMap<&str, &Slide> = slides.iter().map(|s| (s.id.as_str(), s)).collect();

    // Functions that move a sliding id.
    let mut movers_of: HashMap<String, Vec<String>> = HashMap::new();
    for (fname, body) in bodies {
        if !reachable.contains(&fname.to_ascii_lowercase()) {
            continue;
        }
        for mv in &body.moves {
            if slide_by_id.contains_key(mv.target.as_str()) {
                movers_of
                    .entry(mv.target.clone())
                    .or_default()
                    .push(fname.clone());
            }
        }
    }
    for names in movers_of.values_mut() {
        names.sort();
        names.dedup();
    }

    // Cluster: one variable per sliding id. If several functions move the
    // same id, that variable is a mutex enum (Nature). Independent ids stay
    // open/closed (Headspace).
    let mut used_var_names: HashSet<String> = HashSet::new();

    for slide in slides {
        let movers = movers_of.get(&slide.id).cloned().unwrap_or_default();
        let toggles: Vec<String> = movers
            .iter()
            .filter(|n| fn_kind(n, bodies.get(*n), slide) != FnKind::CloseOnly)
            .cloned()
            .collect();
        let closes: Vec<String> = movers
            .iter()
            .filter(|n| fn_kind(n, bodies.get(*n), slide) == FnKind::CloseOnly)
            .cloned()
            .collect();

        let mutex = toggles.len() >= 2;
        let var_name = unique_name(
            if mutex {
                id_stem(&slide.id)
            } else if let Some(t) = toggles.first() {
                panel_stem(t)
            } else {
                id_stem(&slide.id)
            },
            &mut used_var_names,
        );

        plan.target_ids.insert(slide.id.clone());
        plan.bounds_when.insert(
            slide.id.clone(),
            bounds_when_json(slide, &var_name, &toggles, mutex),
        );

        let mut on: BTreeMap<String, Vec<Value>> = BTreeMap::new();
        let mut vis_map: HashMap<String, BTreeSet<String>> = HashMap::new();

        if mutex {
            let values: Vec<String> = toggles.iter().map(|t| panel_stem(t)).collect();
            for (toggle, value) in toggles.iter().zip(values.iter()) {
                let event = format!("toggle{}", pascal(value));
                let others: Vec<String> = values.iter().filter(|v| *v != value).cloned().collect();
                on.insert(
                    event.clone(),
                    vec![
                        json!({ "from": [value], "set": "closed" }),
                        json!({ "from": from_closed_and_others(&others), "set": value }),
                    ],
                );
                plan.fn_effects.insert(
                    toggle.to_ascii_lowercase(),
                    vec![apply_event(&var_name, &event)],
                );
                collect_vis_true(bodies.get(toggle), value, &mut vis_map, Some(&slide.id));
            }
            on.insert(
                "close".into(),
                vec![json!({ "from": values, "set": "closed" })],
            );
            for close_fn in closes {
                plan.fn_effects.insert(
                    close_fn.to_ascii_lowercase(),
                    vec![apply_event(&var_name, "close")],
                );
            }
            plan.notes.push(PlanNote {
                kind: ReportKind::Info,
                detail: format!(
                    "mapped mutex drawer `{}` → state.{var_name} (closed {}={}, open {}={}) via {}",
                    slide.id,
                    axis_name(slide.axis),
                    slide.closed,
                    axis_name(slide.axis),
                    slide.open,
                    toggles.join(", ")
                ),
                node_id: Some(slide.id.clone()),
            });
        } else {
            on.insert(
                "toggle".into(),
                vec![
                    json!({ "from": ["closed"], "set": "open" }),
                    json!({ "from": ["open"], "set": "closed" }),
                ],
            );
            on.insert(
                "close".into(),
                vec![json!({ "from": ["open"], "set": "closed" })],
            );
            for t in &toggles {
                plan.fn_effects.insert(
                    t.to_ascii_lowercase(),
                    vec![apply_event(&var_name, "toggle")],
                );
                collect_vis_true(bodies.get(t), "open", &mut vis_map, Some(&slide.id));
            }
            for c in &closes {
                plan.fn_effects.insert(
                    c.to_ascii_lowercase(),
                    vec![apply_event(&var_name, "close")],
                );
            }
            plan.notes.push(PlanNote {
                kind: ReportKind::Info,
                detail: format!(
                    "mapped slide `{}` → state.{var_name} (closed {}={}, open {}={})",
                    slide.id,
                    axis_name(slide.axis),
                    slide.closed,
                    axis_name(slide.axis),
                    slide.open
                ),
                node_id: Some(slide.id.clone()),
            });
        }

        apply_vis_map(plan, vis_map, &var_name);
        plan.variables.insert(
            var_name.clone(),
            StateVar {
                default: "closed".into(),
                on,
            },
        );
        let open_values: Vec<String> = if mutex {
            toggles.iter().map(|t| panel_stem(t)).collect()
        } else {
            vec!["open".into()]
        };
        wire_satellites(
            plan,
            bodies,
            reachable,
            clicked,
            &toggles,
            &var_name,
            mutex,
            &open_values,
        );
    }
}

fn from_closed_and_others(others: &[String]) -> Vec<String> {
    let mut from = vec!["closed".to_string()];
    from.extend(others.iter().cloned());
    from
}

/// Closed value that remembers `value` as last-open. `closed` itself is the
/// default last panel (WMP `iLastOpenDrawer` else-branch).
fn closed_remembering(value: &str, default_last: &str) -> String {
    if value == default_last {
        "closed".into()
    } else {
        format!("closed{}", pascal(value))
    }
}

fn closed_states_for(open_values: &[String], default_last: &str) -> Vec<String> {
    let mut states = vec!["closed".to_string()];
    for value in open_values {
        let closed = closed_remembering(value, default_last);
        if !states.iter().any(|s| s == &closed) {
            states.push(closed);
        }
    }
    states
}

fn from_closed_states_and_others(closed_states: &[String], others: &[String]) -> Vec<String> {
    let mut from = closed_states.to_vec();
    from.extend(others.iter().cloned());
    from
}

fn default_last_open(body: &FnBody, open_values: &[String]) -> String {
    body.callees
        .iter()
        .rev()
        .map(|c| panel_stem(c))
        .find(|stem| open_values.iter().any(|v| v == stem))
        .or_else(|| open_values.last().cloned())
        .unwrap_or_else(|| "open".into())
}

fn apply_last_open_mutex(
    on: &mut BTreeMap<String, Vec<Value>>,
    open_values: &[String],
    default_last: &str,
) {
    let closed_states = closed_states_for(open_values, default_last);
    for value in open_values {
        let event = format!("toggle{}", pascal(value));
        let others: Vec<String> = open_values
            .iter()
            .filter(|v| *v != value)
            .cloned()
            .collect();
        on.insert(
            event,
            vec![
                json!({ "from": [value], "set": closed_remembering(value, default_last) }),
                json!({
                    "from": from_closed_states_and_others(&closed_states, &others),
                    "set": value
                }),
            ],
        );
    }
    on.insert(
        "close".into(),
        open_values
            .iter()
            .map(|value| json!({ "from": [value], "set": closed_remembering(value, default_last) }))
            .collect(),
    );
}

fn toggle_handle_branches(
    open_values: &[String],
    last_open: bool,
    default_last: &str,
) -> Vec<Value> {
    if !last_open {
        let reopen = open_values
            .first()
            .cloned()
            .unwrap_or_else(|| "open".into());
        return vec![
            json!({ "from": open_values, "set": "closed" }),
            json!({ "from": ["closed"], "set": reopen }),
        ];
    }
    let mut branches = Vec::with_capacity(open_values.len() * 2);
    for value in open_values {
        branches.push(json!({
            "from": [value],
            "set": closed_remembering(value, default_last)
        }));
    }
    for value in open_values {
        branches.push(json!({
            "from": [closed_remembering(value, default_last)],
            "set": value
        }));
    }
    branches
}

fn bounds_when_json(slide: &Slide, var: &str, toggles: &[String], mutex: bool) -> Value {
    let key = if slide.axis == Axis::X { "x" } else { "y" };
    let mut map = Map::new();
    if mutex {
        for t in toggles {
            let value = panel_stem(t);
            map.insert(format!("view.{var}.{value}"), json!({ key: slide.open }));
        }
    } else {
        map.insert(format!("view.{var}.open"), json!({ key: slide.open }));
    }
    Value::Object(map)
}

fn collect_vis_true(
    body: Option<&FnBody>,
    value: &str,
    vis_map: &mut HashMap<String, BTreeSet<String>>,
    skip_id: Option<&str>,
) {
    let Some(body) = body else {
        return;
    };
    for (id, vis) in &body.vis {
        if !*vis {
            continue;
        }
        if skip_id == Some(id.as_str()) {
            continue;
        }
        vis_map
            .entry(id.clone())
            .or_default()
            .insert(value.to_string());
    }
}

fn apply_vis_map(plan: &mut BehaviorPlan, vis_map: HashMap<String, BTreeSet<String>>, var: &str) {
    for (id, values) in vis_map {
        if values.is_empty() {
            continue;
        }
        plan.target_ids.insert(id.clone());
        let cond = if values.len() == 1 {
            json!(format!("view.{var}.{}", values.iter().next().unwrap()))
        } else {
            let any: Vec<Value> = values
                .iter()
                .map(|v| json!(format!("view.{var}.{v}")))
                .collect();
            json!({ "any": any })
        };
        plan.visible_when.insert(id, cond);
    }
}

fn wire_satellites(
    plan: &mut BehaviorPlan,
    bodies: &HashMap<String, FnBody>,
    reachable: &HashSet<String>,
    clicked: &HashSet<String>,
    toggles: &[String],
    var_name: &str,
    mutex: bool,
    open_values: &[String],
) {
    let toggle_lc: HashSet<String> = toggles.iter().map(|t| t.to_ascii_lowercase()).collect();
    let mut candidates: Vec<(String, Satellite)> = Vec::new();
    for (fname, body) in bodies {
        let lc = fname.to_ascii_lowercase();
        if !reachable.contains(&lc) {
            continue;
        }
        if plan.fn_effects.contains_key(&lc) {
            continue;
        }
        if !body.moves.is_empty() {
            continue;
        }
        if body.callees.is_empty() {
            continue;
        }
        let callees_ok = body.callees.iter().all(|c| {
            let clc = c.to_ascii_lowercase();
            toggle_lc.contains(&clc)
                || plan.fn_effects.contains_key(&clc)
                || looks_close(c)
                || looks_handle(c)
        });
        if !callees_ok {
            continue;
        }
        candidates.push((fname.clone(), satellite_kind(fname, body, clicked)));
    }
    candidates.sort_by_key(|(_, kind)| match kind {
        Satellite::Close => 0,
        Satellite::Handle => 1,
        Satellite::Skip => 2,
    });
    for (fname, kind) in candidates {
        let lc = fname.to_ascii_lowercase();
        if plan.fn_effects.contains_key(&lc) {
            continue;
        }
        let body = bodies.get(&fname).unwrap();
        match kind {
            Satellite::Close => {
                plan.fn_effects
                    .insert(lc, vec![apply_event(var_name, "close")]);
                plan.notes.push(PlanNote {
                    kind: ReportKind::Info,
                    detail: format!("mapped `{fname}()` → {var_name}.close"),
                    node_id: None,
                });
            }
            Satellite::Handle if mutex => {
                let last_open = body.mentions_last_open;
                let default_last = if last_open {
                    default_last_open(body, open_values)
                } else {
                    open_values
                        .first()
                        .cloned()
                        .unwrap_or_else(|| "open".into())
                };
                if last_open {
                    if let Some(var) = plan.variables.get_mut(var_name) {
                        apply_last_open_mutex(&mut var.on, open_values, &default_last);
                    }
                }
                plan.variables.get_mut(var_name).map(|var| {
                    var.on.insert(
                        "toggleHandle".into(),
                        toggle_handle_branches(open_values, last_open, &default_last),
                    )
                });
                plan.fn_effects
                    .insert(lc, vec![apply_event(var_name, "toggleHandle")]);
                let extra = if last_open {
                    " (last-open remembered via closed states)"
                } else {
                    ""
                };
                plan.notes.push(PlanNote {
                    kind: ReportKind::Info,
                    detail: format!("mapped `{fname}()` → {var_name}.toggleHandle{extra}"),
                    node_id: None,
                });
            }
            Satellite::Handle => {
                plan.fn_effects
                    .insert(lc, vec![apply_event(var_name, "toggle")]);
            }
            Satellite::Skip => {}
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum FnKind {
    Toggle,
    CloseOnly,
}

fn fn_kind(_name: &str, body: Option<&FnBody>, slide: &Slide) -> FnKind {
    let Some(body) = body else {
        return FnKind::Toggle;
    };
    let mut hits_open = false;
    let mut hits_closed = false;
    for mv in &body.moves {
        if mv.target != slide.id {
            continue;
        }
        let coord = match slide.axis {
            Axis::X => &mv.x,
            Axis::Y => &mv.y,
        };
        match coord {
            Coord::Num(n) if (*n - slide.open).abs() < 0.6 => hits_open = true,
            Coord::Num(n) if (*n - slide.closed).abs() < 0.6 => hits_closed = true,
            _ => {}
        }
    }
    if hits_closed && !hits_open {
        FnKind::CloseOnly
    } else {
        FnKind::Toggle
    }
}

enum Satellite {
    Close,
    Handle,
    Skip,
}

fn satellite_kind(name: &str, body: &FnBody, clicked: &HashSet<String>) -> Satellite {
    let lc = name.to_ascii_lowercase();
    let clicked_here = clicked.contains(&lc);
    if looks_close(name) {
        return Satellite::Close;
    }
    if body.mentions_last_open || looks_handle(name) {
        return Satellite::Handle;
    }
    // A no-move function that only calls panel toggles and is itself clicked
    // is almost always a dedicated close (Nature DrawerClose).
    if clicked_here {
        return Satellite::Close;
    }
    Satellite::Skip
}

fn looks_close(name: &str) -> bool {
    let s = name.to_ascii_lowercase();
    s.contains("close") || s.contains("hide") || s.contains("collapse")
}

fn looks_handle(name: &str) -> bool {
    let s = name.to_ascii_lowercase();
    s.contains("handle") || s == "drawertoggle" || s.ends_with("drawertoggle")
}

fn emit_visibility_toggles(
    plan: &mut BehaviorPlan,
    bodies: &HashMap<String, FnBody>,
    reachable: &HashSet<String>,
    clicked: &HashSet<String>,
    nodes: &HashMap<String, NodeInfo>,
) {
    let mut used: HashSet<String> = plan.variables.keys().cloned().collect();
    for (fname, body) in bodies {
        let lc = fname.to_ascii_lowercase();
        if !clicked.contains(&lc) || !reachable.contains(&lc) {
            continue;
        }
        if plan.fn_effects.contains_key(&lc) {
            continue;
        }
        if !body.moves.is_empty() {
            continue;
        }
        if body.vis.is_empty() {
            continue;
        }
        // Skip parameterized helpers and huge bags (SetVisibility over many nodes).
        let vis_ids: BTreeSet<String> = body
            .vis
            .iter()
            .map(|(id, _)| id.clone())
            .filter(|id| nodes.contains_key(id))
            .collect();
        if vis_ids.is_empty() || vis_ids.len() > MAX_VIS_IDS {
            continue;
        }
        if !looks_panel_vis_toggle(fname) {
            continue;
        }
        let var = unique_name(panel_stem(fname), &mut used);
        plan.fn_effects
            .insert(lc, vec![apply_event(&var, "toggle")]);
        plan.variables.insert(
            var.clone(),
            StateVar {
                default: "closed".into(),
                on: BTreeMap::from([(
                    "toggle".into(),
                    vec![
                        json!({ "from": ["closed"], "set": "open" }),
                        json!({ "from": ["open"], "set": "closed" }),
                    ],
                )]),
            },
        );
        for id in vis_ids {
            plan.target_ids.insert(id.clone());
            plan.visible_when
                .entry(id)
                .or_insert_with(|| json!(format!("view.{var}.open")));
        }
        plan.notes.push(PlanNote {
            kind: ReportKind::Info,
            detail: format!("mapped visibility toggle `{fname}()` → state.{var}"),
            node_id: None,
        });
    }
}

fn looks_panel_vis_toggle(name: &str) -> bool {
    let s = name.to_ascii_lowercase();
    if s.contains("video") || s.contains("display") || s.contains("album") {
        return false;
    }
    if s.contains("toggle") || s.contains("drawer") {
        return true;
    }
    let action =
        s.contains("show") || s.contains("hide") || s.contains("open") || s.contains("close");
    let panel = s.contains("eq")
        || s.contains("pl")
        || s.contains("playlist")
        || s.contains("panel")
        || s.contains("vis");
    action && panel
}

fn apply_event(variable: &str, event: &str) -> Value {
    json!({
        "action": "view.applyStateEvent",
        "payload": { "variable": variable, "event": event }
    })
}

fn unique_name(stem: String, used: &mut HashSet<String>) -> String {
    let name = if stem.is_empty() {
        "panel".into()
    } else {
        stem
    };
    if !used.contains(&name) {
        used.insert(name.clone());
        return name;
    }
    let mut n = 2u32;
    loop {
        let candidate = format!("{name}{n}");
        if used.insert(candidate.clone()) {
            return candidate;
        }
        n += 1;
    }
}

fn id_stem(id: &str) -> String {
    let mut s = id.to_string();
    for prefix in ["sv", "s"] {
        if s.len() > prefix.len()
            && s[..prefix.len()].eq_ignore_ascii_case(prefix)
            && s[prefix.len()..]
                .chars()
                .next()
                .map(|c| c.is_ascii_uppercase())
                .unwrap_or(false)
        {
            s = s[prefix.len()..].to_string();
            break;
        }
    }
    panel_stem(&s)
}

fn panel_stem(fn_name: &str) -> String {
    let mut s = fn_name.to_string();
    for prefix in ["Toggle", "Show", "Open", "Close", "Hide", "move", "Move"] {
        if s.len() > prefix.len() && s[..prefix.len()].eq_ignore_ascii_case(prefix) {
            s = s[prefix.len()..].to_string();
            break;
        }
    }
    for suf in ["View", "Drawer", "Window", "Panel"] {
        if s.len() > suf.len() && s[s.len() - suf.len()..].eq_ignore_ascii_case(suf) {
            s.truncate(s.len() - suf.len());
        }
    }
    let lower = s.to_ascii_lowercase();
    match lower.as_str() {
        "equalizer" | "eq" => "eq".into(),
        "playlist" | "pl" | "plist" => "playlist".into(),
        "vis" | "visualizer" | "viseffects" => "vis".into(),
        "vid" | "video" => "video".into(),
        "drawertoggle" | "drawerclose" | "drawer" => "drawer".into(),
        "" => "panel".into(),
        other => other.to_string(),
    }
}

fn pascal(s: &str) -> String {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) => c.to_ascii_uppercase().to_string() + chars.as_str(),
        None => String::new(),
    }
}

fn axis_name(axis: Axis) -> &'static str {
    match axis {
        Axis::X => "x",
        Axis::Y => "y",
    }
}

/// Nature / Optik / WMP11 `AdjustAudio` / `AdjustEQ`: interpolate bands 2–9
/// between bass (slider `bass`) and treble (slider `treble`).
///
/// Requires all eight weighted assignments. Does not match gnome's second EQ
/// (`eq2.gainLevel11+`) or arbitrary math.
fn detect_eq_linear_spread_fns(bodies: &HashMap<String, String>) -> HashSet<String> {
    const FRAGMENTS: &[&str] = &[
        "eq.gainlevel2=(8*bass.value+treble.value)/9",
        "eq.gainlevel3=(7*bass.value+2*treble.value)/9",
        "eq.gainlevel4=(6*bass.value+3*treble.value)/9",
        "eq.gainlevel5=(5*bass.value+4*treble.value)/9",
        "eq.gainlevel6=(4*bass.value+5*treble.value)/9",
        "eq.gainlevel7=(3*bass.value+6*treble.value)/9",
        "eq.gainlevel8=(2*bass.value+7*treble.value)/9",
        "eq.gainlevel9=(bass.value+8*treble.value)/9",
    ];
    let mut out = HashSet::new();
    for (name, body) in bodies {
        let compact: String = body
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect::<String>()
            .to_ascii_lowercase();
        if FRAGMENTS.iter().all(|frag| compact.contains(frag)) {
            out.insert(name.to_ascii_lowercase());
        }
    }
    out
}

fn is_eq_identity_assign(stmt: &str) -> bool {
    let compact: String = stmt
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_ascii_lowercase();
    (1..=10).any(|n| compact == format!("eq.gainlevel{n}=value"))
}

fn parse_functions(js: &str) -> HashMap<String, String> {
    let src = strip_js_comments(js);
    let mut out = HashMap::new();
    let bytes = src.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if rest_starts_with_ignore_ascii(&src[i..], "function") {
            let after = i + 8;
            let rest = src[after..].trim_start();
            let skipped = src[after..].len() - rest.len();
            let name_start = after + skipped;
            let name_end = scan_ident(&src, name_start);
            if name_end > name_start {
                let name = src[name_start..name_end].to_string();
                if let Some(brace) = src[name_end..].find('{') {
                    let start = name_end + brace;
                    if let Some(end) = matching_brace(&src, start) {
                        out.insert(name, src[start + 1..end].to_string());
                        i = end + 1;
                        continue;
                    }
                }
            }
        }
        i += 1;
    }
    out
}

fn rest_starts_with_ignore_ascii(s: &str, prefix: &str) -> bool {
    s.len() >= prefix.len() && s[..prefix.len()].eq_ignore_ascii_case(prefix)
}

fn scan_ident(src: &str, start: usize) -> usize {
    let bytes = src.as_bytes();
    if start >= bytes.len() {
        return start;
    }
    if !(bytes[start].is_ascii_alphabetic() || bytes[start] == b'_') {
        return start;
    }
    let mut i = start + 1;
    while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
        i += 1;
    }
    i
}

fn matching_brace(src: &str, open: usize) -> Option<usize> {
    let bytes = src.as_bytes();
    if open >= bytes.len() || bytes[open] != b'{' {
        return None;
    }
    let mut depth = 0i32;
    let mut i = open;
    while i < bytes.len() {
        match bytes[i] {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            b'"' | b'\'' => {
                let q = bytes[i];
                i += 1;
                while i < bytes.len() && bytes[i] != q {
                    if bytes[i] == b'\\' {
                        i += 1;
                    }
                    i += 1;
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn strip_js_comments(src: &str) -> String {
    let bytes = src.as_bytes();
    let mut out = String::with_capacity(src.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'/' {
            i += 2;
            while i < bytes.len() && bytes[i] != b'\n' {
                i += 1;
            }
            continue;
        }
        if i + 1 < bytes.len() && bytes[i] == b'/' && bytes[i + 1] == b'*' {
            i += 2;
            while i + 1 < bytes.len() && !(bytes[i] == b'*' && bytes[i + 1] == b'/') {
                i += 1;
            }
            i = (i + 2).min(bytes.len());
            continue;
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn interpret_body(
    _name: &str,
    body: &str,
    all: &HashMap<String, String>,
    ctx: &ResolveCtx<'_>,
) -> FnBody {
    let mut out = FnBody::default();
    let lower = body.to_ascii_lowercase();
    out.mentions_last_open = lower.contains("lastopen")
        || lower.contains("last_open")
        || lower.contains("ilastopendrawer")
        || lower.contains("ilastopen");

    for cap in find_moveto(body) {
        let (x, y) = resolve_xy(&cap.args, &cap.target, ctx);
        out.moves.push(MoveCall {
            target: cap.target,
            x,
            y,
        });
    }
    for (id, vis) in find_visible_assigns(body) {
        out.vis.push((id, vis));
    }
    let known: HashSet<String> = all.keys().map(|k| k.to_ascii_lowercase()).collect();
    for callee in find_callees(body) {
        if known.contains(&callee.to_ascii_lowercase()) {
            out.callees.push(callee);
        }
    }
    out
}

struct MoveCap {
    target: String,
    args: String,
}

fn find_moveto(body: &str) -> Vec<MoveCap> {
    let mut out = Vec::new();
    let lower = body.to_ascii_lowercase();
    let mut search_from = 0usize;
    while let Some(idx) = lower[search_from..].find(".moveto") {
        let abs = search_from + idx;
        let before = &body[..abs];
        let ident_start = before
            .rfind(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .map(|i| i + 1)
            .unwrap_or(0);
        let target = body[ident_start..abs].trim().to_string();
        let after_method = abs + ".moveto".len();
        let rest = body[after_method..].trim_start();
        let skipped = body[after_method..].len() - rest.len();
        let paren_at = after_method + skipped;
        if !rest.starts_with('(') {
            search_from = abs + 7;
            continue;
        }
        if let Some(args) = slice_parens(&body, paren_at) {
            out.push(MoveCap {
                target,
                args: args.clone(),
            });
            search_from = paren_at + args.len() + 2;
        } else {
            search_from = abs + 7;
        }
    }
    out
}

fn slice_parens(src: &str, open: usize) -> Option<String> {
    let bytes = src.as_bytes();
    if open >= bytes.len() || bytes[open] != b'(' {
        return None;
    }
    let mut depth = 0i32;
    let mut i = open;
    while i < bytes.len() {
        match bytes[i] {
            b'(' => depth += 1,
            b')' => {
                depth -= 1;
                if depth == 0 {
                    return Some(src[open + 1..i].to_string());
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

fn find_visible_assigns(body: &str) -> Vec<(String, bool)> {
    let mut out = Vec::new();
    let lower = body.to_ascii_lowercase();
    let mut search_from = 0usize;
    while let Some(idx) = lower[search_from..].find(".visible") {
        let abs = search_from + idx;
        let before = &body[..abs];
        let ident_start = before
            .rfind(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .map(|i| i + 1)
            .unwrap_or(0);
        let target = body[ident_start..abs].trim().to_string();
        let after = body[abs + ".visible".len()..].trim_start();
        if let Some(rest) = after.strip_prefix('=') {
            let rest = rest.trim_start();
            let lit = rest
                .split(|c: char| !(c.is_ascii_alphabetic()))
                .next()
                .unwrap_or("");
            if lit.eq_ignore_ascii_case("true") {
                out.push((target, true));
            } else if lit.eq_ignore_ascii_case("false") {
                out.push((target, false));
            }
        }
        search_from = abs + 8;
    }
    out
}

fn find_callees(body: &str) -> Vec<String> {
    const SKIP: &[&str] = &[
        "if", "else", "while", "for", "switch", "catch", "function", "return", "moveto",
    ];
    let mut out = Vec::new();
    let bytes = body.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i].is_ascii_alphabetic() || bytes[i] == b'_' {
            let start = i;
            i += 1;
            while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
                i += 1;
            }
            let name = &body[start..i];
            let rest = body[i..].trim_start();
            if rest.starts_with('(') && !SKIP.iter().any(|s| name.eq_ignore_ascii_case(s)) {
                // Skip method calls (preceded by '.')
                let prev = body[..start].chars().rev().find(|c| !c.is_whitespace());
                if prev != Some('.') {
                    out.push(name.to_string());
                }
            }
            continue;
        }
        i += 1;
    }
    out
}

fn resolve_xy(args: &str, target: &str, ctx: &ResolveCtx<'_>) -> (Coord, Coord) {
    // Ternary in either slot: contribute both branches by returning Unknown
    // unless both resolve; pair_slides needs two points, so expand:
    let parts: Vec<&str> = split_top_commas(args);
    let x_raw = parts.first().copied().unwrap_or("");
    let y_raw = parts.get(1).copied().unwrap_or("");
    (
        resolve_coord(x_raw, target, true, ctx),
        resolve_coord(y_raw, target, false, ctx),
    )
}

fn split_top_commas(args: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut start = 0usize;
    for (i, c) in args.char_indices() {
        match c {
            '(' | '?' => depth += 1,
            ')' => depth -= 1,
            ':' if depth > 0 => {}
            ',' if depth == 0 => {
                out.push(args[start..i].trim());
                start = i + 1;
            }
            _ => {}
        }
    }
    out.push(args[start..].trim());
    out
}

fn resolve_coord(raw: &str, target: &str, is_x: bool, ctx: &ResolveCtx<'_>) -> Coord {
    let e: String = raw.chars().filter(|c| !c.is_whitespace()).collect();
    if e.is_empty() {
        return Coord::Unknown;
    }
    if let Some((_, a, b)) = split_ternary(&e) {
        let ca = resolve_coord(a, target, is_x, ctx);
        let cb = resolve_coord(b, target, is_x, ctx);
        // Either branch is enough to record an endpoint; Unknown here means
        // this single call does not pin one number (the other call site will).
        return match (ca, cb) {
            (Coord::Num(_), Coord::Num(_)) => Coord::Unknown,
            (Coord::Num(n), _) | (_, Coord::Num(n)) => Coord::Num(n),
            (Coord::Keep, _) | (_, Coord::Keep) => Coord::Keep,
            _ => Coord::Unknown,
        };
    }
    let lower = e.to_ascii_lowercase();
    if lower == format!("{}.left", target.to_ascii_lowercase())
        || (is_x && lower.ends_with(".left") && lower.starts_with(&target.to_ascii_lowercase()))
    {
        return Coord::Keep;
    }
    if lower == format!("{}.top", target.to_ascii_lowercase())
        || (!is_x && lower.ends_with(".top") && lower.starts_with(&target.to_ascii_lowercase()))
    {
        return Coord::Keep;
    }
    if let Some(n) = eval_extended(&e, target, ctx) {
        return Coord::Num(n);
    }
    Coord::Unknown
}

fn split_ternary(e: &str) -> Option<(&str, &str, &str)> {
    let q = e.find('?')?;
    let rest = &e[q + 1..];
    let c = rest.find(':')?;
    Some((&e[..q], &rest[..c], &rest[c + 1..]))
}

fn eval_extended(e: &str, target: &str, ctx: &ResolveCtx<'_>) -> Option<f64> {
    let mut s = e.to_string();
    s = s.replace("view.height", &format!("{}", ctx.view_h));
    s = s.replace("view.width", &format!("{}", ctx.view_w));
    s = s.replace("view.Height", &format!("{}", ctx.view_h));
    s = s.replace("view.Width", &format!("{}", ctx.view_w));

    if let Some(node) = ctx.nodes.get(target) {
        let tl = format!("{target}.left");
        let tt = format!("{target}.top");
        let tw = format!("{target}.width");
        let th = format!("{target}.height");
        s = replace_ident_ci(&s, &tl, &format!("{}", node.x));
        s = replace_ident_ci(&s, &tt, &format!("{}", node.y));
        s = replace_ident_ci(&s, &tw, &format!("{}", node.w));
        s = replace_ident_ci(&s, &th, &format!("{}", node.h));
    }

    // Substitute const idents (longest first).
    let mut names: Vec<&String> = ctx.consts.keys().collect();
    names.sort_by_key(|n| std::cmp::Reverse(n.len()));
    for name in names {
        if let Some(v) = ctx.consts.get(name) {
            s = replace_ident_ci(&s, name, &format!("{v}"));
        }
    }

    if let Some(n) = eval_const_expr(&s, ctx.consts) {
        return Some(n);
    }
    eval_number_expr(&s)
}

fn replace_ident_ci(hay: &str, needle: &str, repl: &str) -> String {
    let lower = hay.to_ascii_lowercase();
    let n = needle.to_ascii_lowercase();
    let mut out = String::new();
    let mut i = 0usize;
    while i < hay.len() {
        if lower[i..].starts_with(&n) {
            let end = i + needle.len();
            let ok_before = i == 0
                || !hay.as_bytes()[i - 1].is_ascii_alphanumeric() && hay.as_bytes()[i - 1] != b'_';
            let ok_after = end >= hay.len()
                || (!hay.as_bytes()[end].is_ascii_alphanumeric() && hay.as_bytes()[end] != b'_');
            if ok_before && ok_after {
                out.push_str(repl);
                i = end;
                continue;
            }
        }
        out.push(hay[i..].chars().next().unwrap());
        i += hay[i..].chars().next().unwrap().len_utf8();
    }
    out
}

fn eval_number_expr(s: &str) -> Option<f64> {
    let t: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    if let Ok(n) = t.parse::<f64>() {
        return Some(n);
    }
    // a±b±c of numbers only
    let mut total = 0.0f64;
    let mut cur = String::new();
    let mut sign = 1.0f64;
    let mut started = false;
    for c in t.chars() {
        if c == '+' || c == '-' {
            if !cur.is_empty() {
                total += sign * cur.parse::<f64>().ok()?;
                cur.clear();
            } else if !started && c == '-' {
                sign = -1.0;
                started = true;
                continue;
            }
            sign = if c == '-' { -1.0 } else { 1.0 };
            started = true;
        } else {
            cur.push(c);
        }
    }
    if cur.is_empty() {
        return if started { Some(total) } else { None };
    }
    total += sign * cur.parse::<f64>().ok()?;
    Some(total)
}

pub fn apply_behavior_tree(node: &mut Value, plan: &BehaviorPlan) {
    if let Some(id) = node.get("id").and_then(|v| v.as_str()).map(str::to_string) {
        if let Some(bw) = plan.bounds_when.get(&id) {
            node["boundsWhen"] = bw.clone();
            node["transition"] = json!({ "durationMs": 120 });
        }
        if let Some(vw) = plan.visible_when.get(&id) {
            if node.get("visibleWhen").is_none() {
                node["visibleWhen"] = vw.clone();
            }
        }
    }
    if let Some(children) = node.get_mut("children").and_then(|c| c.as_array_mut()) {
        for child in children {
            apply_behavior_tree(child, plan);
        }
    }
    if let Some(els) = node
        .get_mut("presentation")
        .and_then(|p| p.get_mut("elements"))
        .and_then(|e| e.as_array_mut())
    {
        for el in els {
            apply_behavior_tree(el, plan);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wms_import::fold::parse_js_numeric_consts;
    use crate::wms_import::parse::parse_wms_xml;

    fn theme(xml: &str) -> WmsNode {
        parse_wms_xml(xml).expect("xml")
    }

    fn set_for(branches: &[Value], from: &str) -> Option<String> {
        for branch in branches {
            let matches = match branch.get("from").and_then(|f| f.as_array()) {
                Some(arr) => arr.iter().any(|v| v.as_str() == Some(from)),
                None => true,
            };
            if matches {
                return branch
                    .get("set")
                    .and_then(|s| s.as_str())
                    .map(str::to_string);
            }
        }
        None
    }

    #[test]
    fn nature_mutex_drawer_close_and_handle() {
        let xml = r##"
      <theme id="Plus! Nature">
        <view width="474" height="600">
          <subview id="svDrawer" left="82" top="157">
            <button id="btnDrawerClose" left="188" top="30" visible="false"
              image="close.bmp" onClick="DrawerClose();"/>
            <playlist id="playlist" left="32" top="56" width="156" height="120" visible="false"/>
            <subview id="svEqualizer" left="11" top="62" visible="false"/>
            <button id="btnDrawerToggle" left="0" top="0" image="h.bmp" onClick="DrawerToggle();"/>
          </subview>
          <buttongroup id="options" left="4" top="213" width="129" height="48"
            mappingImage="map.bmp" image="sheet.bmp">
            <buttonelement mappingColor="#6699FF" onClick="ToggleEqualizer();"/>
            <buttonelement mappingColor="#66CCFF" onClick="TogglePlaylist();"/>
          </buttongroup>
        </view>
      </theme>
    "##;
        let js = r#"
var iBaseOffsetTop = 111;
var iDrawerClosedPos = 157;
var iDrawerOpenedPos = 206+iBaseOffsetTop;
var iLastOpenDrawer = 1;
function DrawerToggle() {
  if (bEqualizerOpen || bPlaylistOpen) { DrawerClose(); }
  else {
    if (iLastOpenDrawer==2) { ToggleEqualizer(); }
    else { TogglePlaylist(); }
  }
}
function DrawerClose() {
  if (bEqualizerOpen) { ToggleEqualizer(); iLastOpenDrawer = 2; }
  else if (bPlaylistOpen) { TogglePlaylist(); iLastOpenDrawer = 1; }
}
function ToggleEqualizer() {
  if (bEqualizerOpen) {
    svEqualizer.visible = false;
    btnDrawerClose.visible = false;
    svDrawer.moveTo(svDrawer.left, iDrawerClosedPos, speed);
  } else {
    DrawerClose();
    svEqualizer.visible = true;
    btnDrawerClose.visible = true;
    svDrawer.moveTo(svDrawer.left, iDrawerOpenedPos, speed);
  }
}
function TogglePlaylist() {
  if (bPlaylistOpen) {
    playlist.visible = false;
    btnDrawerClose.visible = false;
    svDrawer.moveTo(svDrawer.left, iDrawerClosedPos, speed);
  } else {
    DrawerClose();
    playlist.visible = true;
    btnDrawerClose.visible = true;
    svDrawer.moveTo(svDrawer.left, iDrawerOpenedPos, speed);
  }
}
"#;
        let root = theme(xml);
        let consts = parse_js_numeric_consts(js);
        let plan = analyze_behavior(js, &consts, &root);
        assert!(
            plan.variables.contains_key("drawer"),
            "{:?}",
            plan.variables.keys()
        );
        let drawer = &plan.variables["drawer"];
        assert_eq!(drawer.default, "closed");
        assert!(drawer.on.contains_key("toggleEq"));
        assert!(drawer.on.contains_key("togglePlaylist"));
        assert!(drawer.on.contains_key("close"));
        assert!(drawer.on.contains_key("toggleHandle"));
        assert_eq!(
            set_for(&drawer.on["toggleHandle"], "eq").as_deref(),
            Some("closedEq")
        );
        assert_eq!(
            set_for(&drawer.on["toggleHandle"], "playlist").as_deref(),
            Some("closed")
        );
        assert_eq!(
            set_for(&drawer.on["toggleHandle"], "closedEq").as_deref(),
            Some("eq")
        );
        assert_eq!(
            set_for(&drawer.on["toggleHandle"], "closed").as_deref(),
            Some("playlist")
        );
        assert_eq!(
            set_for(&drawer.on["toggleEq"], "eq").as_deref(),
            Some("closedEq")
        );
        assert_eq!(
            set_for(&drawer.on["togglePlaylist"], "playlist").as_deref(),
            Some("closed")
        );
        assert_eq!(
            set_for(&drawer.on["close"], "eq").as_deref(),
            Some("closedEq")
        );
        assert_eq!(
            set_for(&drawer.on["close"], "playlist").as_deref(),
            Some("closed")
        );

        assert!(plan.effects_for_statement("DrawerClose()").is_some());
        assert!(plan.effects_for_statement("ToggleEqualizer()").is_some());
        assert!(plan.effects_for_statement("DrawerToggle()").is_some());

        let bw = &plan.bounds_when["svDrawer"];
        assert_eq!(bw["view.drawer.eq"]["y"].as_f64(), Some(317.0));
        assert_eq!(bw["view.drawer.playlist"]["y"].as_f64(), Some(317.0));
        assert_eq!(plan.visible_when["playlist"], json!("view.drawer.playlist"));
        assert_eq!(plan.visible_when["svEqualizer"], json!("view.drawer.eq"));
        let close_vis = &plan.visible_when["btnDrawerClose"];
        assert!(close_vis.get("any").is_some(), "{close_vis}");
    }

    #[test]
    fn headspace_independent_ears() {
        let xml = r##"
      <theme id="Headspace">
        <view width="760" height="394">
          <subview id="sEqEar" left="207" top="86" width="84" height="170"/>
          <subview id="sPlEar" left="277" top="86" width="87" height="170"/>
          <button id="bEq" image="eq.bmp" onClick="ToggleEqView();"/>
          <button id="bPl" image="pl.bmp" onClick="TogglePlView();"/>
        </view>
      </theme>
    "##;
        let js = r#"
var eqClosedPos = 207;
var eqOpenedPos = 0;
var plClosedPos = 277;
var plOpenedPos = 488;
var speed = 120;
function ToggleEqView() {
  if (eqIsOpen) { sEqEar.moveto(eqClosedPos, sEqEar.top, speed); }
  else { sEqEar.moveto(eqOpenedPos, sEqEar.top, speed); }
}
function TogglePlView() {
  if (plIsOpen) { sPlEar.moveto(plClosedPos, sPlEar.top, speed); }
  else { sPlEar.moveto(plOpenedPos, sPlEar.top, speed); }
}
"#;
        let root = theme(xml);
        let consts = parse_js_numeric_consts(js);
        let plan = analyze_behavior(js, &consts, &root);
        assert!(
            plan.variables.contains_key("eq"),
            "{:?}",
            plan.variables.keys()
        );
        assert!(
            plan.variables.contains_key("playlist"),
            "{:?}",
            plan.variables.keys()
        );
        assert_eq!(
            plan.bounds_when["sEqEar"]["view.eq.open"]["x"].as_f64(),
            Some(0.0)
        );
        assert_eq!(
            plan.bounds_when["sPlEar"]["view.playlist.open"]["x"].as_f64(),
            Some(488.0)
        );
        assert_eq!(
            plan.effects_for_statement("ToggleEqView()").unwrap()[0]["payload"]["event"],
            "toggle"
        );
    }

    #[test]
    fn visibility_toggle_without_motion() {
        let xml = r##"
      <theme id="Jaws">
        <view width="400" height="300">
          <subview id="eqPanel" left="0" top="0" visible="false"/>
          <button id="bEq" image="eq.bmp" onClick="showEQ();"/>
        </view>
      </theme>
    "##;
        let js = r#"
function showEQ() {
  if (eqIsOpen) { eqPanel.visible = false; }
  else { eqPanel.visible = true; }
}
"#;
        let root = theme(xml);
        let plan = analyze_behavior(js, &HashMap::new(), &root);
        assert!(
            plan.variables.contains_key("eq"),
            "{:?}",
            plan.variables.keys()
        );
        assert_eq!(plan.visible_when["eqPanel"], json!("view.eq.open"));
        assert!(plan.effects_for_statement("showEQ()").is_some());
    }

    #[test]
    fn skips_display_and_video_mode_helpers() {
        let xml = r##"
      <theme id="Plus! Nature">
        <view width="474" height="600">
          <subview id="btnAlbumArt" left="0" top="0" visible="false"/>
          <button id="bVis" image="v.bmp" onClick="DisplayVisualizer();"/>
        </view>
      </theme>
    "##;
        let js = r#"
function DisplayVisualizer() {
  btnAlbumArt.visible = false;
}
"#;
        let root = theme(xml);
        let plan = analyze_behavior(js, &HashMap::new(), &root);
        assert!(plan.variables.is_empty(), "{:?}", plan.variables.keys());
    }

    #[test]
    fn caps_too_many_sliding_ids() {
        let mut xml = String::from(r##"<theme id="Busy"><view width="800" height="600">"##);
        let mut js = String::new();
        for i in 1..=7 {
            xml.push_str(&format!(
                r#"<subview id="d{i}" left="0" top="0"/><button id="b{i}" image="x.bmp" onClick="toggle{i}();"/>"#
            ));
            js.push_str(&format!(
                "function toggle{i}() {{ d{i}.moveTo(0, 0, 10); d{i}.moveTo(0, 40, 10); }}\n"
            ));
        }
        xml.push_str("</view></theme>");
        let root = theme(&xml);
        let plan = analyze_behavior(&js, &HashMap::new(), &root);
        assert!(plan.variables.is_empty());
        assert!(plan
            .notes
            .iter()
            .any(|n| n.detail.contains("skipped drawer")));
    }

    #[test]
    fn ignores_move_not_reached_from_onclick() {
        let xml = r##"
      <theme id="Logo">
        <view width="400" height="300">
          <subview id="logo" left="10" top="10"/>
          <button id="quit" image="q.bmp" onClick="view.close();"/>
        </view>
      </theme>
    "##;
        let js = r#"
function Init() {
  logo.moveTo(10, 10, 0);
  logo.moveTo(200, 10, 800);
}
"#;
        let root = theme(xml);
        let plan = analyze_behavior(js, &HashMap::new(), &root);
        assert!(plan.variables.is_empty());
    }

    #[test]
    fn parse_fn_bodies() {
        let fns = parse_functions("function Foo() { bar(); } function Baz(x){ return; }");
        assert!(fns.contains_key("Foo"));
        assert!(fns.contains_key("Baz"));
    }

    fn empty_theme() -> WmsNode {
        theme(
            r##"
      <theme id="demo">
        <view width="100" height="100" />
      </theme>
    "##,
        )
    }

    const NATURE_ADJUST_AUDIO: &str = r#"
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

    #[test]
    fn detects_nature_adjust_audio() {
        let plan = analyze_behavior(NATURE_ADJUST_AUDIO, &HashMap::new(), &empty_theme());
        assert!(plan.eq_linear_spread_fns.contains("adjustaudio"));
        assert!(plan.is_eq_linear_spread_onchange("AdjustAudio(); eq.gainLevel1 = value;"));
        assert!(plan.is_eq_linear_spread_onchange("AdjustAudio();"));
        assert!(!plan.is_eq_linear_spread_onchange("eq.gainLevel1 = value;"));
        assert!(!plan.is_eq_linear_spread_onchange("AdjustAudio(); somethingElse();"));
    }

    #[test]
    fn detects_wmp11_adjust_audio_with_endpoint_writes() {
        let js = r#"
function AdjustAudio() {
  eq.gainLevel1 = bass.value;
  eq.gainLevel10 = treble.value;
  eq.gainLevel2 = (8*bass.value + treble.value)/9;
  eq.gainLevel3 = (7*bass.value + 2*treble.value)/9;
  eq.gainLevel4 = (6*bass.value + 3*treble.value)/9;
  eq.gainLevel5 = (5*bass.value + 4*treble.value)/9;
  eq.gainLevel6 = (4*bass.value + 5*treble.value)/9;
  eq.gainLevel7 = (3*bass.value + 6*treble.value)/9;
  eq.gainLevel8 = (2*bass.value + 7*treble.value)/9;
  eq.gainLevel9 = (bass.value + 8*treble.value)/9;
}
"#;
        let plan = analyze_behavior(js, &HashMap::new(), &empty_theme());
        assert!(plan.eq_linear_spread_fns.contains("adjustaudio"));
    }

    #[test]
    fn ignores_gnome_second_eq_and_partial_formula() {
        let gnome = r#"
function AdjustAudio2() {
  eq2.gainLevel12 = (8*bass2.value + treble2.value)/9;
  eq2.gainLevel13 = (7*bass2.value + 2*treble2.value)/9;
  eq2.gainLevel14 = (6*bass2.value + 3*treble2.value)/9;
  eq2.gainLevel15 = (5*bass2.value + 4*treble2.value)/9;
  eq2.gainLevel16 = (4*bass2.value + 5*treble2.value)/9;
  eq2.gainLevel17 = (3*bass2.value + 6*treble2.value)/9;
  eq2.gainLevel18 = (2*bass2.value + 7*treble2.value)/9;
  eq2.gainLevel19 = (bass2.value + 8*treble2.value)/9;
}
"#;
        let plan = analyze_behavior(gnome, &HashMap::new(), &empty_theme());
        assert!(plan.eq_linear_spread_fns.is_empty());

        let partial = r#"
function AdjustAudio() {
  eq.gainLevel2 = (8*bass.value + treble.value)/9;
  eq.gainLevel9 = (bass.value + 8*treble.value)/9;
}
"#;
        let plan = analyze_behavior(partial, &HashMap::new(), &empty_theme());
        assert!(plan.eq_linear_spread_fns.is_empty());
    }
}
