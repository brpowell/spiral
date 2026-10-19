/**
 * Where the server mounts the panel (`ADMIN_PATH`). The server injects it into index.html as
 * `<meta name="admin-base">`; the fallback is the default, used by `npm run dev`.
 */
function readBase(): string {
  const meta = document.querySelector('meta[name="admin-base"]')
  const value = meta?.getAttribute('content')?.trim()
  return value ? value.replace(/\/+$/, '') : '/admin'
}

export const BASE = readBase()

/** Prefix of the admin JSON API. */
export const API_BASE = `${BASE}/api/items`
