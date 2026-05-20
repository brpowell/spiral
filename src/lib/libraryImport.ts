import { importPaths } from "./import";
import { waitForPaint, yieldToMain } from "./scheduling";
import { scanFolder } from "./tauri";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";
import { useLibrarySettingsStore } from "../store/useLibrarySettingsStore";
import { usePlayerStore } from "../store/usePlayerStore";

async function resolveImportPaths(
  paths: string[],
  onProgress?: (current: number, total: number) => void,
): Promise<string[]> {
  const resolved: string[] = [];
  const total = paths.length;

  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    try {
      const scanned = await scanFolder(path);
      resolved.push(...scanned);
    } catch {
      resolved.push(path);
    }
    onProgress?.(i + 1, total);
    await yieldToMain();
  }

  return resolved;
}

export function startLibraryImport(paths: string[]): void {
  if (paths.length === 0) return;

  usePlayerStore.setState({ importError: null });

  useBackgroundTasksStore.getState().runInBackground({
    key: "library-import",
    label: "Importing library…",
    run: async (ctx) => {
      ctx.setLabel("Scanning files…");
      const audioPaths = await resolveImportPaths(paths, (current, total) => {
        ctx.setProgress(current, total);
      });

      if (audioPaths.length === 0) {
        ctx.setDetail("No audio files found");
        return;
      }

      ctx.clearProgress();
      ctx.setLabel(
        audioPaths.length === 1
          ? "Importing 1 track…"
          : `Importing ${audioPaths.length} tracks…`,
      );

      const settingsStore = useLibrarySettingsStore.getState();
      const settings =
        settingsStore.settings ?? (await settingsStore.loadSettings());
      let importMode: "copy" | "reference";
      try {
        importMode = await settingsStore.resolveImportMode();
      } catch {
        ctx.setDetail("Import cancelled");
        return;
      }

      await waitForPaint();
      await yieldToMain();

      const result = await importPaths(audioPaths, {
        mode: importMode,
        settings,
        onProgress: (current, total) => ctx.setProgress(current, total),
      });

      await usePlayerStore.getState().loadLibrary({ preservePlayback: true });

      if (result.imported > 0) {
        ctx.setLabel(
          result.imported === 1
            ? "Imported 1 track"
            : `Imported ${result.imported} tracks`,
        );
      } else if (audioPaths.length > 0) {
        ctx.setLabel("Import finished");
      }

      if (result.failed > 0) {
        usePlayerStore.setState({
          importError: `Imported ${result.imported}, failed ${result.failed}. ${result.errors[0] ?? ""}`,
        });
        if (result.imported === 0) {
          throw new Error(result.errors[0] ?? "Import failed");
        }
      }
    },
  });
}
