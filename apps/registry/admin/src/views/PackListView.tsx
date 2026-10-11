import { useCallback, useEffect, useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { BASE } from '../constants'
import { ApiError, listAdminPacks, purgePack, uploadPack } from '../api'
import { PurgeDialog } from '../components/PurgeDialog'
import { StatusBar } from '../components/StatusBar'
import { usePurgeDialog, useStatus } from '../hooks'
import { groupPacks } from '../lib/groupPacks'
import type { PackGroup } from '../types'

type Props = {
  onUnauthorized: () => void
}

export function PackListView({ onUnauthorized }: Props) {
  const { route } = useLocation()
  const { message, kind, setStatus } = useStatus()
  const purge = usePurgeDialog()
  const [packs, setPacks] = useState<PackGroup[] | null>(null)
  const [file, setFile] = useState<File | null>(null)

  const refresh = useCallback(async () => {
    setStatus('Loading…')
    try {
      const data = await listAdminPacks()
      const groups = groupPacks(data.versions || [])
      setPacks(groups)
      setStatus(
        groups.length ? `Loaded ${groups.length} pack(s).` : 'Empty catalog.',
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

  async function onUpload() {
    if (!file) {
      setStatus('Choose a .spk file first.', 'err')
      return
    }
    try {
      setStatus('Uploading…')
      const body = await uploadPack(file)
      const previewNote = body.previewUrl ? ` · preview ${body.previewUrl}` : ''
      setStatus(
        `Published ${body.authorId}/${body.packId}@${body.version} (sha256 ${body.sha256.slice(0, 12)}…)${previewNote}`,
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
        <h2 style={{ marginTop: 0 }}>Upload pack</h2>
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
          Pack preview is taken from <code>pack.json</code> <code>preview</code>{' '}
          (or the first contribution preview when omitted) — no separate upload.
        </p>
        <button type="button" onClick={() => void onUpload()}>
          Upload
        </button>
      </section>

      <section>
        <div class="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>Packs</h2>
          <button type="button" class="secondary" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
        {packs === null ? (
          <p class="muted">Loading…</p>
        ) : packs.length === 0 ? (
          <p class="muted">No packs yet.</p>
        ) : (
          <div class="pack-grid">
            {packs.map((p) => (
              <article class="pack-card" key={p.key}>
                <div class="pack-card-top">
                  {p.previewUrl ? (
                    <img src={p.previewUrl} alt="" width={40} height={40} />
                  ) : (
                    <div class="pack-card-placeholder" />
                  )}
                  <div>
                    <code>{p.key}</code>
                    <div class="muted">{p.name}</div>
                  </div>
                </div>
                <div class="muted pack-card-meta">
                  {(p.contributionTypes || []).join(', ') || '—'}
                  <br />
                  {p.versions.length} version(s) · {p.liveCount} live
                  {p.yankedCount ? ` · ${p.yankedCount} yanked` : ''}
                  <br />
                  latest {p.latest.version}
                </div>
                <div class="row pack-card-actions">
                  <button
                    type="button"
                    class="secondary"
                    onClick={() =>
                      route(`${BASE}/packs/${p.authorId}/${p.packId}`)
                    }
                  >
                    Manage versions
                  </button>
                  <button
                    type="button"
                    class="danger"
                    onClick={() =>
                      purge.openPurge({
                        confirm: p.key,
                        onConfirm: async (confirm, reason) => {
                          try {
                            await purgePack(p.authorId, p.packId, confirm, reason)
                            setStatus(`Purged ${p.key}`, 'ok')
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
                    Purge pack
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
