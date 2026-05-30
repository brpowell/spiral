import "./Chip.css";

export type ChipProps = {
  label: string;
  onRemove: () => void;
  disabled?: boolean;
};

export function Chip({ label, onRemove, disabled }: ChipProps) {
  return (
    <span className="chip" role="listitem">
      <span className="chip__label">{label}</span>
      <button
        type="button"
        className="chip__remove"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`Remove ${label}`}
      >
        ×
      </button>
    </span>
  );
}
