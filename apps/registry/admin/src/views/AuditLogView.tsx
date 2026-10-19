import { useCallback, useEffect, useState } from 'preact/hooks'
import { ApiError, listAudit } from '../api'
import { StatusBar } from '../components/StatusBar'
import { useStatus } from '../hooks'
import type { AuditListResponse } from '../types'

const PAGE_SIZE = 50
const ACTIONS = [
  'upload',
  'yank',
  'unyank',
  'purge_version',
  'purge_item',
  'list_items',
  'read_audit',
  'unknown',
]

type Props = {
  onUnauthorized: () => void
}

function target(e: AuditListResponse['entries'][number]): string {
  if (!e.publisherId) return '—'
  const item = `${e.publisherId}/${e.itemType ?? '?'}/${e.itemId ?? '?'}`
  return e.version ? `${item}@${e.version}` : item
}

export function AuditLogView({ onUnauthorized }: Props) {
  const { message, kind, setStatus } = useStatus()
  const [data, setData] = useState<AuditListResponse | null>(null)
  const [action, setAction] = useState('')
  const [publisher, setPublisher] = useState('')
  const [id, setId] = useState('')
  const [offset, setOffset] = useState(0)

  const load = useCallback(async () => {
    setStatus('Loading…')
    try {
      const res = await listAudit({
        action,
        publisher: publisher.trim(),
        id: id.trim(),
        limit: PAGE_SIZE,
        offset,
      })
      setData(res)
      setStatus(`${res.total} entr${res.total === 1 ? 'y' : 'ies'}.`, 'ok')
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        onUnauthorized()
        return
      }
      setStatus(String((e as Error).message || e), 'err')
    }
  }, [action, publisher, id, offset, onUnauthorized, setStatus])

  useEffect(() => {
    void load()
  }, [load])

  const total = data?.total ?? 0

  return (
    <section>
      <div class="row" style={{ justifyContent: 'space-between' }}>
        <h2 style={{ marginTop: 0, marginBottom: 0 }}>Audit log</h2>
        <button type="button" class="secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <p class="muted">
        Admin actions that change state, and refused attempts, newest first.
        Tokens are never recorded.
      </p>
      <div class="row filter-row">
        <div>
          <label for="auditAction">Action</label>
          <select
            id="auditAction"
            value={action}
            onChange={(e) => {
              setOffset(0)
              setAction((e.target as HTMLSelectElement).value)
            }}
          >
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label for="auditPublisher">Publisher</label>
          <input
            id="auditPublisher"
            type="search"
            value={publisher}
            onInput={(e) => {
              setOffset(0)
              setPublisher((e.target as HTMLInputElement).value)
            }}
          />
        </div>
        <div class="grow">
          <label for="auditId">Item id</label>
          <input
            id="auditId"
            type="search"
            value={id}
            onInput={(e) => {
              setOffset(0)
              setId((e.target as HTMLInputElement).value)
            }}
          />
        </div>
      </div>
      <StatusBar message={message} kind={kind} />
      {data === null ? null : data.entries.length === 0 ? (
        <p class="muted">No entries.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Target</th>
              <th>Outcome</th>
              <th>Reason</th>
              <th>IP</th>
            </tr>
          </thead>
          <tbody>
            {data.entries.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.at).toLocaleString()}</td>
                <td>{e.actor}</td>
                <td>{e.action}</td>
                <td>
                  <code>{target(e)}</code>
                </td>
                <td>{e.outcome}</td>
                <td>{e.reason ?? ''}</td>
                <td>{e.clientIp ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div class="row">
        <button
          type="button"
          class="secondary"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          Newer
        </button>
        <button
          type="button"
          class="secondary"
          disabled={offset + PAGE_SIZE >= total}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Older
        </button>
      </div>
    </section>
  )
}
