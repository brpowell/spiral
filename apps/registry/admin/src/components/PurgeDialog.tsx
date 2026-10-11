import type { JSX, RefObject } from 'preact'

type Props = {
  confirmHint: string
  onSubmitCapture: JSX.SubmitEventHandler<HTMLFormElement>
  dialogRef: RefObject<HTMLDialogElement>
}

export function PurgeDialog({
  confirmHint,
  onSubmitCapture,
  dialogRef,
}: Props) {
  return (
    <dialog ref={dialogRef} id="purgeDialog">
      <form method="dialog" onSubmitCapture={onSubmitCapture}>
        <h2 style={{ marginTop: 0 }}>Purge (hard delete)</h2>
        <p class="muted">
          This permanently deletes stored bytes. Confirm must be exactly:{' '}
          <code>{confirmHint}</code>
        </p>
        <label for="purgeConfirm">Type confirm string</label>
        <input
          id="purgeConfirm"
          name="confirm"
          type="text"
          required
          autocomplete="off"
        />
        <label for="purgeReason">Reason</label>
        <textarea id="purgeReason" name="reason" required />
        <div class="row">
          <button type="submit" class="danger" value="ok">
            Purge
          </button>
          <button type="submit" class="secondary" value="cancel" formnovalidate>
            Cancel
          </button>
        </div>
      </form>
    </dialog>
  )
}
