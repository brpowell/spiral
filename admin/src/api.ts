import { clearToken, getToken } from './auth'
import type {
  AdminPackListResponse,
  VersionDetailResponse,
} from './types'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

type ApiOptions = Omit<RequestInit, 'headers'> & {
  headers?: Record<string, string>
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers || {}) }
  const token = getToken()
  if (!token) throw new ApiError(401, 'Admin token required')
  headers.Authorization = `Bearer ${token}`

  const res = await fetch(path, { ...opts, headers })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = { message: text }
  }

  if (!res.ok) {
    if (res.status === 401) clearToken()
    const obj = body as { message?: string; code?: string } | null
    const msg = obj?.message || obj?.code || res.statusText
    throw new ApiError(res.status, `${res.status} ${msg}`)
  }

  return body as T
}

export function listAdminPacks(): Promise<AdminPackListResponse> {
  return api('/v1/rgad/packs')
}

export function uploadPack(file: File): Promise<VersionDetailResponse> {
  const fd = new FormData()
  fd.append('spk', file)
  return api('/v1/rgad/packs', { method: 'POST', body: fd })
}

export function yankVersion(
  authorId: string,
  packId: string,
  version: string,
): Promise<unknown> {
  return api(
    `/v1/rgad/packs/${authorId}/${packId}/versions/${version}/yank`,
    { method: 'POST' },
  )
}

export function unyankVersion(
  authorId: string,
  packId: string,
  version: string,
): Promise<unknown> {
  return api(
    `/v1/rgad/packs/${authorId}/${packId}/versions/${version}/unyank`,
    { method: 'POST' },
  )
}

export function purgeVersion(
  authorId: string,
  packId: string,
  version: string,
  confirm: string,
  reason: string,
): Promise<unknown> {
  return api(
    `/v1/rgad/packs/${authorId}/${packId}/versions/${version}/purge`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm, reason }),
    },
  )
}

export function purgePack(
  authorId: string,
  packId: string,
  confirm: string,
  reason: string,
): Promise<unknown> {
  return api(`/v1/rgad/packs/${authorId}/${packId}/purge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm, reason }),
  })
}
