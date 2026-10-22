'use client'

import { useOrg } from '@/components/providers/OrgProvider'

/** Native select of org members; native keeps keyboard and screen-reader support for free. */
export default function MemberSelect({
  value,
  onChange,
  id,
  allowEmpty = true,
  emptyLabel = 'Unassigned',
  className = 'input',
  ...aria
}: {
  value: string | null
  onChange: (uid: string | null) => void
  id?: string
  allowEmpty?: boolean
  emptyLabel?: string
  className?: string
  'aria-label'?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}) {
  const { members } = useOrg()
  return (
    <select id={id} className={className} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} {...aria}>
      {allowEmpty ? <option value="">{emptyLabel}</option> : null}
      {members.map((m) => (
        <option key={m.uid} value={m.uid}>
          {m.displayName}
        </option>
      ))}
    </select>
  )
}
