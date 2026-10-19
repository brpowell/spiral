import { useCallback, useEffect, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { BASE } from '../constants'
import {
  ApiError,
  listAdminItems,
  purgeItem,
  purgeVersion,
  unyankVersion,
  yankVersion,
} from '../api'
import { PurgeDialog } from '../components/PurgeDialog'
import { StatusBar } from '../components/StatusBar'
import { usePurgeDialog, useStatus } from '../hooks'
import { formatBytes, shortSha } from '../lib/format'
import { groupItems, itemKey } from '../lib/groupItems'
import type { ItemGroup } from '../types'

type Props = {
  publisherId: string
  itemType: string
  id: string
  onUnauthorized: () => void
}

export function ItemDetailView({
  publisherId,
  itemType,
  id,
  onUnauthorized,
}: Props) {
  const { route } = useLocation()
  const itemRef = { publisherId, itemType, id }
  const key = itemKey(publisherId, itemType, id)

  const { message, kind, setStatus } = useStatus()
  const purge = usePurgeDialog()
  const [item, setItem] = useState<ItemGroup | null | undefined>(undefined)

  const refresh = useCallback(async () => {
    setStatus('Loading…')
    try {
      const data = await listAdminItems()
      const groups = groupItems(data.versions || [])
      const found = groups.find((g) => g.key === key) || null
      setItem(found)
      if (!found) {
        setStatus(`Item ${key} not found.`, 'err')
      } else {
        setStatus(`Loaded ${found.versions.length} version(s).`, 'ok')
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorized()
        return
      }
      setStatus(String((e as Error).message || e), 'err')
    }
  }, [onUnauthorized, key, setStatus])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function onYank(version: string, yanked: boolean) {
    try {
      if (yanked) {
        await unyankVersion(itemRef, version)
        setStatus(`Unyanked ${key}@${version}`, 'ok')
      } else {
        await yankVersion(itemRef, version)
        setStatus(`Yanked ${key}@${version}`, 'ok')
      }
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
      <p class="muted">
        <button
          type="button"
          class="secondary"
          onClick={() => route(`${BASE}/`)}
        >
          ← All items
        </button>
      </p>

      <section>
        <div class="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ marginTop: 0, marginBottom: '0.25rem' }}>
              {item?.previewUrl ? (
                <img
                  src={item.previewUrl}
                  alt=""
                  width={32}
                  height={32}
                  style={{
                    borderRadius: 4,
                    verticalAlign: 'middle',
                    marginRight: '0.5rem',
                    objectFit: 'cover',
                  }}
                />
              ) : null}
              <code>{item?.effectiveId ?? key}</code>
            </h2>
            {item ? (
              <p class="muted" style={{ margin: 0 }}>
                {item.name} · {item.itemType}
              </p>
            ) : null}
          </div>
          <div class="row">
            <button type="button" class="secondary" onClick={() => void refresh()}>
              Refresh
            </button>
            {item ? (
              <button
                type="button"
                class="danger"
                onClick={() =>
                  purge.openPurge({
                    confirm: key,
                    onConfirm: async (confirm, reason) => {
                      try {
                        await purgeItem(itemRef, confirm, reason)
                        setStatus(`Purged ${key}`, 'ok')
                        route(`${BASE}/`)
                      } catch (err) {
                        if (err instanceof ApiError && err.status === 401) {
                          onUnauthorized()
                          return
                        }
                        setStatus(String((err as Error).message || err), 'err')
                      }
                    },
                  })
                }
              >
                Purge item
              </button>
            ) : null}
          </div>
        </div>

        {item === undefined ? (
          <p class="muted">Loading…</p>
        ) : item === null ? (
          <p class="muted">This item has no versions (or was purged).</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Artifact</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {item.versions.map((v) => {
                const yanked = !!v.yankedAt
                const label = `${key}@${v.version}`
                return (
                  <tr key={v.version}>
                    <td>
                      <code>{v.version}</code>
                    </td>
                    <td>
                      {yanked ? (
                        <span class="badge yanked">yanked</span>
                      ) : (
                        <span class="badge live">live</span>
                      )}
                    </td>
                    <td class="muted">
                      {formatBytes(v.sizeBytes || 0)}
                      <br />
                      <code style={{ fontSize: '0.7rem' }}>
                        {shortSha(v.sha256 || '')}
                      </code>
                    </td>
                    <td class="actions">
                      <button
                        type="button"
                        class="secondary"
                        onClick={() => void onYank(v.version, yanked)}
                      >
                        {yanked ? 'Unyank' : 'Yank'}
                      </button>
                      <button
                        type="button"
                        class="danger"
                        onClick={() =>
                          purge.openPurge({
                            confirm: label,
                            onConfirm: async (confirm, reason) => {
                              try {
                                await purgeVersion(
                                  itemRef,
                                  v.version,
                                  confirm,
                                  reason,
                                )
                                setStatus(`Purged ${label}`, 'ok')
                                await refresh()
                              } catch (err) {
                                if (
                                  err instanceof ApiError &&
                                  err.status === 401
                                ) {
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
                        Purge version
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
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
