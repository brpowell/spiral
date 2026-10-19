//! S3 backend against a real S3-compatible server (S3Mock in CI). Runs when `TEST_S3_ENDPOINT`
//! is set; credentials come from `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, the bucket from
//! `TEST_S3_BUCKET` (default `spk-test`, created if missing).

use std::time::{SystemTime, UNIX_EPOCH};

use s3::creds::Credentials;
use s3::{Bucket, BucketConfiguration, Region};
use spk_registry::config::S3Config;
use spk_registry::storage::{DownloadTarget, ObjectStorage, S3Storage};

fn unique(label: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    format!("{label}-{nanos}")
}

fn config(endpoint: &str, bucket: &str, prefix: &str) -> S3Config {
    S3Config {
        bucket: bucket.into(),
        region: "us-east-1".into(),
        endpoint: Some(endpoint.into()),
        key_prefix: prefix.into(),
        path_style: true,
        presign_ttl_secs: 60,
    }
}

async fn ensure_bucket(endpoint: &str, bucket: &str) {
    let region = Region::Custom {
        region: "us-east-1".into(),
        endpoint: endpoint.into(),
    };
    let creds = Credentials::default().expect("AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY");
    // Already existing is fine.
    let _ =
        Bucket::create_with_path_style(bucket, region, creds, BucketConfiguration::default()).await;
}

fn env() -> Option<(String, String)> {
    let endpoint = std::env::var("TEST_S3_ENDPOINT")
        .ok()
        .filter(|v| !v.trim().is_empty())?;
    let bucket = std::env::var("TEST_S3_BUCKET").unwrap_or_else(|_| "spk-test".into());
    Some((endpoint, bucket))
}

#[tokio::test]
async fn s3_round_trip_presign_and_missing_objects() {
    let Some((endpoint, bucket)) = env() else {
        eprintln!("skipped: set TEST_S3_ENDPOINT to run against an S3-compatible server");
        return;
    };
    ensure_bucket(&endpoint, &bucket).await;
    let prefix = format!("{}/", unique("run"));
    let storage = S3Storage::new(&config(&endpoint, &bucket, &prefix)).expect("storage");
    let key = "spiral/theme/noir/1.0.0/item.spk";
    let data = b"PK\x03\x04fake-spk-bytes".to_vec();

    // Missing objects look the same as on the local backend.
    for result in [
        storage.get(key).await.map(|_| ()),
        storage.get_download_url(key).await.map(|_| ()),
    ] {
        let err = result.unwrap_err();
        assert!(
            err.to_string().starts_with("object not found:"),
            "unexpected error: {err:#}"
        );
    }
    storage
        .delete(key)
        .await
        .expect("deleting a missing object is fine");

    storage.put(key, &data).await.expect("put");
    assert_eq!(storage.get(key).await.expect("get"), data);

    // Downloads redirect to a presigned URL that serves the bytes with no registry in between.
    let DownloadTarget::Redirect(url) = storage.get_download_url(key).await.expect("presign")
    else {
        panic!("S3 downloads must be redirects");
    };
    let fetched = reqwest::get(&url).await.expect("fetch presigned URL");
    assert!(fetched.status().is_success(), "{}", fetched.status());
    assert_eq!(fetched.bytes().await.unwrap().to_vec(), data);

    // The key prefix is applied to the object path, so another prefix does not see it.
    let elsewhere = S3Storage::new(&config(
        &endpoint,
        &bucket,
        &format!("{}/", unique("other")),
    ))
    .unwrap();
    assert!(elsewhere.get(key).await.is_err());

    storage.delete(key).await.expect("delete");
    assert!(storage
        .get(key)
        .await
        .unwrap_err()
        .to_string()
        .starts_with("object not found:"));
}

#[tokio::test]
async fn s3_rejects_keys_that_could_escape_the_prefix() {
    let Some((endpoint, bucket)) = env() else {
        return;
    };
    let storage = S3Storage::new(&config(&endpoint, &bucket, "p/")).unwrap();
    for bad in ["", "../x", "a/../b", "a//b", "a/./b"] {
        assert!(storage.put(bad, b"x").await.is_err(), "{bad:?}");
        assert!(storage.get(bad).await.is_err(), "{bad:?}");
    }
}
