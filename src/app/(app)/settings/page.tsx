'use client'

import { useState, type FormEvent } from 'react'
import PageHeader from '@/components/ui/PageHeader'
import Field from '@/components/ui/Field'
import Alert from '@/components/ui/Alert'
import { Panel } from '@/components/ui/Bits'
import { PermissionNotice } from '@/components/ui/States'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { updateOrg } from '@/lib/data/org'
import { friendlyError } from '@/lib/errors'
import { formatDate } from '@/lib/format'

const ZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? ['UTC']
  } catch {
    return ['UTC']
  }
})()

export default function SettingsPage() {
  const { user } = useAuth()
  const { org, orgId, can, members, projects } = useOrg()
  const toast = useToaster()
  const admin = can('org.update')
  const [name, setName] = useState(org?.name ?? '')
  const [description, setDescription] = useState(org?.description ?? '')
  const [timeZone, setTimeZone] = useState(org?.timeZone ?? 'UTC')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setPending(true)
    setError(null)
    try {
      await updateOrg(orgId!, { name: name.trim(), description, timeZone }, user!.uid)
      toast.success('Organization settings saved')
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <>
      <PageHeader title="Settings" description="Organization details shared by every project." />
      <div className="grid-2">
        <Panel title="Organization">
          {!admin ? <PermissionNotice>Only admins and owners change organization settings.</PermissionNotice> : null}
          <form className="stack" onSubmit={submit} style={{ marginTop: admin ? 0 : 12 }}>
            {error ? <Alert type="error">{error}</Alert> : null}
            <fieldset disabled={!admin || pending} className="stack">
              <Field label="Name">{(p) => <input {...p} className="input" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
              <Field label="Description" optional>{(p) => <textarea {...p} className="input" rows={3} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
              <Field label="Time zone" hint="Sprint reports put each change on the calendar day of this zone.">
                {(p) => (
                  <select {...p} className="input" value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
                    {ZONES.map((z) => <option key={z} value={z}>{z}</option>)}
                  </select>
                )}
              </Field>
              {admin ? <div><button className="btn btn-accent" disabled={pending || name.trim().length < 2}>{pending ? 'Saving...' : 'Save changes'}</button></div> : null}
            </fieldset>
          </form>
        </Panel>
        <Panel title="Overview">
          <dl className="detail-list">
            <div className="value-row"><dt>Organization ID</dt><dd className="mono">{orgId}</dd></div>
            <div className="value-row"><dt>Created</dt><dd>{formatDate(org?.createdAt)}</dd></div>
            <div className="value-row"><dt>Members</dt><dd>{members.length}</dd></div>
            <div className="value-row"><dt>Projects</dt><dd>{projects.filter((p) => !p.archived).length} active, {projects.filter((p) => p.archived).length} archived</dd></div>
          </dl>
          <p className="muted small" style={{ marginTop: 12 }}>
            Data for this organization is stored under its own path and is readable only by its members. To leave, use the Members page.
          </p>
        </Panel>
      </div>
    </>
  )
}
