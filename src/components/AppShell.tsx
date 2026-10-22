'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import ThemeToggle from '@/components/ui/ThemeToggle'
import Icon, { type IconName } from '@/components/ui/Icon'
import { OfflineBanner } from '@/components/ui/States'
import { Avatar } from '@/components/ui/Bits'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useLiveQuery } from '@/lib/hooks'
import { unreadQuery } from '@/lib/data/activity'
import { ROLE_LABELS } from '@domain/roles'
import type { Permission } from '@domain/roles'

interface NavItem {
  href: string
  label: string
  icon: IconName
  permission?: Permission
}

const NAV: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [
      { href: '/dashboard/', label: 'Dashboard', icon: 'grid' },
      { href: '/notifications/', label: 'Notifications', icon: 'bell' },
    ],
  },
  {
    label: 'Delivery',
    items: [
      { href: '/backlog/', label: 'Backlog', icon: 'list' },
      { href: '/board/', label: 'Board', icon: 'columns' },
      { href: '/sprints/', label: 'Sprints', icon: 'zap' },
      { href: '/roadmap/', label: 'Roadmap', icon: 'map' },
      { href: '/calendar/', label: 'Calendar', icon: 'calendar' },
      { href: '/reports/', label: 'Reports', icon: 'chart' },
    ],
  },
  {
    label: 'Organization',
    items: [
      { href: '/projects/', label: 'Projects', icon: 'briefcase' },
      { href: '/teams/', label: 'Teams', icon: 'users' },
      { href: '/members/', label: 'Members', icon: 'user' },
      { href: '/audit/', label: 'Audit log', icon: 'shield', permission: 'audit.read' },
      { href: '/settings/', label: 'Settings', icon: 'settings' },
    ],
  },
]

const STORAGE_KEY = 'arrow-admin-sidebar'
const MOBILE_QUERY = '(max-width: 960px)'

const readCollapsed = () => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'collapsed'
  } catch {
    return false
  }
}

function OrgSwitcher() {
  const { memberships, orgId, setOrgId, org } = useOrg()
  if (memberships.length <= 1) {
    return (
      <div className="org-name" title={org?.name}>
        <Icon name="building" size={14} />
        <span>{org?.name ?? '...'}</span>
      </div>
    )
  }
  return (
    <label className="org-switch">
      <span className="sr-only">Organization</span>
      <Icon name="building" size={14} />
      <select className="input input--sm" value={orgId ?? ''} onChange={(e) => setOrgId(e.target.value)}>
        {memberships.map((m) => (
          <option key={m.orgId} value={m.orgId}>
            {m.orgName || m.orgId}
          </option>
        ))}
      </select>
    </label>
  )
}

function ProjectSwitcher() {
  const { projects, projectId, setProjectId } = useOrg()
  const open = projects.filter((p) => !p.archived)
  if (!open.length) {
    return (
      <Link href="/projects/" className="btn btn-secondary btn-sm">
        <Icon name="plus" /> New project
      </Link>
    )
  }
  return (
    <label className="project-switch">
      <span className="sr-only">Project</span>
      <select className="input input--sm" value={projectId ?? ''} onChange={(e) => setProjectId(e.target.value || null)}>
        {open.map((p) => (
          <option key={p.id} value={p.id}>
            {p.key} - {p.name}
          </option>
        ))}
      </select>
    </label>
  )
}

function NotificationBell() {
  const { user } = useAuth()
  const { orgId } = useOrg()
  const unread = useLiveQuery(() => (orgId && user ? unreadQuery(orgId, user.uid) : null), `unread:${orgId}:${user?.uid}`)
  const count = unread.data.length
  return (
    <Link href="/notifications/" className="icon-btn bell" aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}>
      <Icon name="bell" size={18} />
      {count ? <span className="bell-count">{count > 98 ? '99+' : count}</span> : null}
    </Link>
  )
}

/**
 * Application frame, adapted from the arrowtech.online admin shell: a
 * collapsible sidebar on desktop, a focus-managed drawer below 960px.
 */
export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { role, can } = useOrg()
  const [collapsed, setCollapsed] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => setCollapsed(readCollapsed()), [])

  useEffect(() => {
    const q = window.matchMedia(MOBILE_QUERY)
    const sync = () => {
      setIsMobile(q.matches)
      if (!q.matches) setDrawerOpen(false)
    }
    sync()
    q.addEventListener('change', sync)
    return () => q.removeEventListener('change', sync)
  }, [])

  useEffect(() => setDrawerOpen(false), [pathname])

  useEffect(() => {
    if (drawerOpen) {
      wasOpen.current = true
      closeButtonRef.current?.focus()
      const prev = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
      window.addEventListener('keydown', onKey)
      return () => {
        document.body.style.overflow = prev
        window.removeEventListener('keydown', onKey)
      }
    }
    if (wasOpen.current) {
      wasOpen.current = false
      menuButtonRef.current?.focus()
    }
  }, [drawerOpen])

  const compact = collapsed && !isMobile

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'collapsed' : 'expanded')
    } catch {
      // Preference will not persist.
    }
  }

  const isActive = (href: string) => pathname === href || pathname === href.slice(0, -1) || (href === '/sprints/' && pathname.startsWith('/sprint/'))

  return (
    <div className={`admin-shell ${compact ? 'is-collapsed' : ''}`}>
      <aside id="app-sidebar" className={`admin-sidebar ${drawerOpen ? 'is-open' : ''}`} aria-label="Main navigation" inert={isMobile && !drawerOpen}>
        <div className="admin-sidebar-head">
          <div className="admin-sidebar-brand">
            <Link href="/dashboard/" className="brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mark.png" alt="" width={28} height={28} />
              <span>
                Arrow <span>Tech</span>
              </span>
            </Link>
            <small>Team Management</small>
          </div>
          {isMobile ? (
            <button type="button" ref={closeButtonRef} className="icon-btn icon-btn--sm icon-btn--plain" onClick={() => setDrawerOpen(false)} aria-label="Close menu">
              <Icon name="close" size={18} />
            </button>
          ) : null}
        </div>
        {!compact ? <OrgSwitcher /> : null}

        <nav className="admin-nav" aria-label="Sections">
          {NAV.map((group) => (
            <div key={group.label} className="admin-nav-group">
              <div className="admin-nav-label">{group.label}</div>
              {group.items
                .filter((item) => !item.permission || can(item.permission))
                .map((item) => (
                  <Link key={item.href} href={item.href} className="admin-nav-item" aria-current={isActive(item.href) ? 'page' : undefined} title={compact ? item.label : undefined}>
                    <Icon name={item.icon} />
                    <span className="admin-nav-text">{item.label}</span>
                  </Link>
                ))}
            </div>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <Link href="/profile/" className="admin-nav-item" aria-current={isActive('/profile/') ? 'page' : undefined} title={compact ? 'Profile' : undefined}>
            <Avatar name={user?.displayName ?? ''} uid={user?.uid} src={user?.photoURL} size={20} />
            <span className="admin-nav-text">
              {user?.displayName}
              {role ? <small className="role-chip">{ROLE_LABELS[role]}</small> : null}
            </span>
          </Link>
          <button
            type="button"
            className="admin-nav-item"
            title={compact ? 'Sign out' : undefined}
            onClick={async () => {
              await signOut()
              router.replace('/login/')
            }}
          >
            <Icon name="logOut" />
            <span className="admin-nav-text">Sign out</span>
          </button>
          {!isMobile ? (
            <button type="button" className="admin-nav-item" onClick={toggleCollapsed} aria-expanded={!compact} aria-controls="app-sidebar">
              <Icon name="panelLeft" />
              <span className="admin-nav-text">{compact ? 'Expand sidebar' : 'Collapse sidebar'}</span>
            </button>
          ) : null}
        </div>
      </aside>

      {drawerOpen ? <div className="admin-scrim" onClick={() => setDrawerOpen(false)} aria-hidden="true" /> : null}

      <div className="admin-body" inert={isMobile && drawerOpen}>
        <header className="admin-header">
          <div className="admin-header-start">
            {isMobile ? (
              <button type="button" ref={menuButtonRef} className="icon-btn" onClick={() => setDrawerOpen(true)} aria-label="Open menu" aria-expanded={drawerOpen} aria-controls="app-sidebar">
                <Icon name="menu" size={20} />
              </button>
            ) : null}
            <ProjectSwitcher />
          </div>
          <div className="header-actions">
            <NotificationBell />
            <ThemeToggle />
          </div>
        </header>
        <OfflineBanner />
        <main id="main" className="admin-main">
          {children}
        </main>
      </div>
    </div>
  )
}
