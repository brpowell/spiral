use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ReportKind {
    MissingFile,
    Jscript,
    Hidden,
    UnmappedElement,
    UnmappedAction,
    UnmappedAttr,
    BuiltinImage,
    Info,
}

impl ReportKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::MissingFile => "missing-file",
            Self::Jscript => "jscript",
            Self::Hidden => "hidden",
            Self::UnmappedElement => "unmapped-element",
            Self::UnmappedAction => "unmapped-action",
            Self::UnmappedAttr => "unmapped-attr",
            Self::BuiltinImage => "builtin-image",
            Self::Info => "info",
        }
    }
}

#[derive(Debug, Clone)]
pub struct ReportItem {
    pub kind: ReportKind,
    pub detail: String,
    pub node_id: Option<String>,
    pub attr: Option<String>,
}

#[derive(Debug, Default)]
pub struct GapReport {
    pub items: Vec<ReportItem>,
}

impl GapReport {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(
        &mut self,
        kind: ReportKind,
        detail: impl Into<String>,
        node_id: Option<&str>,
        attr: Option<&str>,
    ) {
        self.items.push(ReportItem {
            kind,
            detail: detail.into(),
            node_id: node_id.map(str::to_string),
            attr: attr.map(str::to_string),
        });
    }

    pub fn to_markdown(&self) -> String {
        let mut lines = vec![
            "# WMS import report".to_string(),
            String::new(),
            "Unmapped attributes, leftover JScript, starts-hidden nodes, and missing files."
                .to_string(),
            "The importer is a scaffold — finish behavior by hand.".to_string(),
            String::new(),
        ];
        if self.items.is_empty() {
            lines.push("_No gaps recorded._".to_string());
            lines.push(String::new());
            return lines.join("\n");
        }

        let mut groups: BTreeMap<ReportKind, Vec<&ReportItem>> = BTreeMap::new();
        for item in &self.items {
            groups.entry(item.kind).or_default().push(item);
        }

        let order = [
            ReportKind::MissingFile,
            ReportKind::Jscript,
            ReportKind::Hidden,
            ReportKind::UnmappedElement,
            ReportKind::UnmappedAction,
            ReportKind::UnmappedAttr,
            ReportKind::BuiltinImage,
            ReportKind::Info,
        ];
        for kind in order {
            let Some(list) = groups.get(&kind) else {
                continue;
            };
            if list.is_empty() {
                continue;
            }
            lines.push(format!("## {}", kind.as_str()));
            lines.push(String::new());
            if kind == ReportKind::Jscript {
                append_grouped_jscript(&mut lines, list);
            } else {
                for item in list {
                    lines.push(format_item_line(item));
                }
            }
            lines.push(String::new());
        }
        lines.join("\n")
    }
}

fn format_item_line(item: &ReportItem) -> String {
    let loc = item_loc(item);
    if loc.is_empty() {
        format!("- {}", item.detail)
    } else {
        format!("- **{loc}** — {}", item.detail)
    }
}

fn item_loc(item: &ReportItem) -> String {
    [item.node_id.as_deref(), item.attr.as_deref()]
        .into_iter()
        .flatten()
        .collect::<Vec<_>>()
        .join(" ")
}

fn append_grouped_jscript(lines: &mut Vec<String>, items: &[&ReportItem]) {
    let mut by_expr: BTreeMap<&str, Vec<&ReportItem>> = BTreeMap::new();
    for item in items {
        by_expr.entry(item.detail.as_str()).or_default().push(*item);
    }
    for (expr, group) in by_expr {
        if group.len() == 1 {
            lines.push(format_item_line(group[0]));
            continue;
        }
        let locs: Vec<String> = group
            .iter()
            .map(|item| {
                let loc = item_loc(item);
                if loc.is_empty() {
                    "(unnamed)".to_string()
                } else {
                    format!("**{loc}**")
                }
            })
            .collect();
        lines.push(format!("- `{expr}` ×{} — {}", group.len(), locs.join(", ")));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn groups_repeated_jscript_expressions() {
        let mut report = GapReport::new();
        report.add(
            ReportKind::Jscript,
            "jscript:cPos.left",
            Some("thumb1"),
            Some("left"),
        );
        report.add(
            ReportKind::Jscript,
            "jscript:cPos.left",
            Some("thumb2"),
            Some("left"),
        );
        report.add(
            ReportKind::Jscript,
            "jscript:eq.wowLevel=value",
            Some("wowEffect"),
            Some("onpositionchange"),
        );
        let md = report.to_markdown();
        assert!(md.contains("- `jscript:cPos.left` ×2 — **thumb1 left**, **thumb2 left**"));
        assert!(md.contains("**wowEffect onpositionchange** — jscript:eq.wowLevel=value"));
        assert!(!md.contains("**thumb1 left** — jscript:cPos.left"));
    }
}
