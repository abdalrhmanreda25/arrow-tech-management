'use client'

import { useEffect, useMemo, useState } from 'react'
import { capacityPlan, type MemberCapacity } from '@domain/capacity'
import { Avatar, Panel, Progress } from '@/components/ui/Bits'
import { PermissionNotice } from '@/components/ui/States'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { updateSprint } from '@/lib/data/sprints'
import { pct, pts } from '@/lib/format'
import { workingDays } from '@/lib/sprint-ui'
import type { Item, Sprint } from '@/lib/types'

type Draft = Record<string, { days: string; pointsPerDay: string }>

const toDraft = (cap: Sprint['capacity']): Draft =>
  Object.fromEntries(Object.entries(cap ?? {}).map(([uid, c]) => [uid, { days: String(c.days ?? ''), pointsPerDay: String(c.pointsPerDay ?? '') }]))

function clean(draft: Draft): Record<string, MemberCapacity> {
  const out: Record<string, MemberCapacity> = {}
  for (const [uid, v] of Object.entries(draft)) {
    const days = Number(v.days)
    const rate = Number(v.pointsPerDay)
    if ((Number.isFinite(days) && days > 0) || (Number.isFinite(rate) && rate > 0)) {
      out[uid] = { days: Number.isFinite(days) && days > 0 ? Math.min(days, 60) : 0, pointsPerDay: Number.isFinite(rate) && rate > 0 ? Math.min(rate, 20) : 0 }
    }
  }
  return out
}

/** Per-person availability for the sprint, compared with the work assigned to them. */
export default function CapacityTab({ orgId, sprint, items, uid }: { orgId: string; sprint: Sprint; items: Item[]; uid: string }) {
  const { members, memberName, member, can } = useOrg()
  const toast = useToaster()
  const editable = can('sprints.manage') && sprint.status !== 'completed'
  const [draft, setDraft] = useState<Draft>(() => toDraft(sprint.capacity))
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const days = workingDays(sprint.startDate, sprint.endDate)

  useEffect(() => {
    if (!dirty) setDraft(toDraft(sprint.capacity))
  }, [sprint.capacity, dirty])

  const effective = dirty ? clean(draft) : sprint.capacity
  const plan = useMemo(() => capacityPlan(effective, items), [effective, items])
  const rowFor = (id: string) => plan.rows.find((r) => r.uid === id)
  const people = useMemo(() => {
    const ids = new Set(members.map((m) => m.uid))
    // Assignees who have since left the org still carry planned points.
    plan.rows.forEach((r) => ids.add(r.uid))
    return [...ids]
  }, [members, plan.rows])

  const setField = (id: string, field: 'days' | 'pointsPerDay', value: string) => {
    setDirty(true)
    setDraft((d) => ({ ...d, [id]: { days: d[id]?.days ?? '', pointsPerDay: d[id]?.pointsPerDay ?? '', [field]: value } }))
  }

  const fillDays = () => {
    setDirty(true)
    setDraft((d) => Object.fromEntries(members.map((m) => [m.uid, { days: String(days), pointsPerDay: d[m.uid]?.pointsPerDay || '1' }])))
  }

  const save = async () => {
    setSaving(true)
    try {
      await updateSprint(orgId, sprint.id, { capacity: clean(draft) }, uid)
      setDirty(false)
      toast.success('Capacity saved')
    } catch (err) {
      toast.error(err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="stack">
      {!editable ? (
        <PermissionNotice>{sprint.status === 'completed' ? 'Capacity is frozen for completed sprints.' : 'Only managers can edit capacity. You can see the plan below.'}</PermissionNotice>
      ) : null}
      <Panel
        title="Capacity planning"
        actions={
          editable ? (
            <>
              <button type="button" className="btn btn-ghost btn-sm" onClick={fillDays}>Fill {days} working days</button>
              <button type="button" className="btn btn-accent btn-sm" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving...' : 'Save capacity'}</button>
            </>
          ) : null
        }
      >
        <p className="muted small" style={{ marginBottom: 12 }}>
          Capacity = available days x points per day. The sprint has {days} working days (Mon-Fri). Planned points come from the story points of items assigned to each person.
        </p>
        <div className="table-scroll">
          <table className="data-table cap-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Days available</th>
                <th>Points / day</th>
                <th>Capacity</th>
                <th>Planned</th>
                <th>Load</th>
              </tr>
            </thead>
            <tbody>
              {people.map((id) => {
                const r = rowFor(id)
                const d = draft[id]
                const cap = r?.capacityPoints ?? 0
                const planned = r?.plannedPoints ?? 0
                const over = planned > cap
                return (
                  <tr key={id}>
                    <td data-label="Member">
                      <span className="who">
                        <Avatar name={memberName(id)} uid={id} src={member(id)?.photoURL} size={22} /> {memberName(id)}
                      </span>
                    </td>
                    <td data-label="Days available">
                      {editable ? (
                        <input className="input" type="number" min={0} max={60} step={0.5} aria-label={`Days available for ${memberName(id)}`} value={d?.days ?? ''} onChange={(e) => setField(id, 'days', e.target.value)} />
                      ) : (
                        sprint.capacity?.[id]?.days ?? '-'
                      )}
                    </td>
                    <td data-label="Points / day">
                      {editable ? (
                        <input className="input" type="number" min={0} max={20} step={0.1} aria-label={`Points per day for ${memberName(id)}`} value={d?.pointsPerDay ?? ''} onChange={(e) => setField(id, 'pointsPerDay', e.target.value)} />
                      ) : (
                        sprint.capacity?.[id]?.pointsPerDay ?? '-'
                      )}
                    </td>
                    <td data-label="Capacity">{cap ? pts(cap) : '-'}</td>
                    <td data-label="Planned" className={over && planned > 0 ? 'is-over' : ''}>{pts(planned)}</td>
                    <td data-label="Load" style={{ minWidth: 120 }}>
                      {cap > 0 ? (
                        <>
                          <Progress value={planned} max={cap} label={`${memberName(id)} load`} />
                          <span className={`xsmall ${over ? 'is-over' : 'muted'}`}>{pct(planned / cap)}{over ? ' · over capacity' : ''}</span>
                        </>
                      ) : planned > 0 ? (
                        <span className="xsmall is-over">No capacity entered</span>
                      ) : (
                        <span className="xsmall subtle">-</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="row small" style={{ marginTop: 12, gap: 24 }}>
          <span>Total capacity <strong>{pts(plan.totalCapacity)}</strong></span>
          <span>Total planned <strong>{pts(plan.totalPlanned)}</strong></span>
          <span>Unassigned <strong>{pts(plan.unassignedPoints)}</strong></span>
        </div>
      </Panel>
    </div>
  )
}
