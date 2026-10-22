'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { can as canDo, type Permission } from '@domain/roles'
import { useLiveDoc, useLiveQuery } from '@/lib/hooks'
import { membersQuery, myMembershipsQuery, projectsQuery } from '@/lib/data/org'
import { orgDoc } from '@/lib/data/refs'
import type { Membership, Org, Project, Role } from '@/lib/types'
import { useAuth } from './AuthProvider'

interface OrgValue {
  memberships: Membership[]
  membershipsLoading: boolean
  membershipsError: Error | null
  orgId: string | null
  org: Org | null
  setOrgId: (id: string) => void
  members: Membership[]
  role: Role | null
  can: (permission: Permission) => boolean
  member: (uid: string | null | undefined) => Membership | undefined
  memberName: (uid: string | null | undefined) => string
  projects: Project[]
  projectsLoading: boolean
  project: Project | null
  projectId: string | null
  setProjectId: (id: string | null) => void
  loading: boolean
  error: Error | null
}

const OrgContext = createContext<OrgValue | null>(null)

export function useOrg() {
  const ctx = useContext(OrgContext)
  if (!ctx) throw new Error('useOrg must be used inside <OrgProvider>')
  return ctx
}

const ORG_KEY = 'arrow.activeOrg'
const projectKey = (orgId: string) => `arrow.activeProject.${orgId}`

function read(key: string) {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value)
    else localStorage.removeItem(key)
  } catch {
    // Selection simply will not persist.
  }
}

/**
 * Active organization and project. Subscriptions here are the ones nearly
 * every screen needs: the user's memberships, the org, its members and its
 * projects. Everything heavier is loaded by the page that shows it.
 */
export default function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const uid = user?.uid ?? null
  const mships = useLiveQuery<Membership>(() => (uid ? myMembershipsQuery(uid) : null), `m:${uid}`)
  const [orgId, setOrgIdState] = useState<string | null>(null)
  const [projectId, setProjectIdState] = useState<string | null>(null)

  useEffect(() => {
    if (mships.loading) return
    const ids = mships.data.map((m) => m.orgId)
    if (orgId && ids.includes(orgId)) return
    const stored = read(ORG_KEY)
    setOrgIdState(stored && ids.includes(stored) ? stored : ids[0] ?? null)
  }, [mships.loading, mships.data, orgId])

  const orgState = useLiveDoc<Org>(() => (orgId ? orgDoc(orgId) : null), `o:${orgId}`)
  const membersState = useLiveQuery<Membership>(() => (orgId ? membersQuery(orgId) : null), `ms:${orgId}`)
  const projectsState = useLiveQuery<Project>(() => (orgId ? projectsQuery(orgId) : null), `p:${orgId}`)

  useEffect(() => {
    if (!orgId || projectsState.loading) return
    const open = projectsState.data.filter((p) => !p.archived)
    if (projectId && projectsState.data.some((p) => p.id === projectId)) return
    const stored = read(projectKey(orgId))
    setProjectIdState(stored && open.some((p) => p.id === stored) ? stored : open[0]?.id ?? null)
  }, [orgId, projectsState.loading, projectsState.data, projectId])

  const setOrgId = useCallback((id: string) => {
    write(ORG_KEY, id)
    setOrgIdState(id)
    setProjectIdState(null)
  }, [])

  const setProjectId = useCallback(
    (id: string | null) => {
      if (orgId) write(projectKey(orgId), id)
      setProjectIdState(id)
    },
    [orgId],
  )

  const value = useMemo<OrgValue>(() => {
    const members = [...membersState.data].sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))
    const byUid = new Map(members.map((m) => [m.uid, m]))
    // The live member doc is authoritative; the membership list can lag a role change.
    const role = (uid && (byUid.get(uid)?.role ?? mships.data.find((m) => m.orgId === orgId)?.role)) || null
    const project = projectsState.data.find((p) => p.id === projectId) ?? null
    return {
      memberships: mships.data,
      membershipsLoading: mships.loading,
      membershipsError: mships.error,
      orgId,
      org: orgState.data,
      setOrgId,
      members,
      role,
      can: (permission) => canDo(role, permission),
      member: (id) => (id ? byUid.get(id) : undefined),
      memberName: (id) => (id ? byUid.get(id)?.displayName || 'Former member' : 'Unassigned'),
      projects: projectsState.data,
      projectsLoading: projectsState.loading,
      project,
      projectId: project?.id ?? null,
      setProjectId,
      loading: mships.loading || (Boolean(orgId) && (orgState.loading || membersState.loading || projectsState.loading)),
      error: mships.error || orgState.error || membersState.error || projectsState.error,
    }
  }, [mships, orgId, orgState, membersState, projectsState, projectId, uid, setOrgId, setProjectId])

  return <OrgContext.Provider value={value}>{children}</OrgContext.Provider>
}
