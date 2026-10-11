#!/usr/bin/env node
/**
 * Verify a Tauri updater `.sig` against a minisign public key.
 *
 * Usage:
 *   npm run release -- verify <file> [<file.sig>]
 *   npm run release -- verify <file> --pubkey src-tauri/keys/updater/spiral-updater.pub
 *
 * Default pubkey: src-tauri/keys/updater/spiral-updater.pub
 * Signature defaults to <file>.sig
 */
import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
} from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_PUBKEY = join(
  root,
  "src-tauri",
  "keys",
  "updater",
  "spiral-updater.pub",
);

/** SPKI DER prefix for a 32-byte raw Ed25519 public key */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function usage(exitCode = 0) {
  console.log(`Verify a Tauri updater signature.

Usage:
  npm run release -- verify <file> [<file.sig>] [--pubkey <path>]

Defaults:
  signature  <file>.sig
  pubkey     src-tauri/keys/updater/spiral-updater.pub
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  let pubkey = DEFAULT_PUBKEY;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h" || a === "--help") usage(0);
    if (a === "--pubkey") {
      pubkey = resolve(argv[++i] ?? "");
      continue;
    }
    if (a.startsWith("-")) {
      console.error(`Unknown arg: ${a}`);
      usage(1);
    }
    positional.push(resolve(a));
  }
  if (positional.length < 1 || positional.length > 2) {
    console.error("Expected <file> and optional <file.sig>");
    usage(1);
  }
  const file = positional[0];
  const sigPath = positional[1] ?? `${file}.sig`;
  return { file, sigPath, pubkey };
}

/** Tauri stores pubkey / .sig as base64 of a minisign text file. */
function decodeTauriBlob(raw, label) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("untrusted comment:")) {
    return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  }
  const decoded = Buffer.from(trimmed, "base64").toString("utf8");
  if (decoded.startsWith("untrusted comment:")) {
    return decoded.endsWith("\n") ? decoded : `${decoded}\n`;
  }
  throw new Error(`${label} is not a Tauri/minisign blob`);
}

function parseMinisignPublicKey(pubText) {
  const lines = pubText.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error("Invalid minisign public key");
  const keyBytes = Buffer.from(lines[1].trim(), "base64");
  if (keyBytes.length !== 42) {
    throw new Error(`Unexpected public key length ${keyBytes.length}`);
  }
  if (keyBytes.subarray(0, 2).toString("ascii") !== "Ed") {
    throw new Error("Public key is not an Ed25519 minisign key");
  }
  return {
    keyId: keyBytes.subarray(2, 10),
    publicKey: keyBytes.subarray(10, 42),
  };
}

function parseMinisignSignature(sigText) {
  const lines = sigText.trim().split(/\r?\n/);
  if (lines.length < 4) throw new Error("Invalid minisign signature");
  const sigBytes = Buffer.from(lines[1].trim(), "base64");
  if (sigBytes.length !== 74) {
    throw new Error(`Unexpected signature length ${sigBytes.length}`);
  }
  const algo = sigBytes.subarray(0, 2).toString("ascii");
  if (algo !== "ED") {
    throw new Error(`Unsupported signature algorithm '${algo}' (expected ED)`);
  }
  const trustedCommentLine = lines[2];
  if (!trustedCommentLine.startsWith("trusted comment: ")) {
    throw new Error("Missing trusted comment");
  }
  return {
    keyId: sigBytes.subarray(2, 10),
    signature: sigBytes.subarray(10, 74),
    trustedComment: trustedCommentLine.slice("trusted comment: ".length),
    globalSig: Buffer.from(lines[3].trim(), "base64"),
  };
}

function ed25519Key(publicKey) {
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
    format: "der",
    type: "spki",
  });
}

function verifyFile(filePath, sigText, pubText) {
  const pub = parseMinisignPublicKey(pubText);
  const sig = parseMinisignSignature(sigText);

  if (!pub.keyId.equals(sig.keyId)) {
    throw new Error("Signature key id does not match public key");
  }

  const key = ed25519Key(pub.publicKey);
  const digest = createHash("blake2b512")
    .update(readFileSync(filePath))
    .digest();

  if (!cryptoVerify(null, digest, key, sig.signature)) {
    throw new Error("File signature mismatch");
  }

  const globalMsg = Buffer.concat([
    sig.signature,
    Buffer.from(sig.trustedComment, "utf8"),
  ]);
  if (!cryptoVerify(null, globalMsg, key, sig.globalSig)) {
    throw new Error("Trusted-comment global signature mismatch");
  }
}

const { file, sigPath, pubkey } = parseArgs(process.argv.slice(2));

for (const [path, label] of [
  [file, "file"],
  [sigPath, "signature"],
  [pubkey, "pubkey"],
]) {
  if (!existsSync(path)) {
    console.error(`${label} not found: ${path}`);
    process.exit(1);
  }
}

try {
  const pubText = decodeTauriBlob(readFileSync(pubkey, "utf8"), "pubkey");
  const sigText = decodeTauriBlob(readFileSync(sigPath, "utf8"), "signature");
  verifyFile(file, sigText, pubText);
  console.log(`OK  ${file}`);
  console.log(`    signature ${sigPath}`);
  console.log(`    pubkey    ${pubkey}`);
} catch (err) {
  console.error(`Verification failed: ${err.message}`);
  process.exit(1);
}
