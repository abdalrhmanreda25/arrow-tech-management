'use client'

import type { ReactNode } from 'react'
import { errorKind, friendlyError } from '@/lib/errors'
import { useOnline } from '@/lib/hooks'
import Icon, { type IconName } from './Icon'

export function Loading({ label = 'Loading', rows = 4 }: { label?: string; rows?: number }) {
  return (
    <div className="state-loading" role="status" aria-live="polite">
      <span className="sr-only">{label}...</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton" style={{ width: `${92 - i * 11}%` }} />
      ))}
    </div>
  )
}

export function FullPageSpinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="full-center" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">{label}...</span>
    </div>
  )
}

export function Empty({ icon = 'inbox', title, children, action }: { icon?: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="icon-tile">
        <Icon name={icon} size={20} />
      </span>
      <strong className="empty-title">{title}</strong>
      {children ? <div className="empty-body">{children}</div> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  )
}

/** Error panel that tells permission, offline and missing-index failures apart. */
export function ErrorState({ error, onRetry, title }: { error: unknown; onRetry?: () => void; title?: string }) {
  const kind = errorKind(error)
  const icon: IconName = kind === 'permission' ? 'lock' : kind === 'offline' ? 'wifiOff' : 'alert'
  const heading =
    title ??
    (kind === 'permission'
      ? 'You do not have access to this'
      : kind === 'offline'
        ? 'You are offline'
        : kind === 'index'
          ? 'A database index is missing'
          : 'Could not load this')
  return (
    <div className={`state-error state-error--${kind}`} role="alert">
      <span className="icon-tile">
        <Icon name={icon} size={20} />
      </span>
      <strong>{heading}</strong>
      <p>{friendlyError(error)}</p>
      {onRetry && kind !== 'permission' ? (
        <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
          <Icon name="refresh" /> Try again
        </button>
      ) : null}
    </div>
  )
}

export function PermissionNotice({ children }: { children: ReactNode }) {
  return (
    <div className="notice notice--muted" role="note">
      <Icon name="lock" size={16} />
      <span>{children}</span>
    </div>
  )
}

/** Shown when a report cannot be drawn honestly from the stored history. */
export function InsufficientData({ title = 'Not enough history yet', children }: { title?: string; children: ReactNode }) {
  return (
    <div className="notice notice--warning" role="note">
      <Icon name="clock" size={16} />
      <div>
        <strong>{title}</strong>
        <div>{children}</div>
      </div>
    </div>
  )
}

export function OfflineBanner() {
  const online = useOnline()
  if (online) return null
  return (
    <div className="offline-banner" role="status">
      <Icon name="wifiOff" size={16} />
      You are offline. Cached data is shown; edits will sync when you reconnect. Sprint actions and invites need a connection.
    </div>
  )
}
