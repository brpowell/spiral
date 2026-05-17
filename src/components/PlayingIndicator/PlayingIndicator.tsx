import "./PlayingIndicator.css";

interface PlayingIndicatorProps {
  active?: boolean;
}

export function PlayingIndicator({ active = true }: PlayingIndicatorProps) {
  if (!active) return null;

  return (
    <span className="playing-indicator-slot" aria-hidden>
      <span className="playing-indicator">
        <span className="playing-indicator__bar" />
        <span className="playing-indicator__bar" />
        <span className="playing-indicator__bar" />
        <span className="playing-indicator__bar" />
      </span>
    </span>
  );
}
