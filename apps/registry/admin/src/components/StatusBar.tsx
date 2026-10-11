import type { StatusKind } from '../hooks'

type Props = {
  message: string
  kind: StatusKind
}

export function StatusBar({ message, kind }: Props) {
  if (!message) return null
  const cls = kind === 'ok' ? 'ok' : kind === 'err' ? 'err' : ''
  return (
    <div id="status" class={cls}>
      {message}
    </div>
  )
}
