'use client'

import type { ReactNode } from 'react'
import { initials } from '@/lib/format'
import { priorityLabel, statusLabel, typeLabel } from '@/lib/constants'
import type { ItemType } from '@/lib/types'
import Icon, { type IconName } from './Icon'

const AVATAR_TONES = 8

function tone(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) % 9973
  return h % AVATAR_TONES
}

export function Avatar({ name, uid, src, size = 24 }: { name: string; uid?: string | null; src?: string | null; size?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="avatar" src={src} alt="" width={size} height={size} title={name} />
  }
  return (
    <span className={`avatar avatar--t${tone(uid || name)}`} style={{ width: size, height: size, fontSize: Math.max(9, size * 0.4) }} title={name} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge status status--${status}`}>{statusLabel(status)}</span>
}

export function PriorityBadge({ priority }: { priority: string }) {
  return <span className={`prio prio--${priority}`}>{priorityLabel(priority)}</span>
}

const TYPE_ICONS: Record<ItemType, IconName> = { epic: 'layers', story: 'file', task: 'check', bug: 'bug' }

export function TypeIcon({ type }: { type: ItemType }) {
  return (
    <span className={`type-icon type-icon--${type}`} title={typeLabel(type)}>
      <Icon name={TYPE_ICONS[type] ?? 'file'} size={12} />
      <span className="sr-only">{typeLabel(type)}</span>
    </span>
  )
}

export function Points({ value }: { value: number | null | undefined }) {
  return <span className="points" title="Story points">{value ?? '-'}</span>
}

export function Progress({ value, max, label }: { value: number; max: number; label?: string }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <span style={{ width: `${ratio * 100}%` }} className={value > max && max > 0 ? 'is-over' : ''} />
    </div>
  )
}

export function Stat({ label, value, hint, children }: { label: string; value: ReactNode; hint?: ReactNode; children?: ReactNode }) {
  return (
    <div className="admin-stat kpi card">
      <div className="admin-stat-label">{label}</div>
      <div className="admin-stat-value">{value}</div>
      {hint ? <div className="admin-stat-hint">{hint}</div> : null}
      {children}
    </div>
  )
}

export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel card ${className}`.trim()}>
      {title || actions ? (
        <header className="panel-head">
          {title ? <h2 className="panel-title">{title}</h2> : <span />}
          {actions ? <div className="panel-actions">{actions}</div> : null}
        </header>
      ) : null}
      <div className="panel-body">{children}</div>
    </section>
  )
}
