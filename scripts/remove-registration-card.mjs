#!/usr/bin/env node
/**
 * Dev helper: delete the installed registration card so the app returns to trial.
 *
 * Path mirrors Tauri `app_data_dir` + `license/registration.spcard`
 * (identifier from src-tauri/tauri.conf.json).
 *
 * Restart Spiral (or re-open **Spiral → Spiral Card…**) to refresh license status.
 * The trial import gate re-reads the file on each add, so it applies immediately.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const APP_IDENTIFIER = "com.spiralpowered.music";
const CARD_RELATIVE = path.join("license", "registration.spcard");

function appDataDir() {
  switch (process.platform) {
    case "darwin":
      return path.join(
        os.homedir(),
        "Library",
        "Application Support",
        APP_IDENTIFIER,
      );
    case "win32":
      return path.join(
        process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
        APP_IDENTIFIER,
      );
    default:
      return path.join(
        process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"),
        APP_IDENTIFIER,
      );
  }
}

const cardPath = path.join(appDataDir(), CARD_RELATIVE);
const tmpPath = `${cardPath}.tmp`;

let removed = false;
for (const target of [cardPath, tmpPath]) {
  try {
    fs.unlinkSync(target);
    console.log(`Removed ${target}`);
    removed = true;
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      continue;
    }
    console.error(`Failed to remove ${target}:`, err);
    process.exit(1);
  }
}

if (!removed) {
  console.log(`No registration card at ${cardPath}`);
} else {
  console.log("Restart Spiral (or re-open Spiral → Spiral Card…) to refresh license status.");
}
