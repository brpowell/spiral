import { LocationProvider, Route, Router, useLocation } from 'preact-iso'
import { useCallback, useEffect, useState } from 'preact/hooks'
import { clearToken, getToken } from './auth'
import { BASE } from './constants'
import { LoginView } from './views/LoginView'
import { PackDetailView } from './views/PackDetailView'
import { PackListView } from './views/PackListView'

function Shell({
  onLogout,
  children,
}: {
  onLogout: () => void
  children: preact.ComponentChildren
}) {
  return (
    <main>
      <header class="app-header">
        <h1>
          <a href={`${BASE}/`} class="brand">
            SPK Registry Admin
          </a>
        </h1>
        <button type="button" class="secondary" onClick={onLogout}>
          Log out
        </button>
      </header>
      {children}
    </main>
  )
}

function RedirectHome() {
  const { route } = useLocation()
  useEffect(() => {
    route(`${BASE}/`, true)
  }, [route])
  return <p class="muted">Redirecting…</p>
}

function AuthedApp({ onUnauthorized }: { onUnauthorized: () => void }) {
  return (
    <LocationProvider scope={BASE}>
      <Shell onLogout={onUnauthorized}>
        <Router>
          <Route
            path={BASE}
            component={() => <PackListView onUnauthorized={onUnauthorized} />}
          />
          <Route
            path={`${BASE}/packs/:authorId/:packId`}
            component={(p: { authorId: string; packId: string }) => (
              <PackDetailView
                authorId={p.authorId}
                packId={p.packId}
                onUnauthorized={onUnauthorized}
              />
            )}
          />
          <Route default component={RedirectHome} />
        </Router>
      </Shell>
    </LocationProvider>
  )
}

export function App() {
  const [authed, setAuthed] = useState(() => !!getToken())

  const logout = useCallback(() => {
    clearToken()
    setAuthed(false)
    const path = window.location.pathname.replace(/\/+$/, '') || '/'
    if (path !== BASE) {
      window.history.replaceState(null, '', `${BASE}/`)
    }
  }, [])

  if (!authed) {
    return (
      <LoginView
        onLoggedIn={() => {
          setAuthed(true)
          window.history.replaceState(null, '', `${BASE}/`)
        }}
      />
    )
  }

  return <AuthedApp onUnauthorized={logout} />
}
