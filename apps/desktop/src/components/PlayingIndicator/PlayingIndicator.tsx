import "./PlayingIndicator.css";

interface PlayingIndicatorProps {
  active?: boolean;
  /** In-flow layout (e.g. track list rows) instead of absolute positioning. */
  inline?: boolean;
}

export function PlayingIndicator({
  active = true,
  inline = false,
}: PlayingIndicatorProps) {
  if (!active) return null;

  return (
    <span
      className={[
        "playing-indicator-slot",
        inline && "playing-indicator-slot--inline",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden
    >
      <span className="playing-indicator">
        <span className="playing-indicator__bar" />
        <span className="playing-indicator__bar" />
        <span className="playing-indicator__bar" />
        <span className="playing-indicator__bar" />
      </span>
    </span>
  );
}
