'use client'

import { useState, type FormEvent } from 'react'
import Dialog from '@/components/ui/Dialog'
import Field from '@/components/ui/Field'
import Alert from '@/components/ui/Alert'
import MemberSelect from '@/components/MemberSelect'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { useLiveQuery } from '@/lib/hooks'
import { createItem, epicsQuery, type ItemInput } from '@/lib/data/items'
import { ITEM_TYPES, POINT_SCALE, PRIORITIES, STATUSES } from '@/lib/constants'
import { friendlyError } from '@/lib/errors'
import type { Item, ItemType, Priority } from '@/lib/types'

interface Props {
  open: boolean
  onClose: () => void
  /** Pre-fill: e.g. sprint planning creates straight into a sprint. */
  defaults?: Partial<ItemInput>
  onCreated?: (item: { id: string; key: string }) => void
}

/** Create a story, task, bug or epic in the current project. */
export default function ItemDialog({ open, onClose, defaults, onCreated }: Props) {
  const { user } = useAuth()
  const { orgId, project } = useOrg()
  const toast = useToaster()
  const epics = useLiveQuery<Item>(() => (open && orgId && project ? epicsQuery(orgId, project.id) : null), `epics:${open}:${orgId}:${project?.id}`)
  const [type, setType] = useState<ItemType>(defaults?.type ?? 'story')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>(defaults?.priority ?? 'medium')
  const [points, setPoints] = useState<string>('')
  const [assigneeId, setAssigneeId] = useState<string | null>(defaults?.assigneeId ?? null)
  const [epicId, setEpicId] = useState<string | null>(defaults?.epicId ?? null)
  const [dueDate, setDueDate] = useState('')
  const [startDate, setStartDate] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setTitle('')
    setDescription('')
    setPoints('')
    setDueDate('')
    setStartDate('')
    setTargetDate('')
    setError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!orgId || !project || !user) return
    const sp = points === '' ? null : Number(points)
    if (sp !== null && (!Number.isFinite(sp) || sp < 0 || sp > 100)) return setError('Story points must be between 0 and 100.')
    setPending(true)
    setError(null)
    try {
      const created = await createItem(
        orgId,
        {
          ...defaults,
          projectId: project.id,
          type,
          title,
          description,
          priority,
          storyPoints: sp,
          assigneeId,
          epicId: type === 'epic' ? null : epicId,
          dueDate: dueDate || null,
          startDate: type === 'epic' ? startDate || null : null,
          targetDate: type === 'epic' ? targetDate || null : null,
          status: defaults?.status ?? 'todo',
          sprintId: type === 'epic' ? null : defaults?.sprintId ?? null,
        },
        user.uid,
      )
      toast.success(`Created ${created.key}`)
      onCreated?.(created)
      reset()
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
      title={`New ${ITEM_TYPES.find((t) => t.id === type)?.label.toLowerCase()} in ${project?.key ?? ''}`}
      size="lg"
      dismissible={!pending}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" form="item-form" className="btn btn-accent" disabled={pending || !title.trim()}>
            {pending ? 'Creating...' : 'Create'}
          </button>
        </>
      }
    >
      <form id="item-form" className="stack" onSubmit={submit}>
        {error ? <Alert type="error">{error}</Alert> : null}
        <div className="form-grid form-grid--2">
          <Field label="Type">
            {(p) => (
              <select {...p} className="input" value={type} onChange={(e) => setType(e.target.value as ItemType)}>
                {ITEM_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            )}
          </Field>
          <Field label="Priority">
            {(p) => (
              <select {...p} className="input" value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            )}
          </Field>
          <Field label="Title" full>
            {(p) => <input {...p} className="input" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />}
          </Field>
          <Field label="Description" optional full>
            {(p) => <textarea {...p} className="input" rows={4} maxLength={20000} value={description} onChange={(e) => setDescription(e.target.value)} />}
          </Field>
          {type !== 'epic' ? (
            <>
              <Field label="Story points" optional hint={`Common: ${POINT_SCALE.join(', ')}`}>
                {(p) => <input {...p} className="input" type="number" min={0} max={100} step={0.5} value={points} onChange={(e) => setPoints(e.target.value)} />}
              </Field>
              <Field label="Epic" optional>
                {(p) => (
                  <select {...p} className="input" value={epicId ?? ''} onChange={(e) => setEpicId(e.target.value || null)}>
                    <option value="">None</option>
                    {epics.data.map((ep) => <option key={ep.id} value={ep.id}>{ep.key} {ep.title}</option>)}
                  </select>
                )}
              </Field>
            </>
          ) : (
            <>
              <Field label="Start date" optional hint="Shown on the roadmap">
                {(p) => <input {...p} className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}
              </Field>
              <Field label="Target date" optional>
                {(p) => <input {...p} className="input" type="date" min={startDate || undefined} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />}
              </Field>
            </>
          )}
          <Field label="Assignee" optional>
            {(p) => <MemberSelect {...p} value={assigneeId} onChange={setAssigneeId} />}
          </Field>
          <Field label="Due date" optional>
            {(p) => <input {...p} className="input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}
          </Field>
        </div>
        {defaults?.sprintId && type !== 'epic' ? <p className="muted small">This item will be added to the sprint you are planning.</p> : null}
        {defaults?.status && defaults.status !== 'todo' ? <p className="muted small">Starts as {STATUSES.find((s) => s.id === defaults.status)?.label}.</p> : null}
      </form>
    </Dialog>
  )
}
