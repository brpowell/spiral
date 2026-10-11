export type AdminVersionSummary = {
  authorId: string
  packId: string
  version: string
  name: string
  contributionTypes: string[]
  sizeBytes: number
  sha256: string
  publishedAt: string
  yankedAt?: string | null
  previewUrl?: string
}

export type AdminPackListResponse = {
  versions: AdminVersionSummary[]
}

export type VersionDetailResponse = {
  authorId: string
  packId: string
  version: string
  sha256: string
  previewUrl?: string
}

export type PackGroup = {
  authorId: string
  packId: string
  key: string
  name: string
  contributionTypes: string[]
  previewUrl?: string
  versions: AdminVersionSummary[]
  liveCount: number
  yankedCount: number
  latest: AdminVersionSummary
}
