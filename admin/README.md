# spk-registry admin (Preact SPA)

Token-gated UI for publish / yank / purge. Built assets in `dist/` are embedded into the Rust binary via `rust-embed` and served at `/rgad`.

## Develop

With the registry running on `:8787`:

```bash
npm install
npm run dev
# open http://127.0.0.1:5173/rgad/  (Vite proxies /v1 → :8787)
```

## Ship

After UI changes, rebuild so Cargo embeds fresh assets:

```bash
npm run build
# then cargo run / cargo test as usual
```
