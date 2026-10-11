//! S3-compatible storage stub (Phase 1 — not wired yet).

use anyhow::{bail, Result};
use async_trait::async_trait;

use super::{DownloadTarget, ObjectStorage};

/// Placeholder until Phase 1+ pluggable S3 lands for hosted deploys.
#[derive(Debug, Default)]
pub struct S3Storage;

#[async_trait]
impl ObjectStorage for S3Storage {
    async fn put(&self, _key: &str, _data: &[u8]) -> Result<()> {
        bail!("S3 storage backend is not implemented yet; set STORAGE_BACKEND=local")
    }

    async fn get_download_url(&self, _key: &str) -> Result<DownloadTarget> {
        bail!("S3 storage backend is not implemented yet; set STORAGE_BACKEND=local")
    }

    async fn delete(&self, _key: &str) -> Result<()> {
        bail!("S3 storage backend is not implemented yet; set STORAGE_BACKEND=local")
    }
}
