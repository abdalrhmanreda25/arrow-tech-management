'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Dialog from '@/components/ui/Dialog'
import Field from '@/components/ui/Field'
import Alert from '@/components/ui/Alert'
import Icon from '@/components/ui/Icon'
import MemberSelect from '@/components/MemberSelect'
import { Avatar } from '@/components/ui/Bits'
import { Empty, ErrorState, Loading, PermissionNotice } from '@/components/ui/States'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { useLiveQuery } from '@/lib/hooks'
import { createCeremony, deleteCeremony, sprintCeremoniesQuery, updateCeremony } from '@/lib/data/activity'
import { CEREMONY_TYPES, ceremonyLabel } from '@/lib/constants'
import { friendlyError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { toLocalInput } from '@/lib/sprint-ui'
import type { ActionItem, Ceremony, CeremonyType, Sprint } from '@/lib/types'

interface Draft {
  type: CeremonyType
  title: string
  when: string
  durationMinutes: number
  status: Ceremony['status']
  notes: string
  decisions: string
  actionItems: ActionItem[]
  attendeeIds: string[]
}

function blank(sprint: Sprint, type: CeremonyType = 'planning'): Draft {
  const meta = CEREMONY_TYPES.find((c) => c.id === type)!
  const day = type === 'review' || type === 'retrospective' ? sprint.endDate : sprint.startDate
  const at = new Date(`${day}T10:00:00`)
  return { type, title: meta.label, when: toLocalInput(at), durationMinutes: meta.minutes, status: 'scheduled', notes: '', decisions: '', actionItems: [], attendeeIds: [] }
}

const fromCeremony = (c: Ceremony): Draft => ({
  type: c.type,
  title: c.title,
  when: toLocalInput(c.scheduledAt?.toDate?.() ?? new Date()),
  durationMinutes: c.durationMinutes ?? 60,
  status: c.status,
  notes: c.notes ?? '',
  decisions: c.decisions ?? '',
  actionItems: c.actionItems ?? [],
  attendeeIds: c.attendeeIds ?? [],
})

function CeremonyDialog({ open, onClose, sprint, editing, orgId, uid }: { open: boolean; onClose: () => void; sprint: Sprint; editing: Ceremony | null; orgId: string; uid: string }) {
  const { members } = useOrg()
  const toast = useToaster()
  const [d, setD] = useState<Draft>(() => blank(sprint))
  const [newAction, setNewAction] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setD(editing ? fromCeremony(editing) : blank(sprint))
    setNewAction('')
    setError(null)
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }))

  const changeType = (type: CeremonyType) => {
    const meta = CEREMONY_TYPES.find((c) => c.id === type)!
    const wasDefault = CEREMONY_TYPES.some((c) => c.label === d.title) || !d.title
    set({ type, durationMinutes: meta.minutes, ...(wasDefault ? { title: meta.label } : {}) })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const at = new Date(d.when)
    if (Number.isNaN(at.getTime())) return setError('Pick a date and time.')
    setPending(true)
    setError(null)
    const payload = {
      type: d.type,
      title: d.title.trim() || ceremonyLabel(d.type),
      scheduledAt: at,
      durationMinutes: Math.max(5, Math.min(480, Number(d.durationMinutes) || 60)),
      status: d.status,
      notes: d.notes,
      decisions: d.decisions,
      actionItems: d.actionItems.filter((a) => a.text.trim()).slice(0, 50),
      attendeeIds: d.attendeeIds,
    }
    try {
      if (editing) await updateCeremony(orgId, editing.id, payload, uid)
      else await createCeremony(orgId, { ...payload, sprintId: sprint.id, projectId: sprint.projectId }, uid)
      toast.success(editing ? 'Ceremony updated' : 'Ceremony scheduled')
      onClose()
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  const toggleAttendee = (id: string) => set({ attendeeIds: d.attendeeIds.includes(id) ? d.attendeeIds.filter((x) => x !== id) : [...d.attendeeIds, id] })

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${editing.title}` : 'Schedule a ceremony'}
      size="lg"
      dismissible={!pending}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" form="ceremony-form" className="btn btn-accent" disabled={pending}>{pending ? 'Saving...' : 'Save'}</button>
        </>
      }
    >
      <form id="ceremony-form" className="stack" onSubmit={submit}>
        {error ? <Alert type="error">{error}</Alert> : null}
        <div className="form-grid form-grid--2">
          <Field label="Type">
            {(p) => (
              <select {...p} className="input" value={d.type} onChange={(e) => changeType(e.target.value as CeremonyType)}>
                {CEREMONY_TYPES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            )}
          </Field>
          <Field label="Title">
            {(p) => <input {...p} className="input" maxLength={120} value={d.title} onChange={(e) => set({ title: e.target.value })} />}
          </Field>
          <Field label="When">
            {(p) => <input {...p} className="input" type="datetime-local" required value={d.when} onChange={(e) => set({ when: e.target.value })} />}
          </Field>
          <Field label="Duration (minutes)">
            {(p) => <input {...p} className="input" type="number" min={5} max={480} step={5} value={d.durationMinutes} onChange={(e) => set({ durationMinutes: Number(e.target.value) })} />}
          </Field>
          <Field label="Status">
            {(p) => (
              <select {...p} className="input" value={d.status} onChange={(e) => set({ status: e.target.value as Ceremony['status'] })}>
                <option value="scheduled">Scheduled</option>
                <option value="held">Held</option>
                <option value="cancelled">Cancelled</option>
              </select>
            )}
          </Field>
          <div className="field">
            <span className="label">Attendees</span>
            <div className="check-list">
              {members.map((m) => (
                <label key={m.uid}>
                  <input type="checkbox" className="checkbox" checked={d.attendeeIds.includes(m.uid)} onChange={() => toggleAttendee(m.uid)} /> {m.displayName}
                </label>
              ))}
            </div>
          </div>
          <Field label="Notes" optional full>
            {(p) => <textarea {...p} className="input" rows={4} maxLength={20000} value={d.notes} onChange={(e) => set({ notes: e.target.value })} />}
          </Field>
          <Field label="Decisions" optional full>
            {(p) => <textarea {...p} className="input" rows={3} maxLength={10000} value={d.decisions} onChange={(e) => set({ decisions: e.target.value })} />}
          </Field>
        </div>
        <div className="stack-sm">
          <span className="label">Action items</span>
          {d.actionItems.map((a, i) => (
            <div key={i} className="action-edit">
              <input className="input" aria-label={`Action item ${i + 1}`} maxLength={300} value={a.text} onChange={(e) => set({ actionItems: d.actionItems.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
              <MemberSelect aria-label={`Owner of action item ${i + 1}`} emptyLabel="No owner" value={a.ownerId ?? null} onChange={(ownerId) => set({ actionItems: d.actionItems.map((x, j) => (j === i ? { ...x, ownerId } : x)) })} />
              <label className="radio-row">
                <input type="checkbox" className="checkbox" checked={a.done} onChange={() => set({ actionItems: d.actionItems.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })} /> Done
              </label>
              <button type="button" className="icon-btn icon-btn--sm" aria-label={`Remove action item ${i + 1}`} onClick={() => set({ actionItems: d.actionItems.filter((_, j) => j !== i) })}>
                <Icon name="trash" />
              </button>
            </div>
          ))}
          <div className="inline-form">
            <input className="input" aria-label="New action item" placeholder="Add an action item" maxLength={300} value={newAction} onChange={(e) => setNewAction(e.target.value)} />
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!newAction.trim() || d.actionItems.length >= 50}
              onClick={() => {
                set({ actionItems: [...d.actionItems, { text: newAction.trim(), done: false, ownerId: null }] })
                setNewAction('')
              }}
            >
              <Icon name="plus" /> Add
            </button>
          </div>
        </div>
      </form>
    </Dialog>
  )
}

/** Planning, stand-ups, refinement, review and retrospective for this sprint, with notes and action items. */
export default function CeremoniesTab({ orgId, sprint, uid }: { orgId: string; sprint: Sprint; uid: string }) {
  const { can, memberName, member } = useOrg()
  const toast = useToaster()
  const list = useLiveQuery<Ceremony>(() => sprintCeremoniesQuery(orgId, sprint.id), `cer:${orgId}:${sprint.id}`)
  const [dialog, setDialog] = useState<{ open: boolean; editing: Ceremony | null }>({ open: false, editing: null })
  const [toDelete, setToDelete] = useState<Ceremony | null>(null)
  const writable = can('ceremonies.write')

  const toggleAction = async (c: Ceremony, index: number) => {
    try {
      await updateCeremony(orgId, c.id, { actionItems: (c.actionItems ?? []).map((a, i) => (i === index ? { ...a, done: !a.done } : a)) }, uid)
    } catch (err) {
      toast.error(err)
    }
  }

  const remove = async () => {
    if (!toDelete) return
    try {
      await deleteCeremony(orgId, toDelete.id)
      toast.success('Ceremony deleted')
      setToDelete(null)
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted small">Record what happened in each Scrum event so decisions and follow-ups stay with the sprint.</p>
        {writable ? (
          <button type="button" className="btn btn-accent btn-sm" onClick={() => setDialog({ open: true, editing: null })}>
            <Icon name="plus" /> Schedule ceremony
          </button>
        ) : null}
      </div>
      {!writable ? <PermissionNotice>Viewers can read ceremonies but not record them.</PermissionNotice> : null}
      {list.loading ? (
        <Loading rows={3} />
      ) : list.error ? (
        <ErrorState error={list.error} />
      ) : list.data.length === 0 ? (
        <Empty icon="calendar" title="No ceremonies recorded">Schedule sprint planning, stand-ups, the review and the retrospective here.</Empty>
      ) : (
        <div>
          {list.data.map((c) => {
            const canDelete = can('items.deleteAny') || (writable && c.createdBy === uid)
            const actions = c.actionItems ?? []
            return (
              <article key={c.id} className="card ceremony-card">
                <div className="row-between">
                  <div>
                    <div className="row">
                      <strong>{c.title}</strong>
                      <span className="badge">{ceremonyLabel(c.type)}</span>
                      <span className={`badge ${c.status === 'held' ? 'badge--success' : c.status === 'cancelled' ? 'badge--danger' : 'badge--info'}`}>{c.status}</span>
                    </div>
                    <div className="muted small">
                      {formatDateTime(c.scheduledAt)} · {c.durationMinutes ?? 60} min
                    </div>
                  </div>
                  <div className="row">
                    {(c.attendeeIds ?? []).slice(0, 8).map((id) => (
                      <Avatar key={id} name={memberName(id)} uid={id} src={member(id)?.photoURL} size={22} />
                    ))}
                    {writable ? (
                      <button type="button" className="icon-btn icon-btn--sm" aria-label={`Edit ${c.title}`} onClick={() => setDialog({ open: true, editing: c })}>
                        <Icon name="edit" />
                      </button>
                    ) : null}
                    {canDelete ? (
                      <button type="button" className="icon-btn icon-btn--sm" aria-label={`Delete ${c.title}`} onClick={() => setToDelete(c)}>
                        <Icon name="trash" />
                      </button>
                    ) : null}
                  </div>
                </div>
                {c.notes ? <p className="prose" style={{ marginTop: 8 }}>{c.notes}</p> : null}
                {c.decisions ? (
                  <div style={{ marginTop: 8 }}>
                    <div className="subtle xsmall">Decisions</div>
                    <p className="prose">{c.decisions}</p>
                  </div>
                ) : null}
                {actions.length ? (
                  <ul className="action-items">
                    {actions.map((a, i) => (
                      <li key={i} className={a.done ? 'is-done' : ''}>
                        <input type="checkbox" className="checkbox" checked={a.done} disabled={!writable} aria-label={`Mark "${a.text}" ${a.done ? 'not done' : 'done'}`} onChange={() => toggleAction(c, i)} />
                        <span>{a.text}</span>
                        {a.ownerId ? <span className="subtle xsmall">· {memberName(a.ownerId)}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </article>
            )
          })}
        </div>
      )}

      <CeremonyDialog open={dialog.open} editing={dialog.editing} onClose={() => setDialog({ open: false, editing: null })} sprint={sprint} orgId={orgId} uid={uid} />
      <Dialog
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        title="Delete this ceremony?"
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setToDelete(null)}>Cancel</button>
            <button type="button" className="btn btn-danger" onClick={remove}>Delete</button>
          </>
        }
      >
        <p className="small">Its notes, decisions and action items are removed for everyone.</p>
      </Dialog>
    </div>
  )
}
