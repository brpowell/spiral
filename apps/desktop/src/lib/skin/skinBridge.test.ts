// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { minimalBindState } from "@/test/skinBindFixtures";
import { useSkinStore } from "@/store/useSkinStore";
import {
  addOpenAuxView,
  removeOpenAuxView,
} from "./auxWindow/skinAuxViewState";
import { evaluateSkinBind } from "./skinBinds";
import { initSkinBridge, shouldApplyRemoteSkinPreferences } from "./skinBridge";

vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));

vi.mock("@/lib/windows/windowRole", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/windows/windowRole")>()),
  isSkinModeWindow: () => true,
}));

describe("shouldApplyRemoteSkinPreferences", () => {
  it("applies when the event matches the loaded skin", () => {
    expect(
      shouldApplyRemoteSkinPreferences(
        "spiral.wmp-lost-planet.skin.lost-planet",
        "spiral.wmp-lost-planet.skin.lost-planet",
        "spiral.wmp-lost-planet.skin.lost-planet",
      ),
    ).toBe(true);
  });

  it("applies when the event matches the active pack even if prefs id differs", () => {
    expect(
      shouldApplyRemoteSkinPreferences(
        "spiral.wmp-lost-planet.skin.lost-planet",
        "lost-planet",
        "spiral.wmp-lost-planet.skin.lost-planet",
      ),
    ).toBe(true);
  });

  it("applies when this window has not loaded prefs yet", () => {
    expect(
      shouldApplyRemoteSkinPreferences(
        "spiral.wmp-lost-planet.skin.lost-planet",
        null,
        "spiral.skin.spiral-default",
      ),
    ).toBe(true);
  });

  it("ignores a snapshot for a different skin", () => {
    expect(
      shouldApplyRemoteSkinPreferences(
        "spiral.wmp-t3.skin.t3",
        "spiral.wmp-lost-planet.skin.lost-planet",
        "spiral.wmp-lost-planet.skin.lost-planet",
      ),
    ).toBe(false);
  });
});

describe("open auxiliary view sync", () => {
  const SKIN_ID = "spiral.test.skin.ice";

  function playlistOpenBind() {
    const { openAuxiliaryViews } = useSkinStore.getState();
    return evaluateSkinBind(
      "skin.view.playlist.open",
      minimalBindState({ openAuxiliaryViews }),
    );
  }

  /** Another webview writes shared storage; this one only gets `storage`. */
  function writeFromOtherWindow(openViewIds: string[]) {
    const key = "spiral:skin-open-aux-views";
    localStorage.setItem(key, JSON.stringify({ [SKIN_ID]: openViewIds }));
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }

  beforeEach(() => {
    localStorage.clear();
    useSkinStore.setState({ activeSkinId: SKIN_ID, openAuxiliaryViews: [] });
  });

  it("follows a view closed by another skin window", async () => {
    await initSkinBridge("skin-mode");
    writeFromOtherWindow(["playlist"]);
    expect(playlistOpenBind()).toBe(true);

    writeFromOtherWindow([]);

    expect(playlistOpenBind()).toBe(false);
  });

  it("follows changes made in this window outside the store actions", async () => {
    await initSkinBridge("skin-mode");
    addOpenAuxView(SKIN_ID, "playlist");
    expect(playlistOpenBind()).toBe(true);

    removeOpenAuxView(SKIN_ID, "playlist");

    expect(playlistOpenBind()).toBe(false);
  });

  it("picks up changes made before the bridge started", async () => {
    useSkinStore.setState({ openAuxiliaryViews: ["playlist"] });

    await initSkinBridge("skin-mode");

    expect(playlistOpenBind()).toBe(false);
  });
});
