'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { getDocs } from 'firebase/firestore'
import { capacityPlan, suggestedCommitment } from '@domain/capacity'
import { points as itemPoints } from '@domain/sprint'
import { velocityReport } from '@domain/reports'
import ItemDialog from '@/components/ItemDialog'
import Icon from '@/components/ui/Icon'
import { Avatar, Panel, Points, PriorityBadge, StatusBadge, TypeIcon } from '@/components/ui/Bits'
import { Empty, ErrorState, Loading } from '@/components/ui/States'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { useFetch, usePagedQuery } from '@/lib/hooks'
import { backlogQuery, patchItem, patchItems } from '@/lib/data/items'
import { completedSprintsQuery } from '@/lib/data/sprints'
import { PAGE_SIZE } from '@/lib/constants'
import { pts } from '@/lib/format'
import { toReportSprint } from '@/lib/sprint-ui'
import type { Item, Sprint } from '@/lib/types'

interface Props {
  orgId: string
  sprint: Sprint
  items: Item[]
  itemsLoading: boolean
  itemsError: Error | null
  uid: string
}

function Row({ item, action }: { item: Item; action?: React.ReactNode }) {
  const { member, memberName } = useOrg()
  const assignee = member(item.assigneeId)
  return (
    <li className="item-row plan-row">
      <TypeIcon type={item.type} />
      <span className="item-key">{item.key}</span>
      <span className="hide-sm">
        {item.assigneeId ? <Avatar name={memberName(item.assigneeId)} uid={item.assigneeId} src={assignee?.photoURL} size={20} /> : <span className="subtle xsmall">-</span>}
      </span>
      <span className="stack-sm" style={{ gap: 2, minWidth: 0 }}>
        <Link className="item-title truncate" href={`/item/?id=${item.id}`}>{item.title}</Link>
        <span className="row xsmall">
          <StatusBadge status={item.status} />
          <PriorityBadge priority={item.priority} />
          {item.carryoverCount ? <span className="badge badge--warning">Carried over {item.carryoverCount}x</span> : null}
        </span>
      </span>
      <Points value={item.storyPoints} />
      <span>{action}</span>
    </li>
  )
}

/** Moves work between the product backlog and this sprint, against capacity and velocity. */
export default function PlanningTab({ orgId, sprint, items, itemsLoading, itemsError, uid }: Props) {
  const { can, project } = useOrg()
  const toast = useToaster()
  const editable = can('items.write') && sprint.status !== 'completed'
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const backlog = usePagedQuery<Item>(() => backlogQuery(orgId, sprint.projectId), `plan-backlog:${orgId}:${sprint.projectId}`, PAGE_SIZE)
  const candidates = backlog.items.filter((i) => i.type !== 'epic')

  const velocity = useFetch(async () => {
    const snap = await getDocs(completedSprintsQuery(orgId, sprint.projectId, 6))
    return velocityReport(snap.docs.map((d) => toReportSprint({ id: d.id, ...d.data() } as Sprint)))
  }, `plan-vel:${orgId}:${sprint.projectId}`)

  const plan = useMemo(() => capacityPlan(sprint.capacity, items), [sprint.capacity, items])
  const planned = useMemo(() => items.filter((i) => i.type !== 'epic').reduce((s, i) => s + itemPoints(i), 0), [items])
  const average = velocity.data?.average ?? null
  const suggestion = suggestedCommitment(average, plan.totalCapacity)
  const unestimated = items.filter((i) => i.type !== 'epic' && (i.storyPoints === null || i.storyPoints === undefined)).length

  const sortedItems = useMemo(() => [...items].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)), [items])

  const add = async (ids: string[]) => {
    if (!ids.length) return
    setBusy(true)
    try {
      if (ids.length === 1) await patchItem(orgId, ids[0], { sprintId: sprint.id }, uid)
      else await patchItems(orgId, ids, { sprintId: sprint.id }, uid)
      ids.forEach((id) => backlog.patch(id, null))
      setSelected(new Set())
      toast.success(`Added ${ids.length} item${ids.length === 1 ? '' : 's'} to ${sprint.name}`)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (item: Item) => {
    setBusy(true)
    try {
      await patchItem(orgId, item.id, { sprintId: null }, uid)
      backlog.reload()
      toast.success(`${item.key} moved back to the backlog`)
    } catch (err) {
      toast.error(err)
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="stack">
      <div className="plan-totals">
        <div>
          <div className="subtle">Planned</div>
          <strong>{pts(planned)}</strong>
          <div className="xsmall muted">{items.length} items{unestimated ? ` · ${unestimated} unestimated` : ''}</div>
        </div>
        <div>
          <div className="subtle">Team capacity</div>
          <strong>{plan.totalCapacity ? pts(plan.totalCapacity) : '-'}</strong>
          <div className="xsmall muted">{plan.totalCapacity ? 'From the Capacity tab' : 'Not entered yet'}</div>
        </div>
        <div>
          <div className="subtle">Average velocity</div>
          <strong>{average !== null ? pts(average) : '-'}</strong>
          <div className="xsmall muted">{velocity.loading ? 'Loading...' : velocity.error ? 'Could not load' : velocity.data?.message ?? `Last ${velocity.data?.averageOf} sprints`}</div>
        </div>
        <div>
          <div className="subtle">Suggested commitment</div>
          <strong>{suggestion !== null ? pts(suggestion) : '-'}</strong>
          <div className="xsmall muted">{suggestion !== null ? 'Lower of velocity and capacity' : 'Needs velocity or capacity'}</div>
        </div>
      </div>

      {suggestion !== null && planned > suggestion ? (
        <div className="notice notice--warning" role="status">
          <Icon name="alert" size={16} />
          <span>
            {pts(planned)} planned is above the suggested {pts(suggestion)}. Consider moving lower-priority items back to the backlog.
          </span>
        </div>
      ) : null}
      {sprint.status === 'active' ? (
        <div className="notice notice--info" role="note">
          <Icon name="clock" size={16} />
          <span>This sprint is running. Items added or removed now are recorded as scope changes in the sprint history.</span>
        </div>
      ) : null}

      <div className="plan-grid">
        <Panel
          title={`In ${sprint.name}`}
          actions={
            editable ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setCreating(true)} disabled={project?.id !== sprint.projectId}>
                <Icon name="plus" /> New item
              </button>
            ) : null
          }
        >
          {itemsLoading ? (
            <Loading rows={4} />
          ) : itemsError ? (
            <ErrorState error={itemsError} />
          ) : sortedItems.length === 0 ? (
            <Empty icon="zap" title="Nothing planned yet">{editable ? 'Add items from the backlog on the right.' : 'No items were planned into this sprint.'}</Empty>
          ) : (
            <ul className="item-list">
              {sortedItems.map((i) => (
                <Row
                  key={i.id}
                  item={i}
                  action={
                    editable ? (
                      <button type="button" className="icon-btn icon-btn--sm" aria-label={`Move ${i.key} back to the backlog`} disabled={busy} onClick={() => remove(i)}>
                        <Icon name="close" />
                      </button>
                    ) : null
                  }
                />
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Product backlog"
          actions={
            editable && selected.size ? (
              <button type="button" className="btn btn-accent btn-sm" disabled={busy} onClick={() => add([...selected])}>
                Add {selected.size} selected
              </button>
            ) : null
          }
        >
          {!editable ? (
            <p className="muted small">{sprint.status === 'completed' ? 'This sprint is completed; its plan is frozen.' : 'Viewers cannot change the sprint plan.'}</p>
          ) : backlog.loading ? (
            <Loading rows={4} />
          ) : backlog.error ? (
            <ErrorState error={backlog.error} onRetry={backlog.reload} />
          ) : candidates.length === 0 ? (
            <Empty icon="list" title="Backlog is empty">Create items in the backlog or here with New item.</Empty>
          ) : (
            <>
              <ul className="item-list">
                {candidates.map((i) => (
                  <Row
                    key={i.id}
                    item={i}
                    action={
                      <span className="row" style={{ flexWrap: 'nowrap' }}>
                        <input type="checkbox" className="checkbox" aria-label={`Select ${i.key}`} checked={selected.has(i.id)} onChange={() => toggle(i.id)} />
                        <button type="button" className="icon-btn icon-btn--sm" aria-label={`Add ${i.key} to ${sprint.name}`} disabled={busy} onClick={() => add([i.id])}>
                          <Icon name="plus" />
                        </button>
                      </span>
                    }
                  />
                ))}
              </ul>
              {backlog.hasMore ? (
                <div className="list-footer">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={backlog.loadMore} disabled={backlog.loadingMore}>
                    {backlog.loadingMore ? 'Loading...' : 'Load more'}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </Panel>
      </div>

      <ItemDialog open={creating} onClose={() => setCreating(false)} defaults={{ sprintId: sprint.id }} />
    </div>
  )
}
