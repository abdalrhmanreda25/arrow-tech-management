'use client'

import { useState } from 'react'
import { isDone, points } from '@domain/sprint'
import Dialog from '@/components/ui/Dialog'
import Alert from '@/components/ui/Alert'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { useLiveQuery, useOnline } from '@/lib/hooks'
import { api } from '@/lib/api'
import { sprintsQuery } from '@/lib/data/sprints'
import { friendlyError } from '@/lib/errors'
import { formatDate, pts } from '@/lib/format'
import type { Item, Sprint } from '@/lib/types'

const counted = (items: Item[]) => items.filter((i) => i.type !== 'epic')

/** Confirms the commitment, then asks the startSprint function to lock it in. */
export function StartSprintDialog({ open, onClose, sprint, items }: { open: boolean; onClose: () => void; sprint: Sprint; items: Item[] }) {
  const { orgId } = useOrg()
  const toast = useToaster()
  const online = useOnline()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const work = counted(items)
  const total = work.reduce((s, i) => s + points(i), 0)
  const unestimated = work.filter((i) => i.storyPoints === null || i.storyPoints === undefined).length

  const start = async () => {
    if (!orgId) return
    setPending(true)
    setError(null)
    try {
      const res = await api.startSprint({ orgId, sprintId: sprint.id })
      toast.success(`${sprint.name} started with ${pts(res.stats.committedPoints)} committed`)
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Start ${sprint.name}?`}
      dismissible={!pending}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="button" className="btn btn-accent" onClick={start} disabled={pending || !online}>{pending ? 'Starting...' : 'Start sprint'}</button>
        </>
      }
    >
      <div className="stack">
        {error ? <Alert type="error">{error}</Alert> : null}
        {!online ? <Alert type="error">Starting a sprint needs a connection.</Alert> : null}
        <p className="small">
          {formatDate(sprint.startDate)} - {formatDate(sprint.endDate)}. The commitment is <strong>{work.length} items, {pts(total)}</strong>. From now on every item added, removed or re-estimated is recorded as a scope change.
        </p>
        {work.length === 0 ? <Alert type="error">The sprint is empty. You can start it, but there is nothing to burn down.</Alert> : null}
        {unestimated ? <p className="muted small">{unestimated} item{unestimated === 1 ? ' has' : 's have'} no estimate and count as 0 points.</p> : null}
        {sprint.goal ? <p className="small">Goal: {sprint.goal}</p> : null}
      </div>
    </Dialog>
  )
}

/** Picks where unfinished work goes, then asks the completeSprint function to close the sprint. */
export function CompleteSprintDialog({ open, onClose, sprint, items }: { open: boolean; onClose: () => void; sprint: Sprint; items: Item[] }) {
  const { orgId } = useOrg()
  const toast = useToaster()
  const online = useOnline()
  const planned = useLiveQuery<Sprint>(() => (open && orgId ? sprintsQuery(orgId, sprint.projectId) : null), `cmp:${open}:${orgId}:${sprint.projectId}`)
  const targets = planned.data.filter((s) => s.status === 'planned' && s.id !== sprint.id).sort((a, b) => a.startDate.localeCompare(b.startDate))
  const [mode, setMode] = useState<'backlog' | 'sprint'>('backlog')
  const [targetId, setTargetId] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const work = counted(items)
  const done = work.filter((i) => isDone(i.status))
  const open_ = work.filter((i) => !isDone(i.status))
  const target = targetId || targets[0]?.id || ''

  const complete = async () => {
    if (!orgId) return
    if (mode === 'sprint' && !target) return setError('Pick a planned sprint, or carry work to the backlog.')
    setPending(true)
    setError(null)
    try {
      const res = await api.completeSprint({ orgId, sprintId: sprint.id, carryover: mode, ...(mode === 'sprint' ? { targetSprintId: target } : {}) })
      toast.success(`${sprint.name} completed: ${pts(res.stats.completedPoints)} done, ${res.carriedOver} item${res.carriedOver === 1 ? '' : 's'} carried over`)
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Complete ${sprint.name}?`}
      dismissible={!pending}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="button" className="btn btn-accent" onClick={complete} disabled={pending || !online}>{pending ? 'Completing...' : 'Complete sprint'}</button>
        </>
      }
    >
      <div className="stack">
        {error ? <Alert type="error">{error}</Alert> : null}
        {!online ? <Alert type="error">Completing a sprint needs a connection.</Alert> : null}
        <p className="small">
          <strong>{done.length}</strong> items done ({pts(done.reduce((s, i) => s + points(i), 0))}), <strong>{open_.length}</strong> not done ({pts(open_.reduce((s, i) => s + points(i), 0))}). Closing totals are recalculated from the items and frozen with a snapshot.
        </p>
        {open_.length ? (
          <fieldset className="stack-sm" style={{ border: 0 }}>
            <legend className="label">Move unfinished items to</legend>
            <label className="radio-row">
              <input type="radio" name="carry" checked={mode === 'backlog'} onChange={() => setMode('backlog')} /> The product backlog
            </label>
            <label className="radio-row">
              <input type="radio" name="carry" checked={mode === 'sprint'} disabled={!targets.length} onChange={() => setMode('sprint')} /> A planned sprint
              {!targets.length && !planned.loading ? <span className="subtle xsmall">(none planned)</span> : null}
            </label>
            {mode === 'sprint' && targets.length ? (
              <select className="input" aria-label="Target sprint" value={target} onChange={(e) => setTargetId(e.target.value)}>
                {targets.map((s) => <option key={s.id} value={s.id}>{s.name} ({formatDate(s.startDate)})</option>)}
              </select>
            ) : null}
            <p className="muted xsmall">Each moved item has its carryover count increased, which feeds the carryover report.</p>
          </fieldset>
        ) : null}
      </div>
    </Dialog>
  )
}
