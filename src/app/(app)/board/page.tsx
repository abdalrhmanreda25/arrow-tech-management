'use client'

import { useMemo, useState, type DragEvent, type FormEvent } from 'react'
import Link from 'next/link'
import { daysBetween } from '@domain/dates'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import Dialog from '@/components/ui/Dialog'
import Field from '@/components/ui/Field'
import ProjectGate from '@/components/ProjectGate'
import ItemDialog from '@/components/ItemDialog'
import { Avatar, Points, PriorityBadge, TypeIcon } from '@/components/ui/Bits'
import { Empty, ErrorState, Loading, PermissionNotice } from '@/components/ui/States'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { useLiveDoc, useLiveQuery } from '@/lib/hooks'
import { epicsQuery, patchItem, sprintItemsQuery } from '@/lib/data/items'
import { updateProject } from '@/lib/data/org'
import { orgItem } from '@/lib/data/refs'
import { rankForDrop, sortByRank } from '@/lib/board'
import { STATUSES } from '@/lib/constants'
import { formatDate, pts, todayKey } from '@/lib/format'
import type { BoardSettings, Item, ItemStatus, Project, Sprint } from '@/lib/types'
import '../../delivery-a.css'

type Lane = { id: string; title: string; items: Item[] }

function SettingsDialog({ project, open, onClose }: { project: Project; open: boolean; onClose: () => void }) {
  const { user } = useAuth()
  const { orgId } = useOrg()
  const toast = useToaster()
  const [swimlanes, setSwimlanes] = useState<NonNullable<BoardSettings['swimlanes']>>(project.board?.swimlanes ?? 'none')
  const [limits, setLimits] = useState<Record<string, string>>(() =>
    Object.fromEntries(STATUSES.map((s) => [s.id, project.board?.wipLimits?.[s.id] ? String(project.board.wipLimits[s.id]) : ''])),
  )
  const [pending, setPending] = useState(false)

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!orgId || !user) return
    const wipLimits: Partial<Record<ItemStatus, number>> = {}
    for (const s of STATUSES) {
      const n = Number(limits[s.id])
      if (limits[s.id] && Number.isInteger(n) && n > 0) wipLimits[s.id] = n
    }
    setPending(true)
    try {
      await updateProject(orgId, project.id, { board: { swimlanes, wipLimits } }, user.uid)
      toast.success('Board settings saved for everyone on this project.')
      onClose()
    } catch (err) {
      toast.error(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Board settings"
      dismissible={!pending}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="submit" form="board-settings" className="btn btn-accent" disabled={pending}>{pending ? 'Saving...' : 'Save'}</button>
        </>
      }
    >
      <form id="board-settings" className="stack" onSubmit={save}>
        <Field label="Swimlanes">
          {(p) => (
            <select {...p} className="input" value={swimlanes} onChange={(e) => setSwimlanes(e.target.value as typeof swimlanes)}>
              <option value="none">None</option>
              <option value="assignee">By assignee</option>
              <option value="epic">By epic</option>
            </select>
          )}
        </Field>
        <div>
          <div className="label">Work-in-progress limits</div>
          <p className="field-hint">Leave empty for no limit. Columns over their limit are highlighted.</p>
          <div className="wip-form" style={{ marginTop: 8 }}>
            {STATUSES.map((s) => (
              <Field key={s.id} label={s.label} optional>
                {(p) => <input {...p} className="input" type="number" min={1} max={99} value={limits[s.id]} onChange={(e) => setLimits((l) => ({ ...l, [s.id]: e.target.value }))} />}
              </Field>
            ))}
          </div>
        </div>
      </form>
    </Dialog>
  )
}

function BoardView({ project }: { project: Project }) {
  const { user } = useAuth()
  const { orgId, can, member, members } = useOrg()
  const toast = useToaster()
  const uid = user!.uid
  const canWrite = can('items.write')
  const sprintId = project.activeSprintId

  const sprint = useLiveDoc<Sprint>(() => (orgId && sprintId ? orgItem(orgId, 'sprints', sprintId) : null), `bs:${orgId}:${sprintId}`)
  const items = useLiveQuery<Item>(() => (orgId && sprintId ? sprintItemsQuery(orgId, sprintId) : null), `bi:${orgId}:${sprintId}`)
  const swimlanes = project.board?.swimlanes ?? 'none'
  const epics = useLiveQuery<Item>(() => (orgId && swimlanes === 'epic' ? epicsQuery(orgId, project.id) : null), `be:${orgId}:${project.id}:${swimlanes}`)

  const [assignee, setAssignee] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [over, setOver] = useState<{ lane: string; status: ItemStatus; before: string | null } | null>(null)
  const [settings, setSettings] = useState(false)
  const [creating, setCreating] = useState(false)

  const visible = useMemo(
    () => items.data.filter((i) => i.type !== 'epic' && (!assignee || (assignee === 'none' ? !i.assigneeId : i.assigneeId === assignee))),
    [items.data, assignee],
  )

  const lanes: Lane[] = useMemo(() => {
    if (swimlanes === 'none') return [{ id: 'all', title: '', items: visible }]
    const groups = new Map<string, Item[]>()
    for (const i of visible) {
      const key = (swimlanes === 'assignee' ? i.assigneeId : i.epicId) ?? 'none'
      groups.set(key, [...(groups.get(key) ?? []), i])
    }
    const title = (key: string) => {
      if (key === 'none') return swimlanes === 'assignee' ? 'Unassigned' : 'No epic'
      if (swimlanes === 'assignee') return member(key)?.displayName ?? 'Former member'
      return epics.data.find((e) => e.id === key)?.title ?? 'Epic'
    }
    return [...groups.entries()]
      .map(([id, list]) => ({ id, title: title(id), items: list }))
      .sort((a, b) => (a.id === 'none' ? 1 : b.id === 'none' ? -1 : a.title.localeCompare(b.title)))
  }, [visible, swimlanes, member, epics.data])

  const column = (list: Item[], status: ItemStatus) => sortByRank(list.filter((i) => i.status === status), (i) => i.boardRank ?? i.rank)
  const counts = Object.fromEntries(STATUSES.map((s) => [s.id, items.data.filter((i) => i.type !== 'epic' && i.status === s.id).length]))

  const move = async (item: Item, status: ItemStatus, before: string | null, laneItems: Item[]) => {
    if (!orgId) return
    const target = column(laneItems, status)
    const boardRank = rankForDrop(target, item.id, before, (i) => i.boardRank ?? i.rank)
    if (status === item.status && boardRank === item.boardRank) return
    try {
      await patchItem(orgId, item.id, { status, boardRank }, uid)
    } catch (err) {
      toast.error(err)
    }
  }

  const drop = (e: DragEvent, lane: Lane, status: ItemStatus, before: string | null) => {
    e.preventDefault()
    e.stopPropagation()
    const item = items.data.find((i) => i.id === dragId)
    setDragId(null)
    setOver(null)
    if (item && item.id !== before) move(item, status, before, lane.items)
  }

  if (!sprintId) {
    return (
      <>
        <PageHeader title="Board" description={project.name} />
        <Empty icon="columns" title="No active sprint" action={<Link className="btn btn-accent btn-sm" href="/sprints/">Go to sprints</Link>}>
          The board shows the work of the running sprint. Plan a sprint and start it to fill the board.
        </Empty>
      </>
    )
  }

  const s = sprint.data
  const left = s ? daysBetween(todayKey(), s.endDate) : 0
  const scope = visible.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)
  const done = visible.filter((i) => i.status === 'done').reduce((sum, i) => sum + (i.storyPoints ?? 0), 0)

  return (
    <>
      <PageHeader
        title={s ? s.name : 'Board'}
        description={s ? `${formatDate(s.startDate)} - ${formatDate(s.endDate)} · ${left >= 0 ? `${left} day${left === 1 ? '' : 's'} left` : `${-left} day${left === -1 ? '' : 's'} overdue`} · ${pts(done)} of ${pts(scope)} done` : project.name}
        actions={
          <>
            {s ? <Link className="btn btn-secondary btn-sm" href={`/sprint/?id=${s.id}`}><Icon name="zap" /> Sprint</Link> : null}
            {can('projects.manage') ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSettings(true)}>
                <Icon name="settings" /> Board settings
              </button>
            ) : null}
            {canWrite ? (
              <button type="button" className="btn btn-accent btn-sm" onClick={() => setCreating(true)}>
                <Icon name="plus" /> Add to sprint
              </button>
            ) : null}
          </>
        }
      />
      {s?.goal ? <p className="muted small" style={{ marginTop: -12, marginBottom: 16 }}><strong>Goal:</strong> {s.goal}</p> : null}
      {!canWrite ? <PermissionNotice>Read-only board. Viewers cannot move cards.</PermissionNotice> : null}

      <div className="toolbar">
        <select className="input input--sm" aria-label="Filter by assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
          <option value="">Everyone</option>
          <option value={uid}>Only my items</option>
          <option value="none">Unassigned</option>
          {members.filter((m) => m.uid !== uid).map((m) => <option key={m.uid} value={m.uid}>{m.displayName}</option>)}
        </select>
        <span className="xsmall subtle">Drag cards, or use the status menu on each card. Changes save for everyone.</span>
      </div>

      {items.loading || sprint.loading ? (
        <Loading />
      ) : items.error ? (
        <ErrorState error={items.error} />
      ) : !items.data.length ? (
        <Empty icon="columns" title="This sprint has no items" action={<Link className="btn btn-secondary btn-sm" href="/backlog/">Open the backlog</Link>}>
          Move stories from the backlog into the sprint.
        </Empty>
      ) : (
        lanes.map((lane) => (
          <div key={lane.id} className={swimlanes === 'none' ? '' : 'swimlane'}>
            {lane.title ? (
              <div className="swimlane-title">
                {swimlanes === 'assignee' && lane.id !== 'none' ? <Avatar name={lane.title} uid={lane.id} src={member(lane.id)?.photoURL} size={20} /> : null}
                {lane.title} <span className="subtle xsmall">{lane.items.length}</span>
              </div>
            ) : null}
            <div className="board">
              {STATUSES.map((status) => {
                const cards = column(lane.items, status.id)
                const limit = project.board?.wipLimits?.[status.id]
                const overLimit = Boolean(limit && counts[status.id] > limit)
                const isOver = over?.lane === lane.id && over.status === status.id
                return (
                  <section
                    key={status.id}
                    className="board-col"
                    aria-label={`${status.label}, ${cards.length} items`}
                    data-over={isOver}
                    onDragOver={(e) => {
                      if (!canWrite || !dragId) return
                      e.preventDefault()
                      if (!isOver) setOver({ lane: lane.id, status: status.id, before: null })
                    }}
                    onDrop={(e) => drop(e, lane, status.id, over?.before ?? null)}
                  >
                    <header className="board-col-head">
                      <span>{status.label}</span>
                      <span className={`count ${overLimit ? 'wip-over' : ''}`} title={limit ? 'Items in this column across the board / WIP limit' : undefined}>
                        {limit ? `${counts[status.id]} / ${limit}` : cards.length}
                        {overLimit ? ' over limit' : ''}
                      </span>
                    </header>
                    <div className="board-cards">
                      {cards.map((i) => {
                        const who = member(i.assigneeId)
                        return (
                          <article
                            key={i.id}
                            className="board-card"
                            draggable={canWrite}
                            data-dragging={dragId === i.id}
                            data-drop={isOver && over?.before === i.id && dragId !== i.id ? 'before' : undefined}
                            onDragStart={(e) => {
                              setDragId(i.id)
                              e.dataTransfer.effectAllowed = 'move'
                              e.dataTransfer.setData('text/plain', i.id)
                            }}
                            onDragEnd={() => {
                              setDragId(null)
                              setOver(null)
                            }}
                            onDragOver={(e) => {
                              if (!canWrite || !dragId) return
                              e.preventDefault()
                              e.stopPropagation()
                              setOver({ lane: lane.id, status: status.id, before: i.id })
                            }}
                            onDrop={(e) => drop(e, lane, status.id, i.id)}
                            style={canWrite ? undefined : { cursor: 'default' }}
                          >
                            <div className="board-card-meta">
                              <TypeIcon type={i.type} />
                              <span className="item-key">{i.key}</span>
                              <span className="spacer" />
                              <PriorityBadge priority={i.priority} />
                            </div>
                            <Link href={`/item/?id=${i.id}`}>{i.title}</Link>
                            <div className="board-card-actions">
                              <span className="row">
                                <Points value={i.storyPoints} />
                                {(i.carryoverCount ?? 0) > 0 ? <span className="badge badge--warning" title="Times carried over">↻ {i.carryoverCount}</span> : null}
                              </span>
                              <span className="row">
                                {canWrite ? (
                                  <select className="input" aria-label={`Status of ${i.key}`} value={i.status} onChange={(e) => move(i, e.target.value as ItemStatus, null, lane.items)}>
                                    {STATUSES.map((st) => <option key={st.id} value={st.id}>{st.label}</option>)}
                                  </select>
                                ) : null}
                                {who ? <Avatar name={who.displayName} uid={who.uid} src={who.photoURL} size={22} /> : null}
                              </span>
                            </div>
                          </article>
                        )
                      })}
                      {canWrite && dragId ? (
                        <div
                          className="board-drop-end"
                          data-over={isOver && over?.before === null}
                          onDragOver={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            setOver({ lane: lane.id, status: status.id, before: null })
                          }}
                          onDrop={(e) => drop(e, lane, status.id, null)}
                        />
                      ) : null}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
        ))
      )}

      {settings ? <SettingsDialog project={project} open={settings} onClose={() => setSettings(false)} /> : null}
      <ItemDialog open={creating} onClose={() => setCreating(false)} defaults={{ sprintId, status: 'todo' }} />
    </>
  )
}

export default function BoardPage() {
  return <ProjectGate>{(project) => <BoardView key={project.id} project={project} />}</ProjectGate>
}
