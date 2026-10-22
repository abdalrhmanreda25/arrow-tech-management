'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { addDays } from '@domain/dates'
import { validateSprintDates } from '@domain/sprint'
import Dialog from '@/components/ui/Dialog'
import Field from '@/components/ui/Field'
import Alert from '@/components/ui/Alert'
import { friendlyError } from '@/lib/errors'
import type { Sprint } from '@/lib/types'

export interface SprintFormValues {
  name: string
  goal: string
  startDate: string
  endDate: string
}

interface Props {
  open: boolean
  onClose: () => void
  title: string
  submitLabel: string
  initial: SprintFormValues
  /** Started sprints keep their dates; the burndown is measured against them. */
  datesLocked?: boolean
  onSubmit: (values: SprintFormValues) => Promise<void>
}

const LENGTHS = [1, 2, 3, 4]

/** Create or edit a sprint. Length in weeks or an explicit end date. */
export default function SprintFormDialog({ open, onClose, title, submitLabel, initial, datesLocked, onSubmit }: Props) {
  const [values, setValues] = useState(initial)
  const [weeks, setWeeks] = useState<number | 'custom'>(2)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setValues(initial)
    setError(null)
    const match = LENGTHS.find((w) => addDays(initial.startDate, w * 7 - 1) === initial.endDate)
    setWeeks(match ?? 'custom')
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = (patch: Partial<SprintFormValues>) => setValues((v) => ({ ...v, ...patch }))

  const changeStart = (startDate: string) => set(weeks === 'custom' ? { startDate } : { startDate, endDate: startDate ? addDays(startDate, weeks * 7 - 1) : '' })

  const changeWeeks = (value: string) => {
    if (value === 'custom') return setWeeks('custom')
    const w = Number(value)
    setWeeks(w)
    if (values.startDate) set({ endDate: addDays(values.startDate, w * 7 - 1) })
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      validateSprintDates(values.startDate, values.endDate)
    } catch (err) {
      return setError((err as Error).message)
    }
    setPending(true)
    try {
      await onSubmit({ ...values, name: values.name.trim(), goal: values.goal.trim() })
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
      title={title}
      dismissible={!pending}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" form="sprint-form" className="btn btn-accent" disabled={pending || !values.name.trim()}>
            {pending ? 'Saving...' : submitLabel}
          </button>
        </>
      }
    >
      <form id="sprint-form" className="stack" onSubmit={submit}>
        {error ? <Alert type="error">{error}</Alert> : null}
        <Field label="Name">
          {(p) => <input {...p} className="input" required maxLength={80} value={values.name} onChange={(e) => set({ name: e.target.value })} />}
        </Field>
        <Field label="Sprint goal" optional hint="One sentence the team commits to.">
          {(p) => <textarea {...p} className="input" rows={2} maxLength={1000} value={values.goal} onChange={(e) => set({ goal: e.target.value })} />}
        </Field>
        <div className="form-grid form-grid--3">
          <Field label="Start date">
            {(p) => <input {...p} className="input" type="date" required disabled={datesLocked} value={values.startDate} onChange={(e) => changeStart(e.target.value)} />}
          </Field>
          <Field label="Length">
            {(p) => (
              <select {...p} className="input" disabled={datesLocked} value={String(weeks)} onChange={(e) => changeWeeks(e.target.value)}>
                {LENGTHS.map((w) => <option key={w} value={w}>{w} week{w === 1 ? '' : 's'}</option>)}
                <option value="custom">Custom end date</option>
              </select>
            )}
          </Field>
          <Field label="End date">
            {(p) => (
              <input
                {...p}
                className="input"
                type="date"
                required
                disabled={datesLocked || weeks !== 'custom'}
                min={values.startDate || undefined}
                value={values.endDate}
                onChange={(e) => set({ endDate: e.target.value })}
              />
            )}
          </Field>
        </div>
        {datesLocked ? <p className="muted small">Dates are fixed once a sprint has started.</p> : null}
      </form>
    </Dialog>
  )
}

export const sprintFormValues = (s: Sprint): SprintFormValues => ({ name: s.name, goal: s.goal ?? '', startDate: s.startDate, endDate: s.endDate })
