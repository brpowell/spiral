# Marketing stage (dev only)

Record the app in a staged state ("scene"), then re-apply it and capture the
native window later, so marketing screenshots can be retaken after UI changes.
Builds on the [agent bridge](agent-automation.md): start with
`npm run dev:agent`.

```bash
node scripts/stage.mjs save hero-light --notes "Tracks list, In Bloom at 1:16" --slot hero.light
node scripts/stage.mjs save theme-base --base --notes "Shared state for theme shots"
node scripts/stage.mjs assign hero-light hero.light   # label a downstream tool routes the capture by
node scripts/stage.mjs list
node scripts/stage.mjs apply hero-light          # stage only
node scripts/stage.mjs shoot hero-light          # stage + capture
node scripts/stage.mjs shoot --all               # every non-base scene
node scripts/stage.mjs shoot themes --only noir  # filter matrix variants
```

Stage the app how you want it (view, window size, theme, track, position,
scroll), then run `save`. Scenes live in `marketing/scenes/*.json` and are
committed; captures go to `marketing/out/` (gitignored) with a `manifest.json`
listing each file's `slot` for a publish step.

## Scenes

- Tracks are matched by title/artist/album, never by database id, so scenes
  apply on any library that contains those tracks.
- `extends` inherits another scene; only differences are stored
  (`save --extends <scene>`).
- `matrix` expands one scene into many shots, e.g.
  `"matrix": { "app.theme": ["spiral.theme.noir", "spiral.theme.abyss"] }` with
  `"publish": { "slot": "theme.{theme}" }` gives slots `theme.noir`,
  `theme.abyss`.
- Window x/y are not recorded unless you pass `--with-position`.

## Capture

`capture` uses `screencapture -l`, so the shot includes the window frame and
shadow. The app that launched `npm run dev:agent` (Terminal, Claude, an IDE)
needs Screen Recording permission in System Settings > Privacy & Security.
`scripts/agent.mjs shot` is the webview-only alternative and needs no
permission.

## Slots and handing captures on

A scene can carry a `publish.slot`: an opaque label (`hero.dark`,
`theme.{theme}`) that whatever consumes the captures uses to decide where an
image goes. Set it with `assign` or `save --slot`. Each capture in
`marketing/out/manifest.json` records its `slot`, `scene`, `variant`, `file` and
`notes`; nothing in this repo reads the slot, so any script can pick the
captures up from there.

## Driving a full run from outside

Everything is a plain CLI, so another script can run the whole thing:

1. start `npm run dev:agent` and wait until `window.__stage` exists
   (`node scripts/agent.mjs eval main "typeof window.__stage"` prints `object`);
2. `node scripts/stage.mjs snapshot <file>` to remember the app's current state;
3. `node scripts/stage.mjs shoot --all --strict`: `--strict` fails a scene
   whose track or playlist is missing instead of capturing it wrong, and every
   other scene is still shot; the exit code is non-zero if any failed;
4. `node scripts/stage.mjs restore <file>` to put the theme, skin, view and
   window size back (shots change persisted preferences), then quit the app.

## Not captured yet

Open menus and modals, CD playback, and component-local state. `save` warns
when it sees an editor open or CD playback. Library content comes from the
running app's data, so a fixed fixture library is still to do.
