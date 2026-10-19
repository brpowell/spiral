use std::path::Path;

fn main() {
    // Re-embed migrations and the admin bundle when either changes. rust-embed only tracks the
    // files it saw at compile time, so a rebuilt bundle with new hashed names needs this.
    println!("cargo:rerun-if-changed=migrations");
    println!("cargo:rerun-if-changed=admin/dist");

    // The admin panel is embedded at compile time but is a build artifact, not committed.
    if !Path::new("admin/dist/index.html").is_file() {
        panic!(
            "the admin panel bundle is missing (apps/registry/admin/dist/index.html). \
             Build it first: cd apps/registry/admin && npm ci && npm run build"
        );
    }
}
