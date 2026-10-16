import { useCallback, useEffect, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { BASE } from '../constants'
import {
  ApiError,
  listAdminPacks,
  purgePack,
  purgeVersion,
  unyankVersion,
  yankVersion,
} from '../api'
import { PurgeDialog } from '../components/PurgeDialog'
import { StatusBar } from '../components/StatusBar'
import { usePurgeDialog, useStatus } from '../hooks'
import { formatBytes, shortSha } from '../lib/format'
import { groupPacks } from '../lib/groupPacks'
import type { PackGroup } from '../types'

type Props = {
  publisherId: string
  packId: string
  onUnauthorized: () => void
}

export function PackDetailView({
  publisherId,
  packId,
  onUnauthorized,
}: Props) {
  const { route } = useLocation()
  const packKey = `${publisherId}/${packId}`

  const { message, kind, setStatus } = useStatus()
  const purge = usePurgeDialog()
  const [pack, setPack] = useState<PackGroup | null | undefined>(undefined)

  const refresh = useCallback(async () => {
    setStatus('Loading…')
    try {
      const data = await listAdminPacks()
      const groups = groupPacks(data.versions || [])
      const found = groups.find((g) => g.key === packKey) || null
      setPack(found)
      if (!found) {
        setStatus(`Pack ${packKey} not found.`, 'err')
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
  }, [onUnauthorized, packKey, setStatus])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function onYank(version: string, yanked: boolean) {
    try {
      if (yanked) {
        await unyankVersion(publisherId, packId, version)
        setStatus(`Unyanked ${packKey}@${version}`, 'ok')
      } else {
        await yankVersion(publisherId, packId, version)
        setStatus(`Yanked ${packKey}@${version}`, 'ok')
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
          ← All packs
        </button>
      </p>

      <section>
        <div class="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ marginTop: 0, marginBottom: '0.25rem' }}>
              {pack?.previewUrl ? (
                <img
                  src={pack.previewUrl}
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
              <code>{packKey}</code>
            </h2>
            {pack ? (
              <p class="muted" style={{ margin: 0 }}>
                {pack.name}
                {pack.contributionTypes.length
                  ? ` · ${pack.contributionTypes.join(', ')}`
                  : ''}
              </p>
            ) : null}
          </div>
          <div class="row">
            <button type="button" class="secondary" onClick={() => void refresh()}>
              Refresh
            </button>
            {pack ? (
              <button
                type="button"
                class="danger"
                onClick={() =>
                  purge.openPurge({
                    confirm: packKey,
                    onConfirm: async (confirm, reason) => {
                      try {
                        await purgePack(publisherId, packId, confirm, reason)
                        setStatus(`Purged ${packKey}`, 'ok')
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
                Purge pack
              </button>
            ) : null}
          </div>
        </div>

        {pack === undefined ? (
          <p class="muted">Loading…</p>
        ) : pack === null ? (
          <p class="muted">This pack has no versions (or was purged).</p>
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
              {pack.versions.map((v) => {
                const yanked = !!v.yankedAt
                const id = `${packKey}@${v.version}`
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
                            confirm: id,
                            onConfirm: async (confirm, reason) => {
                              try {
                                await purgeVersion(
                                  publisherId,
                                  packId,
                                  v.version,
                                  confirm,
                                  reason,
                                )
                                setStatus(`Purged ${id}`, 'ok')
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
