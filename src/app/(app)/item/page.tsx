'use client'

import { Suspense, useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import PageHeader from '@/components/ui/PageHeader'
import Icon from '@/components/ui/Icon'
import Alert from '@/components/ui/Alert'
import Dialog from '@/components/ui/Dialog'
import Field from '@/components/ui/Field'
import MemberSelect from '@/components/MemberSelect'
import { Avatar, Panel, Points, Progress, StatusBadge, TypeIcon } from '@/components/ui/Bits'
import { Empty, ErrorState, Loading, PermissionNotice } from '@/components/ui/States'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { useLiveDoc, useLiveQuery } from '@/lib/hooks'
import { deleteItem, epicItemsQuery, epicsQuery, saveItem, type ItemPatch } from '@/lib/data/items'
import { sprintsQuery } from '@/lib/data/sprints'
import {
  addComment,
  attachmentsQuery,
  attachmentUrl,
  commentsQuery,
  deleteAttachment,
  deleteComment,
  MAX_ATTACHMENT_BYTES,
  uploadAttachment,
} from '@/lib/data/activity'
import { orgItem } from '@/lib/data/refs'
import { parseLabels } from '@/lib/board'
import { ITEM_TYPES, PRIORITIES, STATUSES } from '@/lib/constants'
import { ConflictError, friendlyError } from '@/lib/errors'
import { formatDateTime, pts, relativeTime } from '@/lib/format'
import type { Attachment, Comment, Item, ItemStatus, ItemType, Priority, Sprint } from '@/lib/types'
import '../../delivery-a.css'

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain,text/csv,text/markdown,application/zip,application/json,.docx,.xlsx,.pptx'

interface FormState {
  title: string
  description: string
  type: ItemType
  status: ItemStatus
  priority: Priority
  storyPoints: string
  assigneeId: string | null
  epicId: string | null
  sprintId: string | null
  dueDate: string
  startDate: string
  targetDate: string
  labels: string
}

const toForm = (i: Item): FormState => ({
  title: i.title,
  description: i.description ?? '',
  type: i.type,
  status: i.status,
  priority: i.priority,
  storyPoints: i.storyPoints === null || i.storyPoints === undefined ? '' : String(i.storyPoints),
  assigneeId: i.assigneeId ?? null,
  epicId: i.epicId ?? null,
  sprintId: i.sprintId ?? null,
  dueDate: i.dueDate ?? '',
  startDate: i.startDate ?? '',
  targetDate: i.targetDate ?? '',
  labels: (i.labels ?? []).join(', '),
})

const same = (a: FormState, b: FormState) => (Object.keys(a) as (keyof FormState)[]).every((k) => a[k] === b[k])

function toPatch(f: FormState): ItemPatch | string {
  const sp = f.storyPoints === '' ? null : Number(f.storyPoints)
  if (sp !== null && (!Number.isFinite(sp) || sp < 0 || sp > 100)) return 'Story points must be between 0 and 100.'
  if (!f.title.trim()) return 'Title is required.'
  if (f.type === 'epic' && f.startDate && f.targetDate && f.targetDate < f.startDate) return 'Target date is before the start date.'
  const epic = f.type === 'epic'
  return {
    title: f.title.trim(),
    description: f.description,
    type: f.type,
    status: f.status,
    priority: f.priority,
    storyPoints: epic ? null : sp,
    assigneeId: f.assigneeId,
    epicId: epic ? null : f.epicId,
    sprintId: epic ? null : f.sprintId,
    dueDate: f.dueDate || null,
    startDate: f.startDate || null,
    targetDate: f.targetDate || null,
    labels: parseLabels(f.labels),
  }
}

function Comments({ orgId, item, canWrite, canModerate }: { orgId: string; item: Item; canWrite: boolean; canModerate: boolean }) {
  const { user } = useAuth()
  const { member } = useOrg()
  const toast = useToaster()
  const comments = useLiveQuery<Comment>(() => commentsQuery(orgId, item.id), `c:${orgId}:${item.id}`)
  const [text, setText] = useState('')
  const [pending, setPending] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!user || !text.trim()) return
    setPending(true)
    try {
      await addComment(orgId, item.id, text, { uid: user.uid, displayName: user.displayName })
      setText('')
    } catch (err) {
      toast.error(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <Panel title={`Comments${comments.data.length ? ` (${comments.data.length})` : ''}`}>
      {comments.loading ? (
        <Loading rows={2} />
      ) : comments.error ? (
        <ErrorState error={comments.error} />
      ) : !comments.data.length ? (
        <p className="muted small">No comments yet.</p>
      ) : (
        <div>
          {comments.data.map((c) => {
            const who = member(c.authorId)
            return (
              <div key={c.id} className="comment">
                <Avatar name={who?.displayName ?? c.authorName} uid={c.authorId} src={who?.photoURL} size={28} />
                <div className="comment-body">
                  <div className="comment-meta">
                    <strong>{who?.displayName ?? c.authorName}</strong>
                    <span title={formatDateTime(c.createdAt)}>{relativeTime(c.createdAt)}</span>
                    {c.authorId === user?.uid || canModerate ? (
                      <button type="button" className="text-link xsmall" onClick={() => deleteComment(orgId, item.id, c.id).catch(toast.error)}>
                        Delete
                      </button>
                    ) : null}
                  </div>
                  <p className="prose">{c.text}</p>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {canWrite ? (
        <form className="stack-sm" style={{ marginTop: 12 }} onSubmit={submit}>
          <label className="sr-only" htmlFor="comment">Add a comment</label>
          <textarea id="comment" className="input" rows={3} maxLength={5000} placeholder="Add a comment. The assignee and reporter are notified." value={text} onChange={(e) => setText(e.target.value)} />
          <div className="row">
            <button className="btn btn-secondary btn-sm" disabled={pending || !text.trim()}>{pending ? 'Posting...' : 'Comment'}</button>
          </div>
        </form>
      ) : null}
    </Panel>
  )
}

function Attachments({ orgId, item, canWrite, canModerate }: { orgId: string; item: Item; canWrite: boolean; canModerate: boolean }) {
  const { user } = useAuth()
  const { memberName } = useOrg()
  const toast = useToaster()
  const files = useLiveQuery<Attachment>(() => attachmentsQuery(orgId, item.id), `a:${orgId}:${item.id}`)
  const [progress, setProgress] = useState<number | null>(null)
  const input = useRef<HTMLInputElement>(null)

  const upload = async (file: File | undefined) => {
    if (!file || !user) return
    if (file.size > MAX_ATTACHMENT_BYTES) return toast.error('Files can be at most 10 MB.')
    setProgress(0)
    try {
      await uploadAttachment(orgId, item.id, file, user.uid, setProgress)
      toast.success(`Uploaded ${file.name}`)
    } catch (err) {
      const code = (err as { code?: string }).code
      toast.error(code === 'storage/unauthorized' ? 'Upload refused. Allowed: images, PDF, text, CSV, Markdown, ZIP, JSON and Office files up to 10 MB.' : err)
    } finally {
      setProgress(null)
      if (input.current) input.current.value = ''
    }
  }

  const open = async (a: Attachment) => {
    try {
      window.open(await attachmentUrl(a.path), '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err)
    }
  }

  return (
    <Panel
      title="Attachments"
      actions={
        canWrite ? (
          <>
            <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => upload(e.target.files?.[0])} />
            <button type="button" className="btn btn-ghost btn-sm" disabled={progress !== null} onClick={() => input.current?.click()}>
              <Icon name="paperclip" /> Attach
            </button>
          </>
        ) : null
      }
    >
      {progress !== null ? <Progress value={Math.round(progress * 100)} max={100} label="Upload progress" /> : null}
      {files.loading ? (
        <Loading rows={1} />
      ) : files.error ? (
        <ErrorState error={files.error} />
      ) : !files.data.length ? (
        <p className="muted small">No files. Up to 10 MB each.</p>
      ) : (
        <ul className="attach-list">
          {files.data.map((a) => (
            <li key={a.id}>
              <Icon name="file" />
              <button type="button" className="text-link attach-name truncate" onClick={() => open(a)} title={a.name}>
                {a.name}
              </button>
              <span className="xsmall subtle nowrap">{Math.max(1, Math.round(a.size / 1024))} KB · {memberName(a.uploadedBy)}</span>
              {a.uploadedBy === user?.uid || canModerate ? (
                <button type="button" className="icon-btn icon-btn--sm icon-btn--plain" aria-label={`Delete ${a.name}`} onClick={() => deleteAttachment(orgId, item.id, a.id, a.path).catch(toast.error)}>
                  <Icon name="trash" size={14} />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function EpicChildren({ orgId, epic }: { orgId: string; epic: Item }) {
  const children = useLiveQuery<Item>(() => epicItemsQuery(orgId, epic.id), `ec:${orgId}:${epic.id}`)
  const total = children.data.reduce((s, i) => s + (i.storyPoints ?? 0), 0)
  const done = children.data.filter((i) => i.status === 'done').reduce((s, i) => s + (i.storyPoints ?? 0), 0)
  return (
    <Panel title="Items in this epic" actions={<span className="muted small">{pts(done)} of {pts(total)} done</span>}>
      {children.loading ? (
        <Loading rows={2} />
      ) : children.error ? (
        <ErrorState error={children.error} />
      ) : !children.data.length ? (
        <p className="muted small">No stories linked yet. Pick this epic when creating or editing a story.</p>
      ) : (
        <>
          <Progress value={done} max={total} label="Epic progress" />
          <ul className="item-list" style={{ marginTop: 12 }}>
            {children.data.map((i) => (
              <li key={i.id} className="item-row" style={{ gridTemplateColumns: 'auto auto minmax(0,1fr) auto auto' }}>
                <TypeIcon type={i.type} />
                <span className="item-key">{i.key}</span>
                <Link className="item-title truncate" href={`/item/?id=${i.id}`}>{i.title}</Link>
                <StatusBadge status={i.status} />
                <Points value={i.storyPoints} />
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}

function ItemView({ id }: { id: string }) {
  const router = useRouter()
  const { user } = useAuth()
  const { orgId, can, memberName } = useOrg()
  const toast = useToaster()
  const uid = user!.uid
  const live = useLiveDoc<Item>(() => (orgId ? orgItem(orgId, 'items', id) : null), `item:${orgId}:${id}`)
  const item = live.data
  const projectId = item?.projectId ?? null
  const epics = useLiveQuery<Item>(() => (orgId && projectId ? epicsQuery(orgId, projectId) : null), `ie:${orgId}:${projectId}`)
  const sprints = useLiveQuery<Sprint>(() => (orgId && projectId ? sprintsQuery(orgId, projectId) : null), `is:${orgId}:${projectId}`)

  const [form, setForm] = useState<FormState | null>(null)
  const [baseVersion, setBaseVersion] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const loadedBase = useRef<FormState | null>(null)

  // Follow live changes while the form is untouched; once the user edits,
  // keep their draft and flag that someone else saved in the meantime.
  useEffect(() => {
    if (!item) return
    const untouched = !form || !loadedBase.current || same(form, loadedBase.current)
    if (untouched) {
      const next = toForm(item)
      loadedBase.current = next
      setForm(next)
      setBaseVersion(item.version)
      setConflict(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item])

  const edited = Boolean(form && loadedBase.current && !same(form, loadedBase.current))
  const changedElsewhere = Boolean(item && baseVersion !== null && item.version > baseVersion && edited)

  const canWrite = can('items.write')
  const canModerate = can('items.deleteAny')
  const canDelete = Boolean(item && (canModerate || (canWrite && item.createdBy === uid)))

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => (f ? { ...f, [key]: value } : f))

  const reloadLatest = () => {
    if (!item) return
    const next = toForm(item)
    loadedBase.current = next
    setForm(next)
    setBaseVersion(item.version)
    setConflict(false)
    setError(null)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!orgId || !form || baseVersion === null) return
    const patch = toPatch(form)
    if (typeof patch === 'string') return setError(patch)
    setSaving(true)
    setError(null)
    try {
      await saveItem(orgId, id, baseVersion, patch, uid)
      // The live listener delivers version + 1; treat the saved form as the new base.
      loadedBase.current = form
      setBaseVersion(baseVersion + 1)
      toast.success('Saved')
    } catch (err) {
      if (err instanceof ConflictError) setConflict(true)
      else setError(friendlyError(err))
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!orgId) return
    setDeleting(true)
    try {
      await deleteItem(orgId, id, user!.uid)
      toast.success(`Deleted ${item?.key}`)
      router.replace('/backlog/')
    } catch (err) {
      toast.error(err)
      setDeleting(false)
    }
  }

  if (live.loading) return <Loading />
  if (live.error) return <ErrorState error={live.error} onRetry={() => window.location.reload()} />
  if (!item || !form) {
    return (
      <Empty icon="file" title="Item not found" action={<Link className="btn btn-secondary btn-sm" href="/backlog/">Back to backlog</Link>}>
        It may have been deleted, or it belongs to another organization.
      </Empty>
    )
  }

  const sprintOptions = sprints.data.filter((s) => s.status !== 'completed' || s.id === item.sprintId)
  const currentSprint = sprints.data.find((s) => s.id === item.sprintId)
  const isEpic = form.type === 'epic'
  const readOnly = !canWrite

  return (
    <>
      <div className="item-head">
        <Link className="text-link small" href="/backlog/"><Icon name="arrowLeft" size={14} /> Backlog</Link>
        <span className="subtle">/</span>
        <TypeIcon type={item.type} />
        <span className="item-key">{item.key}</span>
        <StatusBadge status={item.status} />
        {(item.carryoverCount ?? 0) > 0 ? <span className="badge badge--warning" title="Unfinished at the end of a sprint">Carried over {item.carryoverCount}×</span> : null}
        {currentSprint ? <Link className="badge badge--accent" href={`/sprint/?id=${currentSprint.id}`}>{currentSprint.name}</Link> : null}
      </div>
      <PageHeader
        title={item.title}
        description={`Created by ${memberName(item.createdBy)} · updated ${relativeTime(item.updatedAt)} by ${memberName(item.updatedBy)}`}
        actions={
          canDelete ? (
            <button type="button" className="btn btn-danger-ghost btn-sm" onClick={() => setConfirmDelete(true)}>
              <Icon name="trash" /> Delete
            </button>
          ) : null
        }
      />
      {readOnly ? <PermissionNotice>You have view-only access to this item.</PermissionNotice> : null}

      <div className="detail section-gap">
        <div className="stack">
          {changedElsewhere || conflict ? (
            <Alert type="error">
              {conflict ? 'Not saved: someone else changed this item after you opened it.' : 'Someone else saved a newer version while you were editing.'}{' '}
              <button type="button" className="text-link" onClick={reloadLatest}>Load the latest version</button> (your unsaved edits will be discarded), or copy your text first.
            </Alert>
          ) : null}
          {error ? <Alert type="error">{error}</Alert> : null}

          <form id="item-edit" className="stack" onSubmit={save}>
            <fieldset disabled={readOnly || saving} className="stack" style={{ border: 0 }}>
              <Field label="Title">
                {(p) => <input {...p} className="input" maxLength={200} required value={form.title} onChange={(e) => set('title', e.target.value)} />}
              </Field>
              <Field label="Description" optional>
                {(p) => <textarea {...p} className="input" rows={8} maxLength={20000} value={form.description} onChange={(e) => set('description', e.target.value)} />}
              </Field>
              <Field label="Labels" optional hint="Comma separated, up to 20.">
                {(p) => <input {...p} className="input" value={form.labels} onChange={(e) => set('labels', e.target.value)} />}
              </Field>
            </fieldset>
            {!readOnly ? (
              <div className="row">
                <button className="btn btn-accent" disabled={saving || !edited}>{saving ? 'Saving...' : 'Save changes'}</button>
                {edited ? <button type="button" className="btn btn-ghost" onClick={reloadLatest}>Discard</button> : <span className="xsmall subtle">No unsaved changes</span>}
              </div>
            ) : null}
          </form>

          {item.type === 'epic' && orgId ? <EpicChildren orgId={orgId} epic={item} /> : null}
          {orgId ? <Comments orgId={orgId} item={item} canWrite={canWrite} canModerate={canModerate} /> : null}
        </div>

        <aside className="detail-side">
          <Panel title="Details">
            <fieldset disabled={readOnly || saving} className="stack" style={{ border: 0 }}>
              <Field label="Type">
                {(p) => (
                  <select {...p} form="item-edit" className="input" value={form.type} onChange={(e) => set('type', e.target.value as ItemType)}>
                    {ITEM_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Status">
                {(p) => (
                  <select {...p} form="item-edit" className="input" value={form.status} onChange={(e) => set('status', e.target.value as ItemStatus)}>
                    {STATUSES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                )}
              </Field>
              <Field label="Priority">
                {(p) => (
                  <select {...p} form="item-edit" className="input" value={form.priority} onChange={(e) => set('priority', e.target.value as Priority)}>
                    {PRIORITIES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                )}
              </Field>
              {!isEpic ? (
                <Field label="Story points" optional>
                  {(p) => <input {...p} form="item-edit" className="input" type="number" min={0} max={100} step={0.5} value={form.storyPoints} onChange={(e) => set('storyPoints', e.target.value)} />}
                </Field>
              ) : null}
              <Field label="Assignee" optional>
                {(p) => <MemberSelect {...p} value={form.assigneeId} onChange={(v) => set('assigneeId', v)} />}
              </Field>
              {!isEpic ? (
                <>
                  <Field label="Epic" optional>
                    {(p) => (
                      <select {...p} form="item-edit" className="input" value={form.epicId ?? ''} onChange={(e) => set('epicId', e.target.value || null)}>
                        <option value="">None</option>
                        {epics.data.filter((ep) => ep.id !== item.id).map((ep) => <option key={ep.id} value={ep.id}>{ep.key} {ep.title}</option>)}
                      </select>
                    )}
                  </Field>
                  <Field label="Sprint" optional hint={currentSprint?.status === 'active' ? 'Changes to an active sprint are recorded as scope changes.' : undefined}>
                    {(p) => (
                      <select {...p} form="item-edit" className="input" value={form.sprintId ?? ''} onChange={(e) => set('sprintId', e.target.value || null)}>
                        <option value="">Backlog</option>
                        {sprintOptions.map((s) => (
                          <option key={s.id} value={s.id} disabled={s.status === 'completed'}>
                            {s.name} ({s.status})
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                </>
              ) : (
                <>
                  <Field label="Start date" optional>
                    {(p) => <input {...p} form="item-edit" className="input" type="date" value={form.startDate} onChange={(e) => set('startDate', e.target.value)} />}
                  </Field>
                  <Field label="Target date" optional>
                    {(p) => <input {...p} form="item-edit" className="input" type="date" value={form.targetDate} onChange={(e) => set('targetDate', e.target.value)} />}
                  </Field>
                </>
              )}
              <Field label="Due date" optional>
                {(p) => <input {...p} form="item-edit" className="input" type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />}
              </Field>
            </fieldset>
            {item.labels?.length ? (
              <div className="row" style={{ marginTop: 12 }}>
                {item.labels.map((l) => <span key={l} className="label-chip">{l}</span>)}
              </div>
            ) : null}
            <p className="xsmall subtle" style={{ marginTop: 12 }}>Version {item.version}. Saves are rejected if someone else saved first.</p>
          </Panel>
          {orgId ? <Attachments orgId={orgId} item={item} canWrite={canWrite} canModerate={canModerate} /> : null}
        </aside>
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${item.key}?`}
        dismissible={!deleting}
        footer={
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>Cancel</button>
            <button type="button" className="btn btn-danger" onClick={remove} disabled={deleting}>{deleting ? 'Deleting...' : 'Delete item'}</button>
          </>
        }
      >
        <p>This permanently deletes &ldquo;{item.title}&rdquo;. It cannot be undone. The deletion is recorded in the audit log.</p>
        {item.sprintId && currentSprint?.status === 'active' ? <p className="muted small" style={{ marginTop: 8 }}>It is in the active sprint, so its points are recorded as removed scope.</p> : null}
      </Dialog>
    </>
  )
}

function ItemPageInner() {
  const id = useSearchParams().get('id')
  if (!id) return <Empty icon="file" title="No item selected" action={<Link className="btn btn-secondary btn-sm" href="/backlog/">Open the backlog</Link>} />
  return <ItemView key={id} id={id} />
}

export default function ItemPage() {
  return (
    <Suspense fallback={<Loading />}>
      <ItemPageInner />
    </Suspense>
  )
}
