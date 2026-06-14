import { IconClock } from "../icons";
import "./ImportIndicator.css";

interface ImportIndicatorProps {
  /** Full motion for the track currently being processed. */
  emphasized?: boolean;
  /** In-flow layout (e.g. track list rows) instead of absolute positioning. */
  inline?: boolean;
}

export function ImportIndicator({
  emphasized = true,
  inline = false,
}: ImportIndicatorProps) {
  return (
    <span
      className={[
        "import-indicator-slot",
        inline && "import-indicator-slot--inline",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden
    >
      {emphasized ? (
        <span className="import-indicator">
          <span className="import-indicator__page">
            <span className="import-indicator__scanned" />
            <span className="import-indicator__line" />
            <span className="import-indicator__line" />
            <span className="import-indicator__line import-indicator__line--short" />
            <span className="import-indicator__scanner" />
          </span>
        </span>
      ) : (
        <IconClock className="import-indicator__clock" />
      )}
    </span>
  );
}
