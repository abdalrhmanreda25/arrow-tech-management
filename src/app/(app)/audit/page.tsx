'use client'

import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import { Empty, ErrorState, Loading, PermissionNotice } from '@/components/ui/States'
import { useOrg } from '@/components/providers/OrgProvider'
import { usePagedQuery } from '@/lib/hooks'
import { auditQuery } from '@/lib/data/org'
import { downloadCsv } from '@/lib/csv'
import { formatDateTime, toDate } from '@/lib/format'
import type { AuditLog } from '@/lib/types'

const describe = (d: Record<string, unknown> | undefined) =>
  Object.entries(d ?? {})
    .filter(([, v]) => v !== null && v !== '' && v !== undefined)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')

export default function AuditPage() {
  const { orgId, can, memberName } = useOrg()
  const allowed = can('audit.read')
  const logs = usePagedQuery<AuditLog>(() => (orgId && allowed ? auditQuery(orgId) : null), `audit:${orgId}:${allowed}`, 50)

  if (!allowed) {
    return (
      <>
        <PageHeader title="Audit log" />
        <PermissionNotice>Only admins and owners can read the audit log.</PermissionNotice>
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Each entry records who acted and the server time. Nobody, including owners, can edit or delete entries."
        actions={
          <button
            className="btn btn-secondary"
            disabled={!logs.items.length}
            onClick={() =>
              downloadCsv('audit-log', [
                { label: 'When', value: (l: AuditLog) => toDate(l.at)?.toISOString() ?? '' },
                { label: 'Action', value: (l) => l.action },
                { label: 'Actor', value: (l) => (l.actorId ? memberName(l.actorId) : 'System') },
                { label: 'Target type', value: (l) => l.targetType },
                { label: 'Target id', value: (l) => l.targetId },
                { label: 'Details', value: (l) => describe(l.details) },
              ], logs.items)
            }
          >
            <Icon name="download" /> Export loaded rows
          </button>
        }
      />
      {logs.loading ? (
        <Loading />
      ) : logs.error ? (
        <ErrorState error={logs.error} onRetry={logs.reload} />
      ) : logs.items.length === 0 ? (
        <Empty icon="shield" title="No audit entries">Entries appear when people change roles, sprints, projects or teams.</Empty>
      ) : (
        <>
          <div className="table-scroll card">
            <table className="data-table">
              <thead>
                <tr><th>When</th><th>Action</th><th>Actor</th><th>Target</th><th>Details</th></tr>
              </thead>
              <tbody>
                {logs.items.map((l) => (
                  <tr key={l.id}>
                    <td data-label="When" className="nowrap">{formatDateTime(l.at)}</td>
                    <td data-label="Action"><span className="mono">{l.action}</span></td>
                    <td data-label="Actor">{l.actorId ? memberName(l.actorId) : 'System'}</td>
                    <td data-label="Target" className="cell-muted">{l.targetType}</td>
                    <td data-label="Details" className="cell-muted cell-clamp">{describe(l.details)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {logs.hasMore ? (
            <div className="list-footer">
              <button className="btn btn-secondary" onClick={logs.loadMore} disabled={logs.loadingMore}>{logs.loadingMore ? 'Loading...' : 'Load older entries'}</button>
            </div>
          ) : null}
        </>
      )}
    </>
  )
}
