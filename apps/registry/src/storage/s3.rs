//! S3-compatible object storage: AWS S3, Cloudflare R2, Tigris, MinIO and the like.
//!
//! Downloads are served by redirecting to a short-lived presigned URL, so file bytes never flow
//! through the registry. Previews go through [`ObjectStorage::get`] instead (the desktop client
//! does not follow redirects for them). Credentials come from the standard AWS environment
//! (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`) or profile.

use anyhow::{anyhow, bail, Context, Result};
use async_trait::async_trait;
use s3::creds::Credentials;
use s3::error::S3Error;
use s3::{Bucket, Region};

use super::{DownloadTarget, ObjectStorage};
use crate::config::S3Config;

pub struct S3Storage {
    bucket: Box<Bucket>,
    key_prefix: String,
    presign_ttl_secs: u32,
}

impl S3Storage {
    pub fn new(config: &S3Config) -> Result<Self> {
        let region = match &config.endpoint {
            Some(endpoint) => Region::Custom {
                region: config.region.clone(),
                endpoint: endpoint.clone(),
            },
            None => config
                .region
                .parse::<Region>()
                .with_context(|| format!("unknown S3_REGION {:?}", config.region))?,
        };
        let credentials = Credentials::default()
            .context("S3 credentials (set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY)")?;
        let mut bucket = Bucket::new(&config.bucket, region, credentials)
            .with_context(|| format!("open S3 bucket {:?}", config.bucket))?;
        if config.path_style {
            bucket = bucket.with_path_style();
        }
        Ok(Self {
            bucket,
            key_prefix: config.key_prefix.clone(),
            presign_ttl_secs: config.presign_ttl_secs,
        })
    }

    /// Object path: the configured prefix plus the registry's storage key, with the key checked
    /// the same way the local backend checks it.
    fn path(&self, key: &str) -> Result<String> {
        if key.is_empty()
            || key.contains('\0')
            || key
                .split('/')
                .any(|seg| seg.is_empty() || seg == "." || seg == "..")
        {
            bail!("invalid storage key: {key:?}");
        }
        Ok(format!("/{}{}", self.key_prefix, key))
    }
}

/// A missing object, as reported for GET and DELETE (`fail-on-err` turns the status into an error).
fn is_not_found(err: &S3Error) -> bool {
    matches!(err, S3Error::HttpFailWithBody(404, _))
}

fn not_found(key: &str) -> anyhow::Error {
    anyhow!("object not found: {key}")
}

#[async_trait]
impl ObjectStorage for S3Storage {
    async fn put(&self, key: &str, data: &[u8]) -> Result<()> {
        let path = self.path(key)?;
        self.bucket
            .put_object(&path, data)
            .await
            .with_context(|| format!("put {key} to S3"))?;
        Ok(())
    }

    async fn get_download_url(&self, key: &str) -> Result<DownloadTarget> {
        let path = self.path(key)?;
        // Signing never touches the network, so check the object exists first: a missing blob
        // must be a 404 here, not a redirect to an error page.
        match self.bucket.head_object(&path).await {
            Ok((_, status)) if (200..300).contains(&status) => {}
            Ok((_, 404)) => return Err(not_found(key)),
            // Without s3:ListBucket, S3 answers HEAD for a missing key with 403.
            Ok((_, 403)) => {
                tracing::warn!(key, "S3 HEAD returned 403; treating the object as missing");
                return Err(not_found(key));
            }
            Ok((_, status)) => bail!("head {key} in S3 returned HTTP {status}"),
            Err(e) if is_not_found(&e) => return Err(not_found(key)),
            Err(e) => return Err(anyhow::Error::new(e).context(format!("head {key} in S3"))),
        }
        let url = self
            .bucket
            .presign_get(&path, self.presign_ttl_secs, None)
            .await
            .with_context(|| format!("presign {key}"))?;
        Ok(DownloadTarget::Redirect(url))
    }

    async fn get(&self, key: &str) -> Result<Vec<u8>> {
        let path = self.path(key)?;
        match self.bucket.get_object(&path).await {
            Ok(response) => Ok(response.to_vec()),
            Err(e) if is_not_found(&e) => Err(not_found(key)),
            Err(e) => Err(anyhow::Error::new(e).context(format!("get {key} from S3"))),
        }
    }

    async fn delete(&self, key: &str) -> Result<()> {
        let path = self.path(key)?;
        match self.bucket.delete_object(&path).await {
            Ok(_) => Ok(()),
            // Deleting what is already gone is fine, as with the local backend.
            Err(e) if is_not_found(&e) => Ok(()),
            Err(e) => Err(anyhow::Error::new(e).context(format!("delete {key} from S3"))),
        }
    }
}
