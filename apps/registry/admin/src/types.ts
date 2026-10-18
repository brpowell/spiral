export type ItemType = 'theme' | 'skin' | 'visualizer' | 'sound'

export const ITEM_TYPES: ItemType[] = ['theme', 'skin', 'visualizer', 'sound']

export type AdminVersionSummary = {
  publisherId: string
  itemType: string
  id: string
  effectiveId: string
  version: string
  name: string
  description: string
  minAppVersion?: string | null
  sizeBytes: number
  sha256: string
  publishedAt: string
  yankedAt?: string | null
  previewUrl?: string
}

export type AdminItemListResponse = {
  versions: AdminVersionSummary[]
}

export type VersionDetailResponse = {
  publisherId: string
  itemType: string
  id: string
  effectiveId: string
  version: string
  sha256: string
  previewUrl?: string
}

export type ItemGroup = {
  publisherId: string
  itemType: string
  id: string
  /** `publisherId/itemType/id`, the confirm string for an item-level purge. */
  key: string
  effectiveId: string
  name: string
  previewUrl?: string
  versions: AdminVersionSummary[]
  liveCount: number
  yankedCount: number
  latest: AdminVersionSummary
}
