const STORAGE_KEY = 'adminToken'

export function getToken(): string {
  return sessionStorage.getItem(STORAGE_KEY)?.trim() || ''
}

export function setToken(token: string): void {
  sessionStorage.setItem(STORAGE_KEY, token.trim())
}

export function clearToken(): void {
  sessionStorage.removeItem(STORAGE_KEY)
}
