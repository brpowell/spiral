import { Channel, convertFileSrc } from "@tauri-apps/api/core";
import { t } from "./i18n";
import { createOperationId } from "./activityLog";
import { BackgroundTaskCancelledError } from "./backgroundTaskCancel";
import {
  cancelItemDownload,
  clearItemDownloadCancel,
  fetchItemCatalog,
  fetchRegistryItem,
  fetchRegistryItemVersion,
  installItemFromRegistry,
  itemMeetsMinAppVersion,
  listItems,
  resolveRegistryItemPreview,
  type InstallItemResult,
} from "./tauri";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import type {
  CatalogItemEntry,
  ItemCatalogQuery,
  ItemDownloadProgress,
  RegistryItemDetail,
  RegistryItemList,
  RegistryItemSummary,
  RegistryVersionDetail,
  RegistryVersionSummary,
} from "../types/itemRegistry";
import { catalogItemName } from "../types/itemRegistry";
import {
  logRegistryInstallFailure,
  logRegistryInstallSuccess,
} from "./packs/packInstallActivity";
import { refreshPackContributionStores } from "./packs/refreshPackStores";
import { createRegistryCache } from "./packs/registryCache";
import { errorMessageFromUnknown } from "./cdPlaybackFailure";
import { afterUiTransition } from "./scheduling";
import {
  packDownloadFailedPayload,
  packInstalledPayload,
} from "./toastPayloads";

/** Background task key for registry item downloads (cancel wiring). */
export const ITEM_REGISTRY_DOWNLOAD_KEY = "item-registry-download";

/** Background task key for bulk item updates (cancel wiring). */
export const ITEM_UPDATES_BULK_KEY = "item-updates-bulk";

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

/** Stable key for a catalog row, including registry provenance. */
export function catalogItemKey(entry: {
  registryUrl: string;
  effectiveId: string;
}): string {
  return `${entry.registryUrl}:${entry.effectiveId}`;
}

export type FetchItemCatalogResult =
  { ok: true; catalog: RegistryItemList } | { ok: false; error: string };

type FetchRegistryItemVersionResult =
  { ok: true; detail: RegistryVersionDetail } | { ok: false; error: string };

type FetchRegistryItemResult =
  { ok: true; detail: RegistryItemDetail } | { ok: false; error: string };

/** The catalog changes when items publish; keep it fairly fresh. */
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000;
/** New versions can appear for an item, but rarely mid-session. */
const ITEM_DETAIL_CACHE_TTL_MS = 5 * 60 * 1000;
/** A published version's README / changelog is immutable. */
const VERSION_DETAIL_CACHE_TTL_MS = 30 * 60 * 1000;

const catalogCache = createRegistryCache<FetchItemCatalogResult>({
  ttlMs: CATALOG_CACHE_TTL_MS,
  maxEntries: 50,
  // A partial success is not cached so the unreachable registry is retried.
  cacheable: (r) => r.ok && (r.catalog.errors?.length ?? 0) === 0,
});
const itemDetailCache = createRegistryCache<FetchRegistryItemResult>({
  ttlMs: ITEM_DETAIL_CACHE_TTL_MS,
});
const versionDetailCache = createRegistryCache<FetchRegistryItemVersionResult>({
  ttlMs: VERSION_DETAIL_CACHE_TTL_MS,
});

/** Drop every cached registry response (e.g. after the registry list changes). */
export function invalidateRegistryCaches(): void {
  catalogCache.clear();
  itemDetailCache.clear();
  versionDetailCache.clear();
}

function registryErrorMessage(err: unknown): string {
  return typeof err === "string" && err.trim()
    ? err
    : err instanceof Error && err.message.trim()
      ? err.message
      : t("toasts:packs.catalogFailed");
}

/** Cache key for a catalog page: filters and paging, in a fixed order. */
export function catalogCacheKey(query?: ItemCatalogQuery): string {
  return [
    [...(query?.itemTypes ?? [])].sort().join(","),
    query?.q?.trim() ?? "",
    query?.publisherId ?? "",
    query?.sort ?? "",
    query?.limit ?? "",
    query?.offset ?? "",
  ].join("\0");
}

type ItemRef = {
  registryUrl: string;
  publisherId: string;
  itemType: string;
  id: string;
};

function itemCacheKey(args: ItemRef): string {
  return [args.registryUrl, args.publisherId, args.itemType, args.id].join(
    "\0",
  );
}

function versionCacheKey(args: ItemRef & { version: string }): string {
  return `${itemCacheKey(args)}\0${args.version}`;
}

/** Cached catalog page when still fresh (no network). */
export function peekItemCatalog(
  query?: ItemCatalogQuery,
): FetchItemCatalogResult | undefined {
  return catalogCache.peek(catalogCacheKey(query));
}

/**
 * Fetch one catalog page from every configured registry.
 *
 * - Full failure (no items and at least one error) → `{ ok: false }` for the empty/error UI.
 * - Partial success (some registries failed) → `{ ok: true }` with `catalog.errors` populated.
 *
 * Successful results are cached briefly; pass `force: true` to bypass (manual refresh).
 * Partial results are not cached so the missing registry is retried on the next call.
 */
export async function fetchItemCatalogSafe(
  query?: ItemCatalogQuery & { force?: boolean },
): Promise<FetchItemCatalogResult> {
  const { force, ...filters } = query ?? {};
  const load = async (): Promise<FetchItemCatalogResult> => {
    try {
      const catalog = await fetchItemCatalog(filters);
      const errors = catalog.errors ?? [];
      if (catalog.items.length === 0 && errors.length > 0) {
        return {
          ok: false,
          error:
            errors.map((e) => e.error).join(" · ") ||
            t("toasts:packs.catalogFailed"),
        };
      }
      return { ok: true, catalog };
    } catch (err) {
      return { ok: false, error: registryErrorMessage(err) };
    }
  };

  return catalogCache.get(catalogCacheKey(filters), load, { force });
}

/** Cached version detail when still fresh (no network). */
export function peekRegistryItemVersion(
  args: ItemRef & { version: string },
): FetchRegistryItemVersionResult | undefined {
  return versionDetailCache.peek(versionCacheKey(args));
}

/** Fetch version detail (including README) for pre-install About browsing. */
export function fetchRegistryItemVersionSafe(
  args: ItemRef & { version: string },
): Promise<FetchRegistryItemVersionResult> {
  return versionDetailCache.get(versionCacheKey(args), async () => {
    try {
      return { ok: true, detail: await fetchRegistryItemVersion(args) };
    } catch (err) {
      return { ok: false, error: registryErrorMessage(err) };
    }
  });
}

/** Fetch all published versions of an item. */
export function fetchRegistryItemSafe(
  args: ItemRef,
): Promise<FetchRegistryItemResult> {
  return itemDetailCache.get(itemCacheKey(args), async () => {
    try {
      return { ok: true, detail: await fetchRegistryItem(args) };
    } catch (err) {
      return { ok: false, error: registryErrorMessage(err) };
    }
  });
}

/** Warm the registry caches so an item's detail view opens without a loading state. */
export function prefetchItemDetail(entry: RegistryItemSummary): void {
  const ref = {
    registryUrl: entry.registryUrl,
    publisherId: entry.publisherId,
    itemType: entry.itemType,
    id: entry.id,
  };
  void fetchRegistryItemVersionSafe({
    ...ref,
    version: entry.latestVersion.version,
  });
  void fetchRegistryItemSafe(ref);
}

/**
 * Enrich catalog rows with local install state and the `minAppVersion` gate (no extra
 * registry round-trip). Installed means an item under `installed/` with the same effective id;
 * builtin and linked items do not count. Previews are fetched by Rust into the
 * registry-asset cache and exposed as `asset:` URLs (never raw registry http).
 *
 * Pass `resolvePreviews: false` to skip downloading catalog previews.
 */
export async function enrichItemCatalog(
  items: RegistryItemSummary[],
  options?: { resolvePreviews?: boolean },
): Promise<CatalogItemEntry[]> {
  const resolvePreviews = options?.resolvePreviews !== false;
  const listed = await listItems().catch(() => []);

  const installedVersions = new Map<string, string>();
  for (const item of listed) {
    if (item.zone === "installed") {
      installedVersions.set(item.effectiveId, item.version);
    }
  }

  return Promise.all(
    items.map(async (item) => {
      const latest = item.latestVersion.version;
      const installedVersion = installedVersions.get(item.effectiveId) ?? null;
      const installed = installedVersion === latest;
      const updateAvailable =
        installedVersion !== null &&
        !installed &&
        versionCmp(latest, installedVersion) === 1;

      const meetsMinAppVersion = await itemMeetsMinAppVersion(
        item.latestVersion.minAppVersion ?? null,
      );

      let resolvedPreviewUrl: string | null = null;
      const previewRel = item.latestVersion.previewUrl?.trim();
      if (resolvePreviews && previewRel) {
        const cachedPath = await resolveRegistryItemPreview({
          registryUrl: item.registryUrl,
          previewUrl: previewRel,
        }).catch(() => null);
        if (cachedPath) {
          resolvedPreviewUrl = convertFileSrc(cachedPath);
        }
      }

      return {
        ...item,
        installedVersion,
        installed,
        updateAvailable,
        meetsMinAppVersion,
        resolvedPreviewUrl,
      };
    }),
  );
}

export type InstallRegistryItemArgs = {
  registryUrl: string;
  publisherId: string;
  itemType: string;
  id: string;
  version: string;
  sha256: string;
  sizeBytes: number;
  minAppVersion?: string | null;
  /** Display name for progress/success toasts; falls back to the item id. */
  name?: string;
};

/**
 * Download + install a registry item with a BackgroundTask progress bar and single-subject
 * toasts (success, or failure + activity log). Installing a different version of an installed
 * item replaces it, which is how an update works.
 *
 * Store refresh is deferred until after settle so the progress→success morph can paint
 * before the theme/skin/visualizer/sound lists reload.
 */
export function installRegistryItem(
  args: InstallRegistryItemArgs,
): Promise<InstallItemResult | null> {
  const displayName = args.name?.trim() || args.id;

  return new Promise((resolve) => {
    useBackgroundTasksStore.getState().runInBackground({
      key: ITEM_REGISTRY_DOWNLOAD_KEY,
      label: t("toasts:packs.downloading", { name: displayName }),
      cancellable: true,
      progressDisplay: "bar",
      run: async (ctx) => {
        const operationId = createOperationId();
        await clearItemDownloadCancel();

        const onProgress = new Channel<ItemDownloadProgress>();
        onProgress.onmessage = ({ current, total }) => {
          if (total > 0) {
            ctx.setProgress(current, total);
          }
        };

        try {
          if (ctx.isCancelRequested()) {
            await cancelItemDownload();
            resolve(null);
            throw new BackgroundTaskCancelledError(
              t("toasts:packs.downloadCancelled"),
            );
          }

          const result = await installItemFromRegistry({
            registryUrl: args.registryUrl,
            publisherId: args.publisherId,
            itemType: args.itemType,
            id: args.id,
            version: args.version,
            sha256: args.sha256,
            sizeBytes: args.sizeBytes,
            minAppVersion: args.minAppVersion ?? null,
            onProgress,
          });

          logRegistryInstallSuccess({
            operationId,
            result,
            registryUrl: args.registryUrl,
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
                "Failed to refresh items after registry install:",
                err,
              );
            } finally {
              // Dynamic import avoids a circular dependency with useItemUpdatesStore.
              void import("../store/useItemUpdatesStore").then(
                ({ refreshItemUpdatesAfterInstall }) => {
                  void refreshItemUpdatesAfterInstall(result.effectiveId);
                },
              );
              resolve(result);
            }
          })();
        } catch (err) {
          const message = errorMessageFromUnknown(err);
          if (isDownloadCancelled(message)) {
            resolve(null);
            throw new BackgroundTaskCancelledError(
              t("toasts:packs.downloadCancelled"),
            );
          }
          logRegistryInstallFailure({
            operationId,
            err,
            name: displayName,
            registryUrl: args.registryUrl,
            publisherId: args.publisherId,
            itemType: args.itemType,
            id: args.id,
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

/** Install arguments for a catalog item's newest version, or a chosen one (`null` when blocked). */
export function catalogInstallArgs(
  entry: CatalogItemEntry,
  version?: RegistryVersionSummary,
): InstallRegistryItemArgs | null {
  const target = version ?? entry.latestVersion;
  if (version == null && !entry.meetsMinAppVersion) return null;
  return {
    registryUrl: entry.registryUrl,
    publisherId: entry.publisherId,
    itemType: entry.itemType,
    id: entry.id,
    version: target.version,
    sha256: target.sha256,
    sizeBytes: target.sizeBytes,
    minAppVersion: target.minAppVersion,
    name: catalogItemName(entry),
  };
}

/**
 * Install a catalog item's newest version, or a chosen one (also how an update and a
 * downgrade run). Does nothing for the newest version when the app is too old for it.
 */
export async function installCatalogEntry(
  entry: CatalogItemEntry,
  version?: RegistryVersionSummary,
): Promise<void> {
  const args = catalogInstallArgs(entry, version);
  if (args) await installRegistryItem(args);
}

export function isDownloadCancelled(message: string): boolean {
  return /item download cancelled/i.test(message);
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
