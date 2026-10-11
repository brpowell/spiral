use std::collections::HashMap;

use crate::wms_import::parse::{walk_wms, WmsNode};

/// Parse simple `var name = number` / `number+ident` assignments. No eval.
pub fn parse_js_numeric_consts(source: &str) -> HashMap<String, f64> {
    let mut values = HashMap::new();
    let assignments: Vec<(String, String)> = VarLineIter::new(source).collect();

    let mut changed = true;
    let mut guard = 0u32;
    while changed && guard < 32 {
        changed = false;
        guard += 1;
        for (name, expr) in &assignments {
            if let Some(resolved) = eval_const_expr(expr, &values) {
                let prev = values.get(name).copied();
                if prev != Some(resolved) {
                    values.insert(name.clone(), resolved);
                    changed = true;
                }
            }
        }
    }
    values
}

struct VarLineIter<'a> {
    rest: &'a str,
}

impl<'a> VarLineIter<'a> {
    fn new(source: &'a str) -> Self {
        Self { rest: source }
    }
}

impl Iterator for VarLineIter<'_> {
    type Item = (String, String);

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            let idx = self.rest.find("var ")?;
            let after = &self.rest[idx + 4..];
            // find end of line or next
            let end = after.find('\n').unwrap_or(after.len());
            let line = after[..end].trim();
            self.rest = &after[end..];

            let Some((name, expr)) = line.split_once('=') else {
                continue;
            };
            let name = name.trim();
            if !is_ident(name) {
                continue;
            }
            let mut expr = expr.trim();
            if let Some(s) = expr.strip_suffix(';') {
                expr = s.trim();
            }
            if expr.is_empty() {
                continue;
            }
            return Some((name.to_string(), expr.to_string()));
        }
    }
}

pub(crate) fn is_ident(s: &str) -> bool {
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_alphabetic() || c == '_' => {}
        _ => return false,
    }
    chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

pub(crate) fn eval_const_expr(expr: &str, values: &HashMap<String, f64>) -> Option<f64> {
    let trimmed: String = expr.chars().filter(|c| !c.is_whitespace()).collect();
    if is_number(&trimmed) {
        return trimmed.parse().ok();
    }
    if let Some(v) = values.get(&trimmed) {
        return Some(*v);
    }

    // number [+-] ident
    if let Some((left, op, ident)) = split_sum_number_first(&trimmed) {
        let left_n: f64 = left.parse().ok()?;
        let ident_val = *values.get(ident)?;
        return Some(if op == '-' {
            left_n - ident_val
        } else {
            left_n + ident_val
        });
    }
    // ident [+-] number
    if let Some((ident, op, right)) = split_sum_ident_first(&trimmed) {
        let ident_val = *values.get(ident)?;
        let right_n: f64 = right.parse().ok()?;
        return Some(if op == '-' {
            ident_val - right_n
        } else {
            ident_val + right_n
        });
    }
    None
}

fn is_number(s: &str) -> bool {
    if s.is_empty() {
        return false;
    }
    let mut chars = s.chars().peekable();
    if matches!(chars.peek(), Some('-')) {
        chars.next();
    }
    let mut saw_digit = false;
    let mut saw_dot = false;
    for c in chars {
        if c.is_ascii_digit() {
            saw_digit = true;
        } else if c == '.' && !saw_dot {
            saw_dot = true;
        } else {
            return false;
        }
    }
    saw_digit
}

fn split_sum_number_first(s: &str) -> Option<(&str, char, &str)> {
    // (-?\d+(?:\.\d+)?) [+-] ident
    let mut i = 0usize;
    let bytes = s.as_bytes();
    if i < bytes.len() && bytes[i] == b'-' {
        i += 1;
    }
    let start_digits = i;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        i += 1;
    }
    if i == start_digits {
        return None;
    }
    if i < bytes.len() && bytes[i] == b'.' {
        i += 1;
        let frac_start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i == frac_start {
            return None;
        }
    }
    if i >= bytes.len() {
        return None;
    }
    let op = bytes[i] as char;
    if op != '+' && op != '-' {
        return None;
    }
    let left = &s[..i];
    let ident = &s[i + 1..];
    if !is_ident(ident) {
        return None;
    }
    Some((left, op, ident))
}

fn split_sum_ident_first(s: &str) -> Option<(&str, char, &str)> {
    let mut i = 0usize;
    let bytes = s.as_bytes();
    if i >= bytes.len() {
        return None;
    }
    if !(bytes[i].is_ascii_alphabetic() || bytes[i] == b'_') {
        return None;
    }
    i += 1;
    while i < bytes.len() && (bytes[i].is_ascii_alphanumeric() || bytes[i] == b'_') {
        i += 1;
    }
    if i >= bytes.len() {
        return None;
    }
    let op = bytes[i] as char;
    if op != '+' && op != '-' {
        return None;
    }
    let ident = &s[..i];
    let right = &s[i + 1..];
    if !is_number(right) {
        return None;
    }
    Some((ident, op, right))
}

pub struct LeftoverJscript {
    pub node_id: Option<String>,
    pub attr: String,
    pub value: String,
}

pub fn fold_jscript_attrs(
    root: &mut WmsNode,
    consts: &HashMap<String, f64>,
) -> Vec<LeftoverJscript> {
    let mut leftover = Vec::new();
    walk_wms(root, &mut |node| {
        let keys: Vec<String> = node.attrs.keys().cloned().collect();
        for attr in keys {
            let Some(value) = node.attrs.get(&attr).cloned() else {
                continue;
            };
            if !value.to_ascii_lowercase().starts_with("jscript:") {
                continue;
            }
            let ident = parse_jscript_ident(&value);
            let resolved = ident.and_then(|id| consts.get(id).copied());
            if let Some(n) = resolved {
                // Whole numbers as integers so skin.json matches schema i32 fields.
                let s = if n.fract() == 0.0 {
                    format!("{}", n as i64)
                } else {
                    format!("{n}")
                };
                node.attrs.insert(attr, s);
            } else {
                leftover.push(LeftoverJscript {
                    node_id: node.attrs.get("id").cloned(),
                    attr,
                    value,
                });
            }
        }
    });
    leftover
}

fn parse_jscript_ident(value: &str) -> Option<&str> {
    let rest = value.trim();
    let lower = rest.to_ascii_lowercase();
    if !lower.starts_with("jscript:") {
        return None;
    }
    let after = rest[8..].trim();
    if is_ident(after) {
        Some(after)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn folds_number_plus_ident_assignments() {
        let js = r#"
var iBaseOffsetTop			= 111;
var iDrawerClosedPos		= 157;
var iVolumeSmallTop			= 75+iBaseOffsetTop;
var iVideoSmallLeft			= 91;
"#;
        let consts = parse_js_numeric_consts(js);
        assert_eq!(consts.get("iBaseOffsetTop"), Some(&111.0));
        assert_eq!(consts.get("iDrawerClosedPos"), Some(&157.0));
        assert_eq!(consts.get("iVolumeSmallTop"), Some(&186.0));
        assert_eq!(consts.get("iVideoSmallLeft"), Some(&91.0));
    }
}
