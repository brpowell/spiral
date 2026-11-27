use serde::{Deserialize, Serialize};
use std::fmt;

/// A host library's identity: the UUID minted once in its database
/// (`library_meta.library_id`). It travels with backups and copies, so a
/// different id means a different library, not a restored one.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct LibraryId(String);

impl LibraryId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for LibraryId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A position in a library's change feed. Every logged catalog change takes
/// the next rev, starting from 0 (a library with no logged changes).
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct Rev(pub u64);

impl Rev {
    pub const ZERO: Rev = Rev(0);
}

impl fmt::Display for Rev {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}
