import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

export type StatusKind = 'ok' | 'err' | 'info' | null

export function useStatus() {
  const [message, setMessage] = useState('')
  const [kind, setKind] = useState<StatusKind>(null)

  const setStatus = useCallback((msg: string, next: StatusKind = 'info') => {
    setMessage(msg)
    setKind(msg ? next : null)
  }, [])

  return { message, kind, setStatus }
}

type PurgeTarget = {
  confirm: string
  onConfirm: (confirm: string, reason: string) => Promise<void>
}

export function usePurgeDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [confirmHint, setConfirmHint] = useState('')
  const pendingRef = useRef<PurgeTarget | null>(null)
  const fieldsRef = useRef({ confirm: '', reason: '' })

  const openPurge = useCallback((next: PurgeTarget) => {
    pendingRef.current = next
    setConfirmHint(next.confirm)
    fieldsRef.current = { confirm: '', reason: '' }
    dialogRef.current?.querySelector('form')?.reset()
    dialogRef.current?.showModal()
  }, [])

  const onSubmitCapture = useCallback((e: Event) => {
    const form = e.target as HTMLFormElement
    const submitter = (e as SubmitEvent).submitter as HTMLButtonElement | null
    if (!pendingRef.current || !submitter || submitter.value !== 'ok') return
    const fd = new FormData(form)
    fieldsRef.current = {
      confirm: String(fd.get('confirm') || '').trim(),
      reason: String(fd.get('reason') || '').trim(),
    }
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const onClose = () => {
      if (dialog.returnValue !== 'ok' || !pendingRef.current) {
        pendingRef.current = null
        return
      }
      const t = pendingRef.current
      pendingRef.current = null
      const { confirm, reason } = fieldsRef.current
      void t.onConfirm(confirm, reason)
    }

    dialog.addEventListener('close', onClose)
    return () => dialog.removeEventListener('close', onClose)
  }, [])

  return {
    dialogRef,
    confirmHint,
    openPurge,
    onSubmitCapture,
  }
}
