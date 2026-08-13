import { useState } from 'preact/hooks'
import { listAdminPacks } from '../api'
import { clearToken, setToken } from '../auth'

type Props = {
  onLoggedIn: () => void
}

export function LoginView({ onLoggedIn }: Props) {
  const [token, setLocal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: Event) {
    e.preventDefault()
    const value = token.trim()
    if (!value) {
      setError('Enter an admin token.')
      return
    }
    setBusy(true)
    setError('')
    setToken(value)
    try {
      await listAdminPacks()
      onLoggedIn()
    } catch (err) {
      clearToken()
      setError(String((err as Error).message || err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main class="login-main">
      <section class="login-card">
        <form onSubmit={submit}>
          <input
            id="token"
            type="password"
            autocomplete="off"
            value={token}
            onInput={(e) => setLocal((e.target as HTMLInputElement).value)}
          />
          <button type="submit" disabled={busy}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </form>
        {error ? <p class="err-text">{error}</p> : null}
      </section>
    </main>
  )
}
