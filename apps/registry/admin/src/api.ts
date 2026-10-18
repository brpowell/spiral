import { clearToken, getToken } from './auth'
import { API_BASE } from './constants'
import type { AdminItemListResponse, VersionDetailResponse } from './types'

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

/** Identity of one item (the URL segments after the API base). */
export type ItemRef = { publisherId: string; itemType: string; id: string }

function itemPath(ref: ItemRef): string {
  return `${API_BASE}/${ref.publisherId}/${ref.itemType}/${ref.id}`
}

export function listAdminItems(): Promise<AdminItemListResponse> {
  return api(API_BASE)
}

export function uploadItem(file: File): Promise<VersionDetailResponse> {
  const fd = new FormData()
  fd.append('spk', file)
  return api(API_BASE, { method: 'POST', body: fd })
}

export function yankVersion(ref: ItemRef, version: string): Promise<unknown> {
  return api(`${itemPath(ref)}/versions/${version}/yank`, { method: 'POST' })
}

export function unyankVersion(ref: ItemRef, version: string): Promise<unknown> {
  return api(`${itemPath(ref)}/versions/${version}/unyank`, { method: 'POST' })
}

export function purgeVersion(
  ref: ItemRef,
  version: string,
  confirm: string,
  reason: string,
): Promise<unknown> {
  return api(`${itemPath(ref)}/versions/${version}/purge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm, reason }),
  })
}

export function purgeItem(
  ref: ItemRef,
  confirm: string,
  reason: string,
): Promise<unknown> {
  return api(`${itemPath(ref)}/purge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirm, reason }),
  })
}
