import { Channel, convertFileSrc } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { createOperationId } from "./activityLog";
import { BackgroundTaskCancelledError } from "./backgroundTaskCancel";
import {
  cancelPackDownload,
  clearPackDownloadCancel,
  fetchPackCatalog,
  fetchRegistryPack,
  fetchRegistryPackVersion,
  installPackFromRegistry,
  listPacks,
  packMeetsMinAppVersion,
  resolveRegistryPackPreview,
  type InstallPackResult,
} from "./tauri";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import {
  catalogDisplayName,
  type CatalogPackEntry,
  type PackDownloadProgress,
  type RegistryPackDetail,
  type RegistryPackList,
  type RegistryPackSummary,
  type RegistryVersionDetail,
  type RegistryVersionSummary,
} from "../types/packRegistry";
import {
  logPackInstallFailure,
  logPackInstallSuccess,
} from "./packs/packInstallActivity";
import {
  refreshPackContributionStores,
  rollbackPackWithRefresh,
} from "./packs/refreshPackStores";
import { packIdentity } from "./packs/packManifest";
import { errorMessageFromUnknown } from "./cdPlaybackFailure";
import { afterUiTransition } from "./scheduling";
import {
  packDownloadFailedPayload,
  packInstalledPayload,
} from "./toastPayloads";

export { catalogDisplayName };

/** Background task key for registry pack downloads (cancel wiring). */
export const PACK_REGISTRY_DOWNLOAD_KEY = "pack-registry-download";

/** Background task key for bulk pack updates (cancel wiring). */
export const PACK_UPDATES_BULK_KEY = "pack-updates-bulk";

/** On-disk / catalog installed key: `authorId.packId@version`. */
export function installedPackKey(
  authorId: string,
  packId: string,
  version: string,
): string {
  return `${packIdentity(authorId, packId)}@${version}`;
}

/**
 * Compare permissive MAJOR.MINOR.PATCH semver (pre-release / build ignored).
 * Mirrors Rust `packs::scan::version_cmp`.
 */
export function versionCmp(a: string, b: string): -1 | 0 | 1 | null {
  const parseCore = (v: string): [number, number, number] | null => {
    const core = v.split(/[-+]/, 2)[0] ?? v;
    const parts = core.split(".");
    if (parts.length < 3) return null;
    const major = Number(parts[0]);
    const minor = Number(parts[1]);
    const patch = Number(parts[2]);
    if (
      !Number.isFinite(major) ||
      !Number.isFinite(minor) ||
      !Number.isFinite(patch)
    ) {
      return null;
    }
    return [major, minor, patch];
  };
  const pa = parseCore(a);
  const pb = parseCore(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    if (pa[i]! < pb[i]!) return -1;
    if (pa[i]! > pb[i]!) return 1;
  }
  return 0;
}

/** Catalog list row key including registry provenance. */
export function catalogPackKey(
  registryUrl: string,
  authorId: string,
  packId: string,
): string {
  return `${registryUrl}:${authorId}/${packId}`;
}

export type FetchPackCatalogResult =
  { ok: true; catalog: RegistryPackList } | { ok: false; error: string };

/**
 * Fetch the pack catalog from every configured registry.
 *
 * - Full failure (no packs and at least one error) → `{ ok: false }` for Phase 5 empty/error UI.
 * - Partial success (some registries failed) → `{ ok: true }` with `catalog.errors` populated.
 */
export async function fetchPackCatalogSafe(options?: {
  contributionType?: string | null;
  authorId?: string | null;
}): Promise<FetchPackCatalogResult> {
  try {
    const catalog = await fetchPackCatalog(options);
    const errors = catalog.errors ?? [];
    if (catalog.packs.length === 0 && errors.length > 0) {
      return {
        ok: false,
        error:
          errors.map((e) => e.error).join(" · ") ||
          t("toasts:packs.catalogFailed"),
      };
    }
    return { ok: true, catalog };
  } catch (err) {
    const error =
      typeof err === "string" && err.trim()
        ? err
        : err instanceof Error && err.message.trim()
          ? err.message
          : t("toasts:packs.catalogFailed");
    return { ok: false, error };
  }
}

/**
 * Fetch version detail (including README) for pre-install About browsing.
 */
export async function fetchRegistryPackVersionSafe(args: {
  registryUrl: string;
  authorId: string;
  packId: string;
  version: string;
}): Promise<
  { ok: true; detail: RegistryVersionDetail } | { ok: false; error: string }
> {
  try {
    const detail = await fetchRegistryPackVersion(args);
    return { ok: true, detail };
  } catch (err) {
    const error =
      typeof err === "string" && err.trim()
        ? err
        : err instanceof Error && err.message.trim()
          ? err.message
          : t("toasts:packs.catalogFailed");
    return { ok: false, error };
  }
}

/**
 * Fetch all published versions for a pack (`GET /v1/packs/:author/:pack`).
 */
export async function fetchRegistryPackSafe(args: {
  registryUrl: string;
  authorId: string;
  packId: string;
}): Promise<
  { ok: true; detail: RegistryPackDetail } | { ok: false; error: string }
> {
  try {
    const detail = await fetchRegistryPack(args);
    return { ok: true, detail };
  } catch (err) {
    const error =
      typeof err === "string" && err.trim()
        ? err
        : err instanceof Error && err.message.trim()
          ? err.message
          : t("toasts:packs.catalogFailed");
    return { ok: false, error };
  }
}

/**
 * Enrich catalog rows with local install + minAppVersion flags (no extra
 * registry round-trip for those). Already-installed detection uses on-disk
 * `authorId`+`packId`+`version`. Icons are fetched via Rust into the
 * registry-asset cache and exposed as `asset:` URLs (never raw registry http).
 *
 * Pass `resolvePreviews: false` for background update checks so we do not
 * download every catalog preview on each poll.
 */
export async function enrichPackCatalog(
  packs: RegistryPackSummary[],
  options?: { resolvePreviews?: boolean },
): Promise<CatalogPackEntry[]> {
  const resolvePreviews = options?.resolvePreviews !== false;
  const listed = await listPacks().catch(() => []);

  const installedPacks = listed.filter((p) => p.zone === "installed");

  const installedKeys = new Set(
    installedPacks.map((p) =>
      installedPackKey(p.authorId, p.packId, p.version),
    ),
  );

  /** Highest installed version + display name per authorId.packId. */
  const highestByIdentity = new Map<
    string,
    { version: string; name: string }
  >();
  for (const p of installedPacks) {
    const id = packIdentity(p.authorId, p.packId);
    const prev = highestByIdentity.get(id);
    const cmp = prev ? versionCmp(p.version, prev.version) : 1;
    if (!prev || cmp === 1) {
      highestByIdentity.set(id, {
        version: p.version,
        name: p.name.trim() || prev?.name || "",
      });
    } else if (!prev.name.trim() && p.name.trim()) {
      highestByIdentity.set(id, { version: prev.version, name: p.name });
    }
  }

  return Promise.all(
    packs.map(async (pack) => {
      const version = pack.latestVersion.version;
      const key = installedPackKey(pack.authorId, pack.packId, version);
      const installed = installedKeys.has(key);

      const local = highestByIdentity.get(
        packIdentity(pack.authorId, pack.packId),
      );
      const installedVersion = local?.version ?? null;
      const localName = local?.name?.trim() || null;

      let updateAvailable = false;
      if (installedVersion && !installed) {
        const cmp = versionCmp(version, installedVersion);
        updateAvailable = cmp === 1;
      }

      const min = pack.latestVersion.minAppVersion ?? null;
      const meetsMinAppVersion = await packMeetsMinAppVersion(min);

      let resolvedPreviewUrl: string | null = null;
      if (resolvePreviews) {
        const previewRel = pack.latestVersion.previewUrl ?? null;
        if (previewRel && previewRel.trim()) {
          const cachedPath = await resolveRegistryPackPreview({
            registryUrl: pack.registryUrl,
            previewUrl: previewRel,
          }).catch(() => null);
          if (cachedPath) {
            resolvedPreviewUrl = convertFileSrc(cachedPath);
          }
        }
      }

      return {
        ...pack,
        installed,
        updateAvailable,
        installedVersion,
        localName,
        meetsMinAppVersion,
        resolvedPreviewUrl,
      };
    }),
  );
}

export type InstallRegistryPackArgs = {
  registryUrl: string;
  authorId: string;
  packId: string;
  version: string;
  sha256: string;
  sizeBytes: number;
  minAppVersion?: string | null;
  /** Display name for progress/success toasts; falls back to packId. */
  name?: string;
};

/**
 * Download + install a registry pack with BackgroundTask progress bar and
 * single-subject toasts (§6 success / §4.3 failure + activity log).
 *
 * Store refresh is deferred until after settle so the progress→success morph
 * can paint before theme/skin/visualizer reload.
 */
export function installRegistryPack(
  args: InstallRegistryPackArgs,
): Promise<InstallPackResult | null> {
  const displayName = args.name?.trim() || args.packId;

  return new Promise((resolve) => {
    useBackgroundTasksStore.getState().runInBackground({
      key: PACK_REGISTRY_DOWNLOAD_KEY,
      label: t("toasts:packs.downloading", { name: displayName }),
      cancellable: true,
      progressDisplay: "bar",
      run: async (ctx) => {
        const operationId = createOperationId();
        await clearPackDownloadCancel();

        const onProgress = new Channel<PackDownloadProgress>();
        onProgress.onmessage = ({ current, total }) => {
          if (total > 0) {
            ctx.setProgress(current, total);
          }
        };

        try {
          if (ctx.isCancelRequested()) {
            await cancelPackDownload();
            resolve(null);
            throw new BackgroundTaskCancelledError(
              t("toasts:packs.downloadCancelled"),
            );
          }

          const result = await installPackFromRegistry({
            registryUrl: args.registryUrl,
            authorId: args.authorId,
            packId: args.packId,
            version: args.version,
            sha256: args.sha256,
            sizeBytes: args.sizeBytes,
            minAppVersion: args.minAppVersion ?? null,
            onProgress,
          });

          logPackInstallSuccess({
            operationId,
            source: "registry",
            result,
            registryUrl: args.registryUrl,
            authorId: args.authorId,
            sha256: args.sha256,
            sizeBytes: args.sizeBytes,
            minAppVersion: args.minAppVersion,
          });
          const installed = packInstalledPayload(
            result.name || displayName,
            result.version,
          );
          ctx.settleAs({
            status: "success",
            label: installed.label,
            detail: installed.detail,
          });
          // settleAs applies after `run` returns — defer heavy refresh.
          void (async () => {
            try {
              await afterUiTransition();
              await refreshPackContributionStores();
            } catch (err) {
              console.error(
                "Failed to refresh packs after registry install:",
                err,
              );
            } finally {
              // Dynamic import avoids a circular dependency with usePackUpdatesStore.
              void import("../store/usePackUpdatesStore").then(
                ({ refreshPackUpdatesAfterInstall }) => {
                  void refreshPackUpdatesAfterInstall(result, args.authorId);
                },
              );
              resolve(result);
            }
          })();
        } catch (err) {
          const message = errorMessageFromUnknown(err);
          if (
            message === "Pack download cancelled" ||
            /pack download cancelled/i.test(message)
          ) {
            resolve(null);
            throw new BackgroundTaskCancelledError(
              t("toasts:packs.downloadCancelled"),
            );
          }
          logPackInstallFailure({
            operationId,
            source: "registry",
            err,
            name: displayName,
            registryUrl: args.registryUrl,
            authorId: args.authorId,
            packId: args.packId,
            version: args.version,
            sha256: args.sha256,
            sizeBytes: args.sizeBytes,
            minAppVersion: args.minAppVersion,
          });
          const failed = packDownloadFailedPayload(displayName, {
            logLink: { operationId },
          });
          ctx.settleAs({
            status: "error",
            label: failed.label,
            detail: failed.detail,
            logLink: failed.logLink,
          });
          resolve(null);
        }
      },
    });
  });
}

/**
 * Install a specific published registry version.
 *
 * - Newer than installed (or nothing installed): download + install (keeps older dirs).
 * - Same as active: no-op.
 * - Older than active: download if missing, then rollback (remove newer dirs) so
 *   the chosen version becomes active. Caller must confirm before invoking.
 */
export async function installRegistryPackVersion(args: {
  registryUrl: string;
  authorId: string;
  packId: string;
  version: RegistryVersionSummary;
  /** Highest currently installed version for this identity, when any exist. */
  installedVersion?: string | null;
  name?: string;
}): Promise<InstallPackResult | null> {
  const displayName = args.name?.trim() || args.packId;
  const target = args.version;
  const installed = args.installedVersion?.trim() || null;

  if (installed) {
    const cmp = versionCmp(target.version, installed);
    if (cmp === 0) return null;

    if (cmp === -1) {
      const listed = await listPacks().catch(() => []);
      const onDisk = listed.some(
        (p) =>
          p.zone === "installed" &&
          p.authorId === args.authorId &&
          p.packId === args.packId &&
          p.version === target.version,
      );

      let downloaded: InstallPackResult | null = null;
      if (!onDisk) {
        downloaded = await installRegistryPack({
          registryUrl: args.registryUrl,
          authorId: args.authorId,
          packId: args.packId,
          version: target.version,
          sha256: target.sha256,
          sizeBytes: target.sizeBytes,
          minAppVersion: target.minAppVersion,
          name: displayName,
        });
        if (!downloaded) return null;
      }

      const rolledBack = await rollbackPackWithRefresh(
        args.authorId,
        args.packId,
        target.version,
      );
      if (!rolledBack) return null;

      if (onDisk) {
        useBackgroundTasksStore
          .getState()
          .showToast(packInstalledPayload(displayName, target.version));
      }

      // Dynamic import avoids a circular dependency with usePackUpdatesStore.
      void import("../store/usePackUpdatesStore").then(
        ({ refreshPackUpdatesAfterInstall }) => {
          void refreshPackUpdatesAfterInstall(
            downloaded ?? {
              packId: args.packId,
              version: target.version,
              name: displayName,
              packDir: "",
              contributionCount: 0,
            },
            args.authorId,
          );
        },
      );

      return (
        downloaded ?? {
          packId: args.packId,
          version: target.version,
          name: displayName,
          packDir: "",
          contributionCount: 0,
        }
      );
    }
  }

  return installRegistryPack({
    registryUrl: args.registryUrl,
    authorId: args.authorId,
    packId: args.packId,
    version: target.version,
    sha256: target.sha256,
    sizeBytes: target.sizeBytes,
    minAppVersion: target.minAppVersion,
    name: displayName,
  });
}

/** Sort published versions newest-first (semver core). */
export function sortVersionsNewestFirst(
  versions: RegistryVersionSummary[],
): RegistryVersionSummary[] {
  return [...versions].sort((a, b) => {
    const cmp = versionCmp(a.version, b.version);
    if (cmp != null) return -cmp;
    return b.version.localeCompare(a.version);
  });
}

/** Whether the running app satisfies an optional catalog `minAppVersion`. */
export function versionMeetsMinApp(
  minAppVersion: string | null | undefined,
  appVersion: string,
): boolean {
  const min = minAppVersion?.trim();
  if (!min) return true;
  const cmp = versionCmp(appVersion, min);
  if (cmp == null) return false;
  return cmp >= 0;
}
