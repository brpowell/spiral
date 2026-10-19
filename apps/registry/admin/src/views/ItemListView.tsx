import { useCallback, useEffect, useMemo, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { BASE } from '../constants'
import { ApiError, listAdminItems, purgeItem, uploadItem } from '../api'
import { PurgeDialog } from '../components/PurgeDialog'
import { StatusBar } from '../components/StatusBar'
import { usePurgeDialog, useStatus } from '../hooks'
import { groupItems } from '../lib/groupItems'
import { ITEM_TYPES, type ItemGroup } from '../types'

type Props = {
  onUnauthorized: () => void
}

export function ItemListView({ onUnauthorized }: Props) {
  const { route } = useLocation()
  const { message, kind, setStatus } = useStatus()
  const purge = usePurgeDialog()
  const [items, setItems] = useState<ItemGroup[] | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [typeFilter, setTypeFilter] = useState('')
  const [query, setQuery] = useState('')

  const refresh = useCallback(async () => {
    setStatus('Loading…')
    try {
      const data = await listAdminItems()
      const groups = groupItems(data.versions || [])
      setItems(groups)
      setStatus(
        groups.length ? `Loaded ${groups.length} item(s).` : 'Empty catalog.',
        'ok',
      )
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorized()
        return
      }
      setStatus(String((e as Error).message || e), 'err')
    }
  }, [onUnauthorized, setStatus])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (items || []).filter(
      (g) =>
        (!typeFilter || g.itemType === typeFilter) &&
        (!needle ||
          g.effectiveId.toLowerCase().includes(needle) ||
          g.name.toLowerCase().includes(needle)),
    )
  }, [items, typeFilter, query])

  async function onUpload() {
    if (!file) {
      setStatus('Choose a .spk file first.', 'err')
      return
    }
    try {
      setStatus('Uploading…')
      const body = await uploadItem(file)
      const previewNote = body.previewUrl ? ` · preview ${body.previewUrl}` : ''
      setStatus(
        `Published ${body.effectiveId}@${body.version} (sha256 ${body.sha256.slice(0, 12)}…)${previewNote}`,
        'ok',
      )
      setFile(null)
      await refresh()
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorized()
        return
      }
      setStatus(String((e as Error).message || e), 'err')
    }
  }

  return (
    <>
      <section>
        <h2 style={{ marginTop: 0 }}>Upload item</h2>
        <label for="spk">.spk archive</label>
        <input
          id="spk"
          type="file"
          accept=".spk,application/zip"
          onChange={(e) =>
            setFile((e.target as HTMLInputElement).files?.[0] || null)
          }
        />
        <p class="muted">
          One theme, skin, visualizer or sound per archive. Its identity and
          version come from the item manifest (<code>theme.json</code>,{' '}
          <code>skin.json</code>, <code>viz.json</code> or{' '}
          <code>sound.json</code>), and the preview from its{' '}
          <code>preview</code> field — no separate upload.
        </p>
        <button type="button" onClick={() => void onUpload()}>
          Upload
        </button>
      </section>

      <section>
        <div class="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>Items</h2>
          <button type="button" class="secondary" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        <div class="row filter-row">
          <div>
            <label for="typeFilter">Type</label>
            <select
              id="typeFilter"
              value={typeFilter}
              onChange={(e) =>
                setTypeFilter((e.target as HTMLSelectElement).value)
              }
            >
              <option value="">All types</option>
              {ITEM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          <div class="grow">
            <label for="itemQuery">Search</label>
            <input
              id="itemQuery"
              type="search"
              placeholder="id or name"
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
          </div>
        </div>
        {items === null ? (
          <p class="muted">Loading…</p>
        ) : items.length === 0 ? (
          <p class="muted">No items yet.</p>
        ) : visible.length === 0 ? (
          <p class="muted">No items match.</p>
        ) : (
          <div class="item-grid">
            {visible.map((g) => (
              <article class="item-card" key={g.key}>
                <div class="item-card-top">
                  {g.previewUrl ? (
                    <img src={g.previewUrl} alt="" width={40} height={40} />
                  ) : (
                    <div class="item-card-placeholder" />
                  )}
                  <div>
                    <code>{g.effectiveId}</code>
                    <div class="muted">{g.name}</div>
                  </div>
                </div>
                <div class="muted item-card-meta">
                  <span class="badge type">{g.itemType}</span>
                  <br />
                  {g.versions.length} version(s) · {g.liveCount} live
                  {g.yankedCount ? ` · ${g.yankedCount} yanked` : ''}
                  <br />
                  latest {g.latest.version}
                </div>
                <div class="row item-card-actions">
                  <button
                    type="button"
                    class="secondary"
                    onClick={() =>
                      route(
                        `${BASE}/items/${g.publisherId}/${g.itemType}/${g.id}`,
                      )
                    }
                  >
                    Manage versions
                  </button>
                  <button
                    type="button"
                    class="danger"
                    onClick={() =>
                      purge.openPurge({
                        confirm: g.key,
                        onConfirm: async (confirm, reason) => {
                          try {
                            await purgeItem(g, confirm, reason)
                            setStatus(`Purged ${g.key}`, 'ok')
                            await refresh()
                          } catch (err) {
                            if (err instanceof ApiError && err.status === 401) {
                              onUnauthorized()
                              return
                            }
                            setStatus(
                              String((err as Error).message || err),
                              'err',
                            )
                          }
                        },
                      })
                    }
                  >
                    Purge item
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <StatusBar message={message} kind={kind} />

      <PurgeDialog
        confirmHint={purge.confirmHint}
        onSubmitCapture={purge.onSubmitCapture}
        dialogRef={purge.dialogRef}
      />
    </>
  )
}
