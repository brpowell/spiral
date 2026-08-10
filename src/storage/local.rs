use std::path::{Path, PathBuf};

use anyhow::{bail, Context, Result};
use async_trait::async_trait;
use tokio::fs;

use super::{DownloadTarget, ObjectStorage};

#[derive(Debug, Clone)]
pub struct LocalDiskStorage {
    root: PathBuf,
}

impl LocalDiskStorage {
    pub fn new(root: PathBuf) -> Result<Self> {
        std::fs::create_dir_all(&root)
            .with_context(|| format!("create local storage root {}", root.display()))?;
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn resolve_key(&self, key: &str) -> Result<PathBuf> {
        if key.is_empty()
            || key.contains('\0')
            || key.split('/').any(|seg| seg.is_empty() || seg == "." || seg == "..")
        {
            bail!("invalid storage key: {key:?}");
        }
        let path = self.root.join(key);
        // Defense in depth: resolved path must stay under root.
        let root = self
            .root
            .canonicalize()
            .unwrap_or_else(|_| self.root.clone());
        if let Ok(canon) = path.parent().unwrap_or(&path).canonicalize() {
            if !canon.starts_with(&root) {
                bail!("storage key escapes root: {key:?}");
            }
        }
        Ok(path)
    }
}

#[async_trait]
impl ObjectStorage for LocalDiskStorage {
    async fn put(&self, key: &str, data: &[u8]) -> Result<()> {
        let path = self.resolve_key(key)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .await
                .with_context(|| format!("create {}", parent.display()))?;
        }
        fs::write(&path, data)
            .await
            .with_context(|| format!("write {}", path.display()))?;
        Ok(())
    }

    async fn get_download_url(&self, key: &str) -> Result<DownloadTarget> {
        let path = self.resolve_key(key)?;
        if !path.is_file() {
            bail!("object not found: {key}");
        }
        Ok(DownloadTarget::LocalPath(path))
    }

    async fn delete(&self, key: &str) -> Result<()> {
        let path = self.resolve_key(key)?;
        if path.is_file() {
            fs::remove_file(&path)
                .await
                .with_context(|| format!("delete {}", path.display()))?;
        }
        Ok(())
    }
}
