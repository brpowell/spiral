import type { AdminVersionSummary, ItemGroup } from '../types'

export function itemKey(publisherId: string, itemType: string, id: string): string {
  return `${publisherId}/${itemType}/${id}`
}

/** Group flat admin versions into items (newest version first within each item). */
export function groupItems(versions: AdminVersionSummary[]): ItemGroup[] {
  const map = new Map<string, AdminVersionSummary[]>()
  for (const v of versions) {
    const key = itemKey(v.publisherId, v.itemType, v.id)
    const list = map.get(key) || []
    list.push(v)
    map.set(key, list)
  }

  const groups: ItemGroup[] = []
  for (const [key, list] of map) {
    list.sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
    const latest = list[0]
    groups.push({
      publisherId: latest.publisherId,
      itemType: latest.itemType,
      id: latest.id,
      key,
      effectiveId: latest.effectiveId,
      name: latest.name,
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
