import type { AdminVersionSummary, PackGroup } from '../types'

/** Group flat admin versions into packs (newest version first within each pack). */
export function groupPacks(versions: AdminVersionSummary[]): PackGroup[] {
  const map = new Map<string, AdminVersionSummary[]>()
  for (const v of versions) {
    const key = `${v.authorId}/${v.packId}`
    const list = map.get(key) || []
    list.push(v)
    map.set(key, list)
  }

  const groups: PackGroup[] = []
  for (const [key, list] of map) {
    list.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
    const latest = list[0]
    const types = new Set<string>()
    for (const v of list) {
      for (const t of v.contributionTypes || []) types.add(t)
    }
    groups.push({
      authorId: latest.authorId,
      packId: latest.packId,
      key,
      name: latest.name,
      contributionTypes: [...types].sort(),
      previewUrl: latest.previewUrl,
      versions: list,
      liveCount: list.filter((v) => !v.yankedAt).length,
      yankedCount: list.filter((v) => !!v.yankedAt).length,
      latest,
    })
  }

  groups.sort((a, b) => a.key.localeCompare(b.key))
  return groups
}
