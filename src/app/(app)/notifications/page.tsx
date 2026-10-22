'use client'

import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import { Empty, ErrorState, Loading } from '@/components/ui/States'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { useLiveQuery } from '@/lib/hooks'
import { deleteNotification, markAllRead, markRead, notificationsQuery } from '@/lib/data/activity'
import { relativeTime } from '@/lib/format'
import type { AppNotification } from '@/lib/types'

export default function NotificationsPage() {
  const { user } = useAuth()
  const { orgId, memberName } = useOrg()
  const toast = useToaster()
  const list = useLiveQuery<AppNotification>(() => (orgId && user ? notificationsQuery(orgId, user.uid, 50) : null), `notif:${orgId}:${user?.uid}`)
  const unread = list.data.filter((n) => !n.readAt).length

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Assignments, comments, completed work and role changes. The latest 50 are shown."
        actions={
          unread ? (
            <button className="btn btn-secondary" onClick={() => markAllRead(orgId!, user!.uid).then((n) => toast.success(`Marked ${n} as read`), toast.error)}>
              <Icon name="check" /> Mark all read
            </button>
          ) : null
        }
      />
      {list.loading ? (
        <Loading />
      ) : list.error ? (
        <ErrorState error={list.error} />
      ) : list.data.length === 0 ? (
        <Empty icon="bell" title="You are all caught up">Notifications appear when someone assigns you work, comments on your items, or changes your role.</Empty>
      ) : (
        <div className="card">
          {list.data.map((n) => (
            <div key={n.id} className={`notif ${n.readAt ? '' : 'is-unread'}`}>
              <span className={`notif-dot ${n.readAt ? 'is-read' : ''}`} aria-hidden="true" />
              <div style={{ flex: 1, minWidth: 0 }}>
                {n.link ? (
                  <Link className="text-link" href={n.link} onClick={() => !n.readAt && markRead(orgId!, n.id).catch(() => {})}>
                    <strong>{n.title}</strong>
                  </Link>
                ) : (
                  <strong>{n.title}</strong>
                )}
                {n.body ? <p className="muted small truncate">{n.body}</p> : null}
                <div className="subtle xsmall">
                  {n.actorId ? `${memberName(n.actorId)} · ` : ''}
                  {relativeTime(n.createdAt)}
                  {n.readAt ? '' : <span className="sr-only">, unread</span>}
                </div>
              </div>
              {!n.readAt ? (
                <button className="btn btn-ghost btn-sm" onClick={() => markRead(orgId!, n.id).catch(toast.error)}>Mark read</button>
              ) : null}
              <button className="icon-btn icon-btn--sm icon-btn--plain" aria-label="Delete notification" onClick={() => deleteNotification(orgId!, n.id).catch(toast.error)}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
