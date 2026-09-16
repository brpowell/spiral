import { Button, type ButtonProps } from "../common/Button/Button";

type EditorSaveButtonProps = Omit<ButtonProps, "variant" | "isLoading"> & {
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
      className={className}
      isLoading={saving}
      {...props}
    >
      {label}
    </Button>
  );
}
