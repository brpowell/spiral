# PoC license mint (Direct)

Developer-operated signer for provisional `.spcard` files and permanent
finalize. Uses the PoC Ed25519 private key under `docs/license/poc-keys/` —
**never** ship that key in app artifacts.

Contract: [`docs/license/spcard-v1.md`](../../docs/license/spcard-v1.md)  
Phases: 4–5 of [`license-provisioning-implementation-plan.md`](../../docs/license-provisioning-implementation-plan.md)

## Quick dogfood presets

From the repo root — each writes an installable `.spcard` (gitignored under
`tools/license-mint/`):

| Command | Purchase id | Result |
| ------- | ----------- | ------ |
| `npm run mint:provisional:default` | `poc-default` | Provisional, sku `standard` → `tools/license-mint/poc-default.spcard` |
| `npm run mint:provisional:founder` | `poc-founder` | Provisional, sku `founder` → `tools/license-mint/poc-founder.spcard` |
| `npm run mint:ready:default` | `poc-ready` | Ready to finalize (`refund-days 0`) → `tools/license-mint/poc-ready.spcard` |
| `npm run mint:permanent:default` | `poc-permanent` | Permanent (`expiresAt: null`) → `tools/license-mint/poc-permanent.spcard` |

Install via **Spiral → Spiral Card… → Install Spiral Card…**

## Base commands (arbitrary flags)

```bash
# Provisional .spcard
npm run mint:provisional -- --purchase-id my-id --out ./my-id.spcard

# Founder cohort
npm run mint:provisional -- --purchase-id my-id --sku founder --out ./my-id.spcard

# Permanent grant JSON only (purchase must already be minted)
npm run mint:finalize -- --purchase-id my-id

# Local HTTP finalize stub
npm run mint:serve
# listens on http://127.0.0.1:8787
```

## Finalize (CLI)

Issues a **permanent grant only** (`expiresAt: null`) for a purchase id
that was previously minted. Does not return a full `.spcard` — the app merges
the grant into the local card (preserving `productId` + `sku`). For an
installable permanent card, use `mint:permanent:default` (provisional →
finalize → remint into `.spcard`).

```bash
npm run mint:finalize -- --purchase-id poc-default
```

## Local HTTP stub (Phase 5)

Run the signer so Spiral can Confirm finalize over the network:

```bash
npm run mint:serve
# listens on http://127.0.0.1:8787
```

```http
POST /v1/license/finalize
Content-Type: application/json

{"originalPurchaseId":"poc-direct-dev-001"}
```

- **200** — grant JSON (`expiresAt: null`)
- **404** — unknown purchase id
- **403** — refunded stub (`originalPurchaseId` starts with `poc-refunded-`)
- **400** — bad JSON / empty id

The desktop app defaults to `http://127.0.0.1:8787`. Override with env
`SPIRAL_LICENSE_SERVER`.

## Proof (Direct verifier stub)

The signer trusts a shared secret; the CLI presents a proof grant:

| Role | Source | Value |
| ---- | ------ | ----- |
| Trusted grant | env `SPIRAL_MINT_GRANT`, else default | `spiral-poc-mint-grant` |
| Presented proof | `--grant`, else same as trusted | must match trusted |

```bash
# Rejected — presented proof ≠ trusted grant
SPIRAL_MINT_GRANT=spiral-poc-mint-grant \
  npm run mint:provisional -- --purchase-id x --grant wrong-secret
```

This is the Direct `ProofOfPurchaseVerifier` implementation; Steam/store adapters are typed stubs in `src-tauri/src/license/verifier.rs` — see [`docs/license/channel-adapter.md`](../../docs/license/channel-adapter.md).

## Idempotency

Grants are stored under `.mint-store/grants.json` (gitignored). Reminting the
**same** `--purchase-id` returns the **same** grant (`productId`, `sku`,
`issuedAt`, `expiresAt`, `signature`) — not a second logical purchase.
Re-finalizing returns the same permanent grant.

```bash
# First mint
npm run mint:provisional -- --purchase-id poc-direct-dev-001 --out ./a.spcard

# Remint — identical grant
npm run mint:provisional -- --purchase-id poc-direct-dev-001 --out ./b.spcard
diff <(jq '.grants[0]' a.spcard) <(jq '.grants[0]' b.spcard)
```

## Options

| Flag | Default | Notes |
| ---- | ------- | ----- |
| `--purchase-id` | *(required for provisional/finalize)* | `originalPurchaseId` |
| `--out` | stdout | Destination `.spcard` (provisional) or grant JSON (finalize) |
| `--refund-days` | `14` | Refund window (provisional) |
| `--buffer-mins` | `5` | Added to window for `expiresAt` |
| `--key` | `docs/license/poc-keys/ed25519-private.raw` | Private seed |
| `--store` | `tools/license-mint/.mint-store/grants.json` | Idempotency ledger |
| `--product-id` | `spiral` | Unlock product id |
| `--sku` | `standard` | `standard` \| `founder` |
| `--bind` | `127.0.0.1:8787` | `serve` listen address |

`expiresAt = now + refundWindow + buffer` (RFC 3339 UTC second precision).

## Reset trial

To return the app to trial after dogfooding:

```bash
npm run remove-registration-card
```

Then restart Spiral (or re-open **Spiral → Spiral Card…**) to refresh the card status UI.
