# mp3lame-sys (Spiral patch)

Same FFI as [mp3lame-sys 0.1.11](https://crates.io/crates/mp3lame-sys). The crates.io crate **statically compiles** vendored LAME; this path crate does not.

`[patch.crates-io]` redirects `mp3lame-sys` here so `mp3lame-encoder` uses this crate. The shared library is fetched from `spiral-powered/native-lame` (`npm run bootstrap`) and linked from `src-tauri/build.rs`. Decoder / mpg FFI is omitted (GPL).
