import { formatFailureDetail } from "./formatFailureDetail";
import { isMissingFileErrorDetail } from "./missingFileTrack";
import { useBackgroundTasksStore } from "../store/useBackgroundTasksStore";

export function showBulkTrackMetadataSaveToast(options: {
  total: number;
  updated: number;
  errors: string[];
}): void {
  const { total, updated, errors } = options;
  if (errors.length === 0) return;

  const missing = errors.filter(isMissingFileErrorDetail).length;

  const label =
    updated > 0
      ? `Updated ${updated} of ${total} tracks`
      : missing === total
        ? missing === 1
          ? "Track file is missing"
          : "Track files are missing"
        : "Could not save track metadata";

  useBackgroundTasksStore.getState().showErrorToast({
    key: "track-metadata-save",
    label,
    detail: formatFailureDetail(errors),
  });
}
