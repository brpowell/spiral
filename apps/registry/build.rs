// Re-embed migrations when a migration file is added or edited.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
