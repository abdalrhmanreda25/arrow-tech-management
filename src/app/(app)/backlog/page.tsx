'use client'

import { useMemo, useState, type DragEvent } from 'react'
import Link from 'next/link'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import ProjectGate from '@/components/ProjectGate'
import ItemDialog from '@/components/ItemDialog'
import { Avatar, Panel, Points, PriorityBadge, StatusBadge, TypeIcon } from '@/components/ui/Bits'
import { Empty, ErrorState, Loading, PermissionNotice } from '@/components/ui/States'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { useLiveQuery, usePagedQuery } from '@/lib/hooks'
import { backlogQuery, epicsQuery, patchItem, patchItems } from '@/lib/data/items'
import { sprintsQuery } from '@/lib/data/sprints'
import { downloadCsv } from '@/lib/csv'
import { rankForDrop, sortByRank } from '@/lib/board'
import { ITEM_TYPES, PAGE_SIZE, priorityLabel, statusLabel, typeLabel } from '@/lib/constants'
import { pts } from '@/lib/format'
import type { Item, Project, Sprint } from '@/lib/types'
import '../../delivery-a.css'

type TypeFilter = 'work' | 'all' | Item['type']

function BacklogView({ project }: { project: Project }) {
  const { user } = useAuth()
  const { orgId, can, memberName, member, members } = useOrg()
  const toast = useToaster()
  const uid = user!.uid
  const canWrite = can('items.write')

  const paged = usePagedQuery<Item>(() => (orgId ? backlogQuery(orgId, project.id) : null), `bl:${orgId}:${project.id}`, PAGE_SIZE)
  const epics = useLiveQuery<Item>(() => (orgId ? epicsQuery(orgId, project.id) : null), `ep:${orgId}:${project.id}`)
  const sprints = useLiveQuery<Sprint>(() => (orgId ? sprintsQuery(orgId, project.id) : null), `sp:${orgId}:${project.id}`)
  const openSprints = sprints.data.filter((s) => s.status !== 'completed')

  const [search, setSearch] = useState('')
  const [type, setType] = useState<TypeFilter>('work')
  const [assignee, setAssignee] = useState('')
  const [epicId, setEpicId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [target, setTarget] = useState('')
  const [moving, setMoving] = useState(false)
  const [creating, setCreating] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropBefore, setDropBefore] = useState<string | null>(null)

  const ordered = useMemo(() => sortByRank(paged.items, (i) => i.rank), [paged.items])
  const epicKey = useMemo(() => new Map(epics.data.map((e) => [e.id, e])), [epics.data])
  const sprintName = (id: string | null) => (id ? sprints.data.find((s) => s.id === id)?.name ?? 'Unknown sprint' : '')

  const filtered = ordered.filter((i) => {
    if (type === 'work' && i.type === 'epic') return false
    if (type !== 'work' && type !== 'all' && i.type !== type) return false
    if (assignee === 'none' ? i.assigneeId : assignee && i.assigneeId !== assignee) return false
    if (epicId && i.epicId !== epicId) return false
    if (search) {
      const q = search.toLowerCase()
      if (!i.title.toLowerCase().includes(q) && !i.key.toLowerCase().includes(q)) return false
    }
    return true
  })
  // Ranks are only rewritten against the full ordered list, so reordering is
  // switched off while a filter hides neighbours.
  const filtering = Boolean(search || assignee || epicId || (type !== 'work' && type !== 'all'))
  const canReorder = canWrite && !filtering

  const selectedItems = filtered.filter((i) => selected.has(i.id))
  const selectedPoints = selectedItems.reduce((s, i) => s + (i.storyPoints ?? 0), 0)

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const moveTo = async (item: Item, beforeId: string | null) => {
    if (!orgId) return
    const rank = rankForDrop(ordered, item.id, beforeId, (i) => i.rank)
    if (rank === item.rank) return
    paged.patch(item.id, { rank })
    try {
      await patchItem(orgId, item.id, { rank }, uid)
    } catch (err) {
      paged.patch(item.id, { rank: item.rank })
      toast.error(err)
    }
  }

  const step = (item: Item, dir: -1 | 1) => {
    const index = ordered.findIndex((i) => i.id === item.id)
    if (dir === -1 && index > 0) moveTo(item, ordered[index - 1].id)
    if (dir === 1 && index < ordered.length - 1) moveTo(item, ordered[index + 2]?.id ?? null)
  }

  const onDrop = (e: DragEvent, beforeId: string | null) => {
    e.preventDefault()
    const item = ordered.find((i) => i.id === dragId)
    setDragId(null)
    setDropBefore(null)
    if (item && item.id !== beforeId) moveTo(item, beforeId)
  }

  const moveSelected = async () => {
    if (!orgId || !target) return
    const ids = selectedItems.filter((i) => i.type !== 'epic').map((i) => i.id)
    const skipped = selectedItems.length - ids.length
    if (!ids.length) return toast.error('Epics stay in the backlog; select stories, tasks or bugs.')
    setMoving(true)
    try {
      await patchItems(orgId, ids, { sprintId: target }, uid)
      ids.forEach((id) => paged.patch(id, null))
      setSelected(new Set())
      toast.success(`Moved ${ids.length} item${ids.length === 1 ? '' : 's'} to ${sprintName(target)}${skipped ? `; ${skipped} epic${skipped === 1 ? '' : 's'} skipped` : ''}.`)
    } catch (err) {
      toast.error(err)
    } finally {
      setMoving(false)
    }
  }

  const exportCsv = () =>
    downloadCsv(`${project.key}-backlog`, [
      { label: 'Key', value: (i: Item) => i.key },
      { label: 'Type', value: (i) => typeLabel(i.type) },
      { label: 'Title', value: (i) => i.title },
      { label: 'Status', value: (i) => statusLabel(i.status) },
      { label: 'Priority', value: (i) => priorityLabel(i.priority) },
      { label: 'Story points', value: (i) => i.storyPoints ?? '' },
      { label: 'Assignee', value: (i) => (i.assigneeId ? memberName(i.assigneeId) : '') },
      { label: 'Epic', value: (i) => (i.epicId ? epicKey.get(i.epicId)?.key ?? '' : '') },
      { label: 'Sprint', value: (i) => sprintName(i.sprintId) },
    ], filtered)

  const backlogPoints = ordered.filter((i) => i.type !== 'epic').reduce((s, i) => s + (i.storyPoints ?? 0), 0)

  return (
    <>
      <PageHeader
        title="Backlog"
        description={`${project.name} · ${ordered.filter((i) => i.type !== 'epic').length}${paged.hasMore ? '+' : ''} items · ${pts(backlogPoints)} loaded`}
        actions={
          <>
            <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv} disabled={!filtered.length}>
              <Icon name="download" /> CSV
            </button>
            {canWrite ? (
              <button type="button" className="btn btn-accent btn-sm" onClick={() => setCreating(true)}>
                <Icon name="plus" /> New item
              </button>
            ) : null}
          </>
        }
      />
      {!canWrite ? <PermissionNotice>You have view-only access. Ask an admin for the member role to edit the backlog.</PermissionNotice> : null}

      <div className="backlog-layout section-gap">
        <Panel title="Epics">
          {epics.loading ? (
            <Loading rows={3} />
          ) : epics.error ? (
            <ErrorState error={epics.error} />
          ) : (
            <ul className="epic-list">
              <li>
                <button type="button" className="epic-btn" aria-pressed={!epicId} onClick={() => setEpicId(null)}>
                  All items
                </button>
              </li>
              {epics.data.map((e) => (
                <li key={e.id}>
                  <button type="button" className="epic-btn" aria-pressed={epicId === e.id} onClick={() => setEpicId(epicId === e.id ? null : e.id)}>
                    <span className="epic-dot" style={e.color ? { background: e.color } : undefined} />
                    <span className="truncate">{e.title}</span>
                  </button>
                </li>
              ))}
              {!epics.data.length ? <li className="muted small">No epics yet. Create one with New item.</li> : null}
            </ul>
          )}
        </Panel>

        <div>
          <div className="toolbar">
            <input className="input input--sm search" type="search" placeholder="Search loaded items" aria-label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="input input--sm" aria-label="Type" value={type} onChange={(e) => setType(e.target.value as TypeFilter)}>
              <option value="work">Stories, tasks, bugs</option>
              <option value="all">All types</option>
              {ITEM_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}s</option>)}
            </select>
            <select className="input input--sm" aria-label="Assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Anyone</option>
              <option value="none">Unassigned</option>
              <option value={uid}>Me</option>
              {members.filter((m) => m.uid !== uid).map((m) => <option key={m.uid} value={m.uid}>{m.displayName}</option>)}
            </select>
            {filtering && canWrite ? <span className="xsmall subtle">Clear filters to reorder.</span> : null}
          </div>

          {paged.loading ? (
            <Loading />
          ) : paged.error ? (
            <ErrorState error={paged.error} onRetry={paged.reload} />
          ) : !filtered.length ? (
            <Empty icon="list" title={ordered.length ? 'Nothing matches these filters' : 'The backlog is empty'} action={canWrite && !ordered.length ? <button className="btn btn-accent btn-sm" onClick={() => setCreating(true)}>Add the first item</button> : null}>
              {ordered.length ? 'Try clearing a filter.' : 'Stories, tasks and bugs that are not in a sprint live here.'}
            </Empty>
          ) : (
            <ul className="item-list" onDragOver={(e) => canReorder && e.preventDefault()}>
              {filtered.map((i, index) => {
                const epic = i.epicId ? epicKey.get(i.epicId) : null
                const who = member(i.assigneeId)
                return (
                  <li
                    key={i.id}
                    className="item-row"
                    style={{ gridTemplateColumns: 'auto auto auto auto minmax(0,1fr) auto auto auto auto' }}
                    draggable={canReorder}
                    data-dragging={dragId === i.id}
                    data-drop={dropBefore === i.id && dragId !== i.id ? 'before' : undefined}
                    onDragStart={(e) => {
                      setDragId(i.id)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', i.id)
                    }}
                    onDragEnd={() => {
                      setDragId(null)
                      setDropBefore(null)
                    }}
                    onDragOver={(e) => {
                      if (!canReorder || !dragId) return
                      e.preventDefault()
                      setDropBefore(i.id)
                    }}
                    onDrop={(e) => onDrop(e, i.id)}
                  >
                    {canWrite ? (
                      <input type="checkbox" className="checkbox" aria-label={`Select ${i.key}`} checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                    ) : (
                      <span />
                    )}
                    {canReorder ? (
                      <span className="row-moves">
                        <button type="button" className="icon-btn icon-btn--plain" aria-label={`Move ${i.key} up`} disabled={index === 0} onClick={() => step(i, -1)}>
                          <Icon name="chevronUp" size={14} />
                        </button>
                        <button type="button" className="icon-btn icon-btn--plain" aria-label={`Move ${i.key} down`} disabled={index === filtered.length - 1} onClick={() => step(i, 1)}>
                          <Icon name="chevronDown" size={14} />
                        </button>
                      </span>
                    ) : (
                      <span />
                    )}
                    <TypeIcon type={i.type} />
                    <span className="item-key">{i.key}</span>
                    <span className="row truncate" style={{ flexWrap: 'nowrap' }}>
                      <Link className="item-title truncate" href={`/item/?id=${i.id}`}>{i.title}</Link>
                      {epic ? <span className="badge badge--accent hide-sm">{epic.title}</span> : null}
                      {(i.carryoverCount ?? 0) > 0 ? <span className="badge badge--warning hide-sm" title="Times carried over from a sprint">↻ {i.carryoverCount}</span> : null}
                    </span>
                    <span className="hide-sm"><PriorityBadge priority={i.priority} /></span>
                    <span className="hide-sm"><StatusBadge status={i.status} /></span>
                    <span className="hide-sm">{who ? <Avatar name={who.displayName} uid={who.uid} src={who.photoURL} size={22} /> : <span className="subtle xsmall">-</span>}</span>
                    <Points value={i.type === 'epic' ? null : i.storyPoints} />
                  </li>
                )
              })}
              {canReorder && dragId ? (
                <li
                  className="list-footer xsmall subtle"
                  data-drop={dropBefore === null ? 'before' : undefined}
                  onDragOver={(e) => {
                    e.preventDefault()
                    setDropBefore(null)
                  }}
                  onDrop={(e) => onDrop(e, null)}
                >
                  Drop here to move to the end of the loaded list
                </li>
              ) : null}
            </ul>
          )}
          {paged.hasMore ? (
            <div className="list-footer">
              <button type="button" className="btn btn-secondary btn-sm" onClick={paged.loadMore} disabled={paged.loadingMore}>
                {paged.loadingMore ? 'Loading...' : `Load ${PAGE_SIZE} more`}
              </button>
            </div>
          ) : null}

          {selectedItems.length ? (
            <div className="selection-bar" role="region" aria-label="Selected items">
              <strong>{selectedItems.length} selected</strong>
              <span className="muted">{pts(selectedPoints)}</span>
              <span className="spacer" />
              {openSprints.length ? (
                <>
                  <select className="input input--sm" aria-label="Target sprint" value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">Move to sprint...</option>
                    {openSprints.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.status})</option>)}
                  </select>
                  <button type="button" className="btn btn-accent btn-sm" disabled={!target || moving} onClick={moveSelected}>
                    {moving ? 'Moving...' : 'Move'}
                  </button>
                </>
              ) : (
                <Link className="btn btn-secondary btn-sm" href="/sprints/">Plan a sprint first</Link>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
            </div>
          ) : null}
        </div>
      </div>

      <ItemDialog open={creating} onClose={() => setCreating(false)} defaults={epicId ? { epicId } : undefined} onCreated={() => paged.reload()} />
    </>
  )
}

export default function BacklogPage() {
  return <ProjectGate>{(project) => <BacklogView key={project.id} project={project} />}</ProjectGate>
}
