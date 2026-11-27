# Changelog

## [1.3.0](https://github.com/brpowell/spiral/compare/desktop-v1.2.0...desktop-v1.3.0) (2026-11-27)


### Features

* **desktop:** add artwork registry and sync genre settings ([#192](https://github.com/brpowell/spiral/issues/192)) ([419ad83](https://github.com/brpowell/spiral/commit/419ad839797443917bc5f4340e705594f2aa8500))
* **desktop:** add library id and change log ([#190](https://github.com/brpowell/spiral/issues/190)) ([97d483a](https://github.com/brpowell/spiral/commit/97d483a47d1302914861ffecedbd64ee41beb1f6))
* **sync:** add sync protocol and host HTTP API libraries ([#199](https://github.com/brpowell/spiral/issues/199)) ([f4abfb6](https://github.com/brpowell/spiral/commit/f4abfb638b5d4d2eac2bcec95aff1f4167474f2f))


### Bug Fixes

* **desktop:** stage NOTICE from the right folder in git worktrees ([#196](https://github.com/brpowell/spiral/issues/196)) ([028f48e](https://github.com/brpowell/spiral/commit/028f48e58f49c17983b013be17ccc85fbd4ed0c0))

## [1.2.0](https://github.com/brpowell/spiral/compare/desktop-v1.1.0...desktop-v1.2.0) (2026-11-20)


### Features

* **desktop:** add a track popularity score and a Popularity column ([#162](https://github.com/brpowell/spiral/issues/162)) ([f19f319](https://github.com/brpowell/spiral/commit/f19f319f4e32b7456ea3ed01cc3a5d90acacb11f))
* **desktop:** add genres view ([#165](https://github.com/brpowell/spiral/issues/165)) ([50a8224](https://github.com/brpowell/spiral/commit/50a822455c58fe750910eaa299e0190fb6b76957))
* **desktop:** add to playlist and remove from library for albums, artists and genres ([#181](https://github.com/brpowell/spiral/issues/181)) ([02f2b26](https://github.com/brpowell/spiral/commit/02f2b26c5a213fa608af200c9af103d4aed7b4d6))
* **desktop:** genre view database follow up ([#166](https://github.com/brpowell/spiral/issues/166)) ([0ea8bad](https://github.com/brpowell/spiral/commit/0ea8bad22fe88592eed24713a43b8eb17b01af31))
* **desktop:** link the artist name on album cards to the artist page ([#167](https://github.com/brpowell/spiral/issues/167)) ([097a6f1](https://github.com/brpowell/spiral/commit/097a6f1c42359fb48554540b706ef6908b9e758c))
* **desktop:** prefer releases from the user's region in MusicBrainz results ([#176](https://github.com/brpowell/spiral/issues/176)) ([852ee6d](https://github.com/brpowell/spiral/commit/852ee6d2366ea7a9175607a2b51adcbf78b37c4f))


### Bug Fixes

* **desktop:** cap memory used by embedded art during scans ([#185](https://github.com/brpowell/spiral/issues/185)) ([857c769](https://github.com/brpowell/spiral/commit/857c769c01b68587698e85430880ca7d7d0f417e))
* **desktop:** format playlist total duration as hours and minutes ([#164](https://github.com/brpowell/spiral/issues/164)) ([a54a1a8](https://github.com/brpowell/spiral/commit/a54a1a815662092aebed7f14d9e2967c4b183403))
* **desktop:** handle damaged CD discs gracefully ([#170](https://github.com/brpowell/spiral/issues/170)) ([455f940](https://github.com/brpowell/spiral/commit/455f94029be011f2743f5c2041ed550e914abd08))
* **desktop:** keep removed tracks from coming back on rescan ([#182](https://github.com/brpowell/spiral/issues/182)) ([5df4662](https://github.com/brpowell/spiral/commit/5df46623364ac473b9451d121dbedc344ff5b2c2))
* **desktop:** keep removed tracks remembered when their folder is offline ([#187](https://github.com/brpowell/spiral/issues/187)) ([c1cf655](https://github.com/brpowell/spiral/commit/c1cf655c7f3c8b340dd51ec2a30dc4b61e46cd19))
* **desktop:** keep ripping and the playhead correct while the window is hidden ([#168](https://github.com/brpowell/spiral/issues/168)) ([4e4c3e1](https://github.com/brpowell/spiral/commit/4e4c3e194226b29f18bec64c74c10dd7ac5b2603))
* **desktop:** keep the app responsive when a network music folder stops answering ([#180](https://github.com/brpowell/spiral/issues/180)) ([ad4b8d7](https://github.com/brpowell/spiral/commit/ad4b8d7359c9cdcf69d859febbfe08076129dfdc))
* **desktop:** keep the audio stream alive across ALSA underruns ([#177](https://github.com/brpowell/spiral/issues/177)) ([77bdc65](https://github.com/brpowell/spiral/commit/77bdc65c0b30c00e3c980caa54fad5096f59dc24))
* **desktop:** keep the Source column hidden and scroll the column menus ([#161](https://github.com/brpowell/spiral/issues/161)) ([5f1615e](https://github.com/brpowell/spiral/commit/5f1615e5aef1a519f4c8a68fc088e48314a1ff81))
* **desktop:** lock and dismount the volume before ejecting a disc on Windows ([#172](https://github.com/brpowell/spiral/issues/172)) ([7407bdd](https://github.com/brpowell/spiral/commit/7407bdd9ece79319f13f8675f12e73ce196533a7))
* **desktop:** make context menu separators visible on all themes ([#173](https://github.com/brpowell/spiral/issues/173)) ([86da3d8](https://github.com/brpowell/spiral/commit/86da3d817bf247767c06e891bc7f77b948c6fa79))
* **desktop:** only eject optical drives ([#186](https://github.com/brpowell/spiral/issues/186)) ([1627c08](https://github.com/brpowell/spiral/commit/1627c08131a6304891096616e2e48c098d7a91a3))
* **desktop:** only play files within library scope ([#188](https://github.com/brpowell/spiral/issues/188)) ([d5c7d7f](https://github.com/brpowell/spiral/commit/d5c7d7fe5a03027c7fa6f300f56de6e2b6ae9a5e))
* **desktop:** refine music source removal, editing and empty-folder scans ([#179](https://github.com/brpowell/spiral/issues/179)) ([97e8236](https://github.com/brpowell/spiral/commit/97e8236c583bc6a0b9b0fb9d6eecc6c3c990e251))
* **desktop:** reset CD import checkmarks when the disc changes ([#169](https://github.com/brpowell/spiral/issues/169)) ([af69cf7](https://github.com/brpowell/spiral/commit/af69cf73804d785ba0f962919a2c87d6d7a4655c))
* **desktop:** shorten the onboarding Finish countdown to 12 seconds ([#174](https://github.com/brpowell/spiral/issues/174)) ([07d5e43](https://github.com/brpowell/spiral/commit/07d5e43c34787a4818cb56bc5baac6a22fe9c877))
* **desktop:** show country flags on Windows by bundling a flag font ([#184](https://github.com/brpowell/spiral/issues/184)) ([6006f7c](https://github.com/brpowell/spiral/commit/6006f7cbb461b2d80ee9c1f092761f212112e4bb))
* **desktop:** sort genre and album detail pages properly ([#175](https://github.com/brpowell/spiral/issues/175)) ([5d36156](https://github.com/brpowell/spiral/commit/5d361568cc7e2b15ba24fd9bc9ae41e00823ce95))
* **desktop:** split multi-artist tags joined with "/" or ID3v2.4 nulls ([#183](https://github.com/brpowell/spiral/issues/183)) ([bdf43d9](https://github.com/brpowell/spiral/commit/bdf43d98d7149d3462358b84363a360fb8167907))


### Performance Improvements

* **desktop:** speed up music source scans and show their progress ([#178](https://github.com/brpowell/spiral/issues/178)) ([551e222](https://github.com/brpowell/spiral/commit/551e222af7bc67e28c1442cc29d09477e41181d7))

## [1.1.0](https://github.com/brpowell/spiral/compare/desktop-v1.0.0...desktop-v1.1.0) (2026-11-12)


### Features

* **desktop:** choose lyrics from a list and remember applied results ([#146](https://github.com/brpowell/spiral/issues/146)) ([c55fa5c](https://github.com/brpowell/spiral/commit/c55fa5c8b6e248c9578a57b4bcb28d977181e733))
* **desktop:** give Linux windows a shadow, rounded corners and wider resize edges ([#156](https://github.com/brpowell/spiral/issues/156)) ([51c56dc](https://github.com/brpowell/spiral/commit/51c56dc5532a3b9b19d44a1a4522bac1e65900a0))
* **desktop:** support Linux in the dev agent bridge ([#153](https://github.com/brpowell/spiral/issues/153)) ([8fbab7f](https://github.com/brpowell/spiral/commit/8fbab7fe872de59f33ff5e962a2aea8f73e9ce16))


### Bug Fixes

* **desktop:** clear clippy warnings in the Rust backend ([#157](https://github.com/brpowell/spiral/issues/157)) ([4e6010b](https://github.com/brpowell/spiral/commit/4e6010bd3a95458acb26008ab72a5920a5de3f95))
* **desktop:** ease the onboarding logo dock animation on Linux ([#158](https://github.com/brpowell/spiral/issues/158)) ([8c34a27](https://github.com/brpowell/spiral/commit/8c34a27ef27e78386923bb08ff04cd9fc110c94d))
* **desktop:** hide the custom menu bar during onboarding ([#154](https://github.com/brpowell/spiral/issues/154)) ([8b80043](https://github.com/brpowell/spiral/commit/8b80043cd23dd22d35f65c7ce583ec54207c49c7))
* **desktop:** keep visualizer idle animation speed steady at any size ([#151](https://github.com/brpowell/spiral/issues/151)) ([d0c0544](https://github.com/brpowell/spiral/commit/d0c054474ca61cca39bb59d57916ef964c034a73))
* **desktop:** render WebGL visualizers on Linux ([#152](https://github.com/brpowell/spiral/issues/152)) ([30a277a](https://github.com/brpowell/spiral/commit/30a277a288dd7774a27d12f5e49179dbb9a44de9))
* **desktop:** resolve network-share URIs on import (Linux, GVFS + KIO) ([#159](https://github.com/brpowell/spiral/issues/159)) ([fdf3cc2](https://github.com/brpowell/spiral/commit/fdf3cc27936120f03e3e0b96a8ffb002ba9e120a))
* **desktop:** smooth rendering on Linux with NVIDIA under Wayland ([#150](https://github.com/brpowell/spiral/issues/150)) ([0034197](https://github.com/brpowell/spiral/commit/0034197c7d1c812ebff5e76053f3b582ada7405d))
* **desktop:** stop asking for Accessibility access on launch ([#149](https://github.com/brpowell/spiral/issues/149)) ([3015cfb](https://github.com/brpowell/spiral/commit/3015cfb64789d0c86ea717b41bf410b9b4e19f9f))
* **desktop:** stop WebGL visualizer previews crashing on Linux ([#155](https://github.com/brpowell/spiral/issues/155)) ([7b171e2](https://github.com/brpowell/spiral/commit/7b171e250571b85531c6a9b0159caa6f8f81ca20))

## [1.0.0](https://github.com/brpowell/spiral/compare/desktop-v0.4.0...desktop-v1.0.0) (2026-11-07)


### Features

* **desktop:** add a dev-only marketing stage for capturing app screenshots ([#138](https://github.com/brpowell/spiral/issues/138)) ([0fc8b7c](https://github.com/brpowell/spiral/commit/0fc8b7c2471f83c5e6585a93547ad6b62e36321d))
* **desktop:** add buy me a coffee links to onboarding and about ([#126](https://github.com/brpowell/spiral/issues/126)) ([908fff3](https://github.com/brpowell/spiral/commit/908fff3e44883c168a0b172ddf36343e5694ce6b))
* **desktop:** add first-run welcome screens ([#96](https://github.com/brpowell/spiral/issues/96)) ([1b8fc3d](https://github.com/brpowell/spiral/commit/1b8fc3d70c65822ec69d752b4cc21d39db2ff576))
* **desktop:** add music folders to the library ([#124](https://github.com/brpowell/spiral/issues/124)) ([b882d4f](https://github.com/brpowell/spiral/commit/b882d4f6b8075859067945eb593cea40c23fcb18))
* **desktop:** common Checkbox in track list, album artist autocomplete, pressed menu states, CD prompt body text ([#134](https://github.com/brpowell/spiral/issues/134)) ([f187ca3](https://github.com/brpowell/spiral/commit/f187ca35b83b283271bf484cc6a21fbcf5d4d4b6))
* **desktop:** confirm before rating writes tags to files ([#92](https://github.com/brpowell/spiral/issues/92)) ([5e2dbcb](https://github.com/brpowell/spiral/commit/5e2dbcb7ed66f818abac74b56574cb1bbd983a63))
* **desktop:** confirm before writing tags to files ([#88](https://github.com/brpowell/spiral/issues/88)) ([d02ed26](https://github.com/brpowell/spiral/commit/d02ed26546360c3f4f96af5f5f21c93311d0f8de))
* **desktop:** crop artist and album images ([#95](https://github.com/brpowell/spiral/issues/95)) ([36c44b7](https://github.com/brpowell/spiral/commit/36c44b70738c24214c1c7d95790b6d141922df8a))
* **desktop:** crossfade between views with the onboarding curve ([#130](https://github.com/brpowell/spiral/issues/130)) ([2aa1bb6](https://github.com/brpowell/spiral/commit/2aa1bb6b36654db27fdd2c192b1f2eb4ef78e511))
* **desktop:** llm-drafted release note overviews ([#85](https://github.com/brpowell/spiral/issues/85)) ([a08eff3](https://github.com/brpowell/spiral/commit/a08eff3c58e19c65b7486e653131813d5ad61fca))
* **desktop:** make Sprig Dark the default theme for new users ([#141](https://github.com/brpowell/spiral/issues/141)) ([27b9faa](https://github.com/brpowell/spiral/commit/27b9faa556241eba09a285312e1969967da1fde6))
* **desktop:** rework the library sidebar layout and scrolling ([#137](https://github.com/brpowell/spiral/issues/137)) ([beb85bd](https://github.com/brpowell/spiral/commit/beb85bd55d5df468dace67a5904946bd1106b377))


### Bug Fixes

* **desktop:** avoid duplicate CD art toast during metadata fetch ([#84](https://github.com/brpowell/spiral/issues/84)) ([f7938dd](https://github.com/brpowell/spiral/commit/f7938dd188ef42e17b877aa8a0c35f181ab1625c))
* **desktop:** keep eject icon centered while ejecting a disc ([#129](https://github.com/brpowell/spiral/issues/129)) ([bd16e4f](https://github.com/brpowell/spiral/commit/bd16e4f1951571ffb0d7d70025237a84b04e421e))
* **desktop:** lower output gain and keep the visualizer level ([#93](https://github.com/brpowell/spiral/issues/93)) ([7da9868](https://github.com/brpowell/spiral/commit/7da98687639d9c9151f7d9c11fb922c3c534b7cb))
* **desktop:** measure tab content through display: contents wrappers ([#128](https://github.com/brpowell/spiral/issues/128)) ([52e8604](https://github.com/brpowell/spiral/commit/52e8604cc441fd28c70a90c6194b8f802d95535d))
* **desktop:** patch zod and fast-uri advisories ([#78](https://github.com/brpowell/spiral/issues/78)) ([66cf420](https://github.com/brpowell/spiral/commit/66cf420e13a72590ecb0eecefd8d2f01feb9f80e))
* **desktop:** raise the Bump Juice liquid surface ([#136](https://github.com/brpowell/spiral/issues/136)) ([56084c2](https://github.com/brpowell/spiral/commit/56084c27f2cc20e6155f01d24d807df8396c2b44))
* **desktop:** restore sequential order when shuffle is turned off ([#140](https://github.com/brpowell/spiral/issues/140)) ([8abca1b](https://github.com/brpowell/spiral/commit/8abca1bce59ccd50b2abf6686fb43c113c4a7dd6))
* **desktop:** update happy-dom to 21.0.4 for security advisory ([#79](https://github.com/brpowell/spiral/issues/79)) ([553477c](https://github.com/brpowell/spiral/commit/553477cffd39d077d574d82482f22e50f24c6a34))
* **desktop:** update tauri updater and tokio for security advisories ([#125](https://github.com/brpowell/spiral/issues/125)) ([25f714e](https://github.com/brpowell/spiral/commit/25f714e1278471fe5a7da016747de7c48cfe7929))

## [0.4.0](https://github.com/brpowell/spiral/compare/desktop-v0.3.0...desktop-v0.4.0) (2026-10-23)


### Features

* **desktop:** compute accessible text colors for card blurbs and selected labels ([#58](https://github.com/brpowell/spiral/issues/58)) ([07d4043](https://github.com/brpowell/spiral/commit/07d404328f92ff1475c6388aaf5ffc67898750c1))
* **desktop:** play all audio through a native output ([#31](https://github.com/brpowell/spiral/issues/31)) ([5744dc4](https://github.com/brpowell/spiral/commit/5744dc4208821cf1bebe812cad032ab340cdd974))
* **desktop:** rework Studio catalog and collection UI ([#54](https://github.com/brpowell/spiral/issues/54)) ([00ec1c8](https://github.com/brpowell/spiral/commit/00ec1c8b84b7d90a7124610ce407cfcf959ee8b4))
* **desktop:** Spiral visualizer defaults, black themed backdrop, Double Dutch ([#71](https://github.com/brpowell/spiral/issues/71)) ([ea454bf](https://github.com/brpowell/spiral/commit/ea454bfac122264a4f93acd0395fe5714e56df05))
* **desktop:** studio polish, non-blocking catalog and registry authors ([#70](https://github.com/brpowell/spiral/issues/70)) ([ab79fcc](https://github.com/brpowell/spiral/commit/ab79fccca27c4fe9eaacd4e1957fbb3de5e4ed21))
* manage customizations as individual items with a rebuilt registry ([#49](https://github.com/brpowell/spiral/issues/49)) ([7f570bb](https://github.com/brpowell/spiral/commit/7f570bbdb3eb70c8a60a7d4b74e5e4ba260238a3))
* **registry:** record a download count per item version ([#55](https://github.com/brpowell/spiral/issues/55)) ([3594f48](https://github.com/brpowell/spiral/commit/3594f48a71a033bae38cfe3b0100e839acbbac08))
* **themes:** font catalog, editable built-ins and lighter weights ([#57](https://github.com/brpowell/spiral/issues/57)) ([0195217](https://github.com/brpowell/spiral/commit/0195217e7764a7c1284e92666720d2e748f04cca))


### Bug Fixes

* delete playlist body not appearing ([#35](https://github.com/brpowell/spiral/issues/35)) ([52c64c3](https://github.com/brpowell/spiral/commit/52c64c3dca0444af7daeea99187e8eed802219a0))
* **deps:** bump rustls to 0.23.46 ([#60](https://github.com/brpowell/spiral/issues/60)) ([f318b69](https://github.com/brpowell/spiral/commit/f318b690edfd41efdbdb911edd770453ac218e46))
* **deps:** bump zip to 9 ([#61](https://github.com/brpowell/spiral/issues/61)) ([fb70156](https://github.com/brpowell/spiral/commit/fb701568ee9b0311f64f561e981a5a7f0f4df49e))
* **desktop:** blend Windows/Linux titlebar with library header ([#34](https://github.com/brpowell/spiral/issues/34)) ([f8cd6f6](https://github.com/brpowell/spiral/commit/f8cd6f619b4f7cdb328bb5e3df02d4a84908fe6e))
* **desktop:** bound album zip and skin archive extraction ([#76](https://github.com/brpowell/spiral/issues/76)) ([d1de87b](https://github.com/brpowell/spiral/commit/d1de87bbaab2d70573944e8dc18456844c7954f6))
* **desktop:** load release notes from www and space the notes scrollbar ([#56](https://github.com/brpowell/spiral/issues/56)) ([beebe73](https://github.com/brpowell/spiral/commit/beebe73067ad3337a7b30e409439de60ffea0ce7))
* **desktop:** narrow webview file access to app, library and picked paths ([#75](https://github.com/brpowell/spiral/issues/75)) ([5833352](https://github.com/brpowell/spiral/commit/58333529e50503322871c1285dc98609e098c9cb))
* **desktop:** open about window without freezing UI on Windows ([#32](https://github.com/brpowell/spiral/issues/32)) ([313716b](https://github.com/brpowell/spiral/commit/313716b0e3f4d28b27447a6eaa30ead7247b9a7c))
* **desktop:** serve the visualizer worker with its own CSP ([#74](https://github.com/brpowell/spiral/issues/74)) ([bacb30a](https://github.com/brpowell/spiral/commit/bacb30a299eff6f8cb6160d2cb14a52bf3c10ca0))
* **desktop:** use the Spiral icon for the Windows installer ([#65](https://github.com/brpowell/spiral/issues/65)) ([9b77563](https://github.com/brpowell/spiral/commit/9b77563d50be4b4c28ae54a89e5b6b6dd93f8259))
* **desktop:** validate artwork path segments ([#72](https://github.com/brpowell/spiral/issues/72)) ([3bfa870](https://github.com/brpowell/spiral/commit/3bfa87003f910129acf5293ff89c5d6ef7780a66))
* **desktop:** version database migrations and rebuild artist_images key ([#67](https://github.com/brpowell/spiral/issues/67)) ([f90f1e3](https://github.com/brpowell/spiral/commit/f90f1e3af802c867fc17e890230b35e8d228863a))

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
