# Changelog

## [0.4.0](https://github.com/brpowell/spiral/compare/desktop-v0.3.0...desktop-v0.4.0) (2026-10-16)


### Features

* **desktop:** play all audio through a native output ([#31](https://github.com/brpowell/spiral/issues/31)) ([5744dc4](https://github.com/brpowell/spiral/commit/5744dc4208821cf1bebe812cad032ab340cdd974))


### Bug Fixes

* delete playlist body not appearing ([#35](https://github.com/brpowell/spiral/issues/35)) ([52c64c3](https://github.com/brpowell/spiral/commit/52c64c3dca0444af7daeea99187e8eed802219a0))
* **desktop:** blend Windows/Linux titlebar with library header ([#34](https://github.com/brpowell/spiral/issues/34)) ([f8cd6f6](https://github.com/brpowell/spiral/commit/f8cd6f619b4f7cdb328bb5e3df02d4a84908fe6e))
* **desktop:** open about window without freezing UI on Windows ([#32](https://github.com/brpowell/spiral/issues/32)) ([313716b](https://github.com/brpowell/spiral/commit/313716b0e3f4d28b27447a6eaa30ead7247b9a7c))

## [0.3.0](https://github.com/brpowell/spiral/compare/desktop-v0.2.4...desktop-v0.3.0) (2026-10-13)


### Features

* **desktop:** add loading skeletons and caching to registry browsing ([#22](https://github.com/brpowell/spiral/issues/22)) ([27753c2](https://github.com/brpowell/spiral/commit/27753c2ad838ff2ee5dce948e9ce002a4256b6cb))
* **desktop:** add Sprig Dark and Strawberry builtin themes ([#25](https://github.com/brpowell/spiral/issues/25)) ([2832b50](https://github.com/brpowell/spiral/commit/2832b503527dff655456ae2dcde32aa17ff46bbc))
* **desktop:** build and release Windows ARM64, universal macOS, .deb and .rpm ([#19](https://github.com/brpowell/spiral/issues/19)) ([5e6f7d6](https://github.com/brpowell/spiral/commit/5e6f7d678ee5fbc6b41bcd8e815a967eda216746))
* **desktop:** bundle full third-party license texts and show them in About ([#17](https://github.com/brpowell/spiral/issues/17)) ([94df5f9](https://github.com/brpowell/spiral/commit/94df5f9683588c61f4abe418a99613ba786a3a17))
* **desktop:** replace the Tauri icon with the Spiral brand kit ([#20](https://github.com/brpowell/spiral/issues/20)) ([ab5239f](https://github.com/brpowell/spiral/commit/ab5239fcf28c24ffdc14337f4d60092439adb062))


### Bug Fixes

* **deps:** resolve source-map-js denial-of-service advisory ([#23](https://github.com/brpowell/spiral/issues/23)) ([6f15914](https://github.com/brpowell/spiral/commit/6f1591467de7b9078080b304cdbadc26882cb2e0))
* **desktop:** decode the GIF NETSCAPE loop count ([#18](https://github.com/brpowell/spiral/issues/18)) ([e82f5b1](https://github.com/brpowell/spiral/commit/e82f5b1288978bbc15b807b626b989f250949157))
* **desktop:** track synced playhead in skin window seek bar ([#24](https://github.com/brpowell/spiral/issues/24)) ([4e70180](https://github.com/brpowell/spiral/commit/4e70180f8a11e689f90a6a5a1cf68685758e5336))


### Performance Improvements

* **desktop:** reveal the main window fully drawn and add a track list skeleton ([#10](https://github.com/brpowell/spiral/issues/10)) ([3db4114](https://github.com/brpowell/spiral/commit/3db4114f62675adc73b81572631e1af7f83d373f))

## [0.2.4](https://github.com/brpowell/spiral/compare/desktop-v0.2.3...desktop-v0.2.4) (2026-10-11)


### Bug Fixes

* **desktop:** align [@tauri-apps](https://github.com/tauri-apps) JS packages with the Rust crates ([#7](https://github.com/brpowell/spiral/issues/7)) ([2cf4c4a](https://github.com/brpowell/spiral/commit/2cf4c4ad46cf70080931730e5e26cfd082030f92))

## [0.2.3](https://github.com/brpowell/spiral/compare/desktop-v0.2.2...desktop-v0.2.3) (2026-10-11)


### Miscellaneous Chores

* **desktop:** document the Apache-2.0 license in the README ([d6b37a7](https://github.com/brpowell/spiral/commit/d6b37a7631633895587e6e51ad1c0826caa1375f))

## [0.2.2](https://github.com/brpowell/spiral-desktop/compare/v0.2.1...v0.2.2) (2026-08-03)


### Bug Fixes

* **deps:** address npm and cargo audit vulnerabilities ([#214](https://github.com/brpowell/spiral-desktop/issues/214)) ([fd87c5d](https://github.com/brpowell/spiral-desktop/commit/fd87c5d0688a8bc5fe0e0e9208ce8a9c89c9b503))
* generate updater artifacts ([#215](https://github.com/brpowell/spiral-desktop/issues/215)) ([784cacb](https://github.com/brpowell/spiral-desktop/commit/784cacbd9ac61fe88a8a122c4e832dd80d36f830))

## [0.2.1](https://github.com/brpowell/spiral-desktop/compare/v0.2.0...v0.2.1) (2026-08-03)


### Bug Fixes

* load PCM worklet via Vite worker URL for production CSP ([#213](https://github.com/brpowell/spiral-desktop/issues/213)) ([36b69b2](https://github.com/brpowell/spiral-desktop/commit/36b69b28ef7908c5fa55b3a485073c5f94a6ca80))
* stabilize lightbox album art shared-layout zoom ([#211](https://github.com/brpowell/spiral-desktop/issues/211)) ([7bcb7a2](https://github.com/brpowell/spiral-desktop/commit/7bcb7a26dc08e27fd92dc91bdd07eb8ebf8575fd))

## [0.2.0](https://github.com/brpowell/spiral-desktop/compare/v0.1.0...v0.2.0) (2026-08-03)


### Features

* enable custom window chrome on Linux ([#191](https://github.com/brpowell/spiral-desktop/issues/191)) ([35f10ad](https://github.com/brpowell/spiral-desktop/commit/35f10ad080262381c1ff76e7eda65cf310103ab4))
* global shortcuts and improved file importing ([#15](https://github.com/brpowell/spiral-desktop/issues/15)) ([4efde0a](https://github.com/brpowell/spiral-desktop/commit/4efde0a014e9b75e54c18e82d0bec853ed7c9c05))
* **i18n:** Phase 1–2 cutoff — scaffold + centralized catalogs ([#166](https://github.com/brpowell/spiral-desktop/issues/166)) ([70408f5](https://github.com/brpowell/spiral-desktop/commit/70408f5d77df2f80314199c9c1f5b985dfd194d3))
* import tracks to library ([#55](https://github.com/brpowell/spiral-desktop/issues/55)) ([c2e02d7](https://github.com/brpowell/spiral-desktop/commit/c2e02d70fc6876f556d7e8cc3a1032de8ed41289))
* point updater endpoints at spiralpowered.com ([#199](https://github.com/brpowell/spiral-desktop/issues/199)) ([c4671d2](https://github.com/brpowell/spiral-desktop/commit/c4671d21c43d0530fda1f78fbe24c85b9b41490b))
* present in-app updates via toast, badge, and prefs ([#206](https://github.com/brpowell/spiral-desktop/issues/206)) ([071da5e](https://github.com/brpowell/spiral-desktop/commit/071da5e2ab80399ca295218f296462dc403203da))
* wire tauri updater ([#205](https://github.com/brpowell/spiral-desktop/issues/205)) ([f4014a1](https://github.com/brpowell/spiral-desktop/commit/f4014a1bb88f5b7fb3d3a839cca2288fe7c4936a))


### Bug Fixes

* drag to import ([1080549](https://github.com/brpowell/spiral-desktop/commit/10805491aea3610ffecc09d2349fc4bbbb2dba21))
* modal dismiss during text selection ([ea644ec](https://github.com/brpowell/spiral-desktop/commit/ea644ec95d93f7c9b8986c4937a868a4b68a38fd))
* rapid track switching fails playback ([a6ea1f2](https://github.com/brpowell/spiral-desktop/commit/a6ea1f289e20d632c256287ea742800bb1ac3e09))
* stop playback when switching library roots ([#197](https://github.com/brpowell/spiral-desktop/issues/197)) ([1ad3737](https://github.com/brpowell/spiral-desktop/commit/1ad37379f7f7456dda9b0acf52825b45f2b8c992))
* **updater:** disable live update checks in debug builds ([#207](https://github.com/brpowell/spiral-desktop/issues/207)) ([e709e7f](https://github.com/brpowell/spiral-desktop/commit/e709e7f2cdeabcd48d887fc937f90cf49e08f331))
