'use client'

import Link from 'next/link'
import { Panel } from '@/components/ui/Bits'
import { Empty, ErrorState, InsufficientData, Loading } from '@/components/ui/States'
import { useOrg } from '@/components/providers/OrgProvider'
import { formatDateTime } from '@/lib/format'
import { EVENT_LABELS } from '@/lib/sprint-ui'
import type { Sprint, SprintEventDoc } from '@/lib/types'

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

/** Every recorded change to the sprint's scope and progress after it started. */
export default function HistoryTab({ sprint, events, loading, error, onRetry }: { sprint: Sprint; events: SprintEventDoc[] | null; loading: boolean; error: Error | null; onRetry: () => void }) {
  const { memberName } = useOrg()
  if (sprint.status === 'planned') {
    return <Empty icon="clock" title="No history yet">History starts when the sprint starts. Until then, planning changes are not scope changes.</Empty>
  }
  // Keep showing the last history while a refresh loads.
  if (loading && !events) return <Loading />
  if (error) return <ErrorState error={error} onRetry={onRetry} />
  const list = events ?? []
  const changes = list.filter((e) => e.type !== 'sprint_started' && e.type !== 'sprint_completed')
  const added = changes.filter((e) => e.scopeDelta > 0 && (e.type === 'item_added' || e.type === 'estimate_changed')).reduce((s, e) => s + e.scopeDelta, 0)
  const removed = changes.filter((e) => e.scopeDelta < 0 && (e.type === 'item_removed' || e.type === 'estimate_changed')).reduce((s, e) => s - e.scopeDelta, 0)
  const hasStart = list.some((e) => e.type === 'sprint_started')

  return (
    <div className="stack">
      {!hasStart ? (
        <InsufficientData title="History is incomplete">
          There is no start record for this sprint. It was started before history tracking existed, so scope changes were not captured.
        </InsufficientData>
      ) : null}
      <div className="plan-totals">
        <div><div className="subtle">Committed at start</div><strong>{sprint.stats?.committedPoints ?? '-'}</strong></div>
        <div><div className="subtle">Points added</div><strong className="delta-up">{signed(added)}</strong></div>
        <div><div className="subtle">Points removed</div><strong className="delta-down">{removed ? `-${removed}` : '0'}</strong></div>
        <div><div className="subtle">Recorded changes</div><strong>{changes.length}</strong></div>
      </div>
      <Panel title="Scope-change history">
        {list.length === 0 ? (
          <Empty icon="clock" title="No events recorded">
            Every change to the points or status of a sprint item writes an entry here, in the same save as the change.
          </Empty>
        ) : (
          <ol className="timeline">
            {list.map((e) => (
              <li key={e.id}>
                <span className="subtle xsmall">{formatDateTime(e.at)}</span>
                <span className="truncate">
                  <strong>{EVENT_LABELS[e.type] ?? e.type}</strong>
                  {e.itemId ? (
                    <>
                      {' · '}
                      <Link className="text-link" href={`/item/?id=${e.itemId}`}>{e.itemKey ?? 'item'}</Link> {e.itemTitle}
                    </>
                  ) : null}
                  {e.type === 'estimate_changed' ? <span className="muted"> ({e.before ?? 0} to {e.after ?? 0} pts)</span> : null}
                  <span className="subtle xsmall"> · {e.actorId ? memberName(e.actorId) : 'System'}</span>
                </span>
                <span className="nowrap small">
                  {e.type === 'sprint_started' || e.type === 'sprint_completed' ? (
                    <span className="muted">{e.scopeAfter ?? 0} scope / {e.completedAfter ?? 0} done</span>
                  ) : e.scopeDelta ? (
                    <span className={e.scopeDelta > 0 ? 'delta-up' : 'delta-down'}>{signed(e.scopeDelta)} scope</span>
                  ) : e.completedDelta ? (
                    <span className={e.completedDelta > 0 ? 'delta-down' : 'delta-up'}>{signed(e.completedDelta)} done</span>
                  ) : (
                    <span className="subtle">0</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  )
}
