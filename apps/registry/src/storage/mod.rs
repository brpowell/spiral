//! Object storage backends.

mod local;
mod s3;

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Result;
use async_trait::async_trait;

pub use local::LocalDiskStorage;
pub use s3::S3Storage;

use crate::config::StorageConfig;

/// Where a download should be served from.
#[derive(Debug, Clone)]
pub enum DownloadTarget {
    /// Stream bytes from a local filesystem path.
    LocalPath(PathBuf),
    /// HTTP redirect (signed S3 URL, CDN, etc.).
    Redirect(String),
}

#[async_trait]
pub trait ObjectStorage: Send + Sync {
    async fn put(&self, key: &str, data: &[u8]) -> Result<()>;
    async fn get_download_url(&self, key: &str) -> Result<DownloadTarget>;
    /// Read a whole object. Used for small objects the registry serves itself (previews).
    /// A missing object fails with a message starting `object not found:`.
    async fn get(&self, key: &str) -> Result<Vec<u8>>;
    async fn delete(&self, key: &str) -> Result<()>;
}

pub fn build_storage(config: &StorageConfig) -> Result<Arc<dyn ObjectStorage>> {
    match config {
        StorageConfig::Local { root } => Ok(Arc::new(LocalDiskStorage::new(root.clone())?)),
        StorageConfig::S3 => Ok(Arc::new(S3Storage)),
    }
}
