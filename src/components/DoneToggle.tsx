'use client'

import { useState } from 'react'
import Icon from '@/components/ui/Icon'
import { useAuth } from '@/components/providers/AuthProvider'
import { useOrg } from '@/components/providers/OrgProvider'
import { useToaster } from '@/components/providers/ToastProvider'
import { patchItem } from '@/lib/data/items'
import type { Item } from '@/lib/types'

/** One-click done / reopen from a list, without opening the item. Reopening sends it back to To do. */
export default function DoneToggle({ item, disabled }: { item: Item; disabled?: boolean }) {
  const { user } = useAuth()
  const { orgId } = useOrg()
  const toast = useToaster()
  const [pending, setPending] = useState(false)
  if (item.type === 'epic') return <span />
  const done = item.status === 'done'

  const toggle = async () => {
    if (!orgId || !user) return
    setPending(true)
    try {
      await patchItem(orgId, item.id, { status: done ? 'todo' : 'done' }, user.uid)
      toast.success(done ? `${item.key} reopened` : `${item.key} done`)
    } catch (err) {
      toast.error(err)
    } finally {
      setPending(false)
    }
  }

  return (
    <button
      type="button"
      className="icon-btn icon-btn--sm done-toggle"
      aria-pressed={done}
      aria-label={done ? `Reopen ${item.key}` : `Mark ${item.key} done`}
      title={done ? 'Reopen' : 'Mark done'}
      disabled={disabled || pending}
      onClick={toggle}
    >
      <Icon name="check" size={16} />
    </button>
  )
}
