import { Button, type ButtonProps } from "../common/Button/Button";
import "./EditorSaveButton.css";

type EditorSaveButtonProps = Omit<ButtonProps, "variant"> & {
  saving: boolean;
  label: string;
};

export function EditorSaveButton({
  saving,
  label,
  className,
  ...props
}: EditorSaveButtonProps) {
  return (
    <Button
      variant="primary"
      className={["editor-save-btn", className].filter(Boolean).join(" ")}
      aria-busy={saving || undefined}
      {...props}
    >
      {saving ? (
        <>
          <span className="editor-save-btn__spinner" aria-hidden />
          <span>{label}</span>
        </>
      ) : (
        label
      )}
    </Button>
  );
}
