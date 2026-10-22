import { describe, expect, it } from 'vitest'
import { atLeast, can, canAssignRole, canRemoveMember, ROLES } from '@domain/roles'

describe('role ranks', () => {
  it('orders viewer < member < manager < admin < owner', () => {
    expect(ROLES).toEqual(['viewer', 'member', 'manager', 'admin', 'owner'])
    expect(atLeast('manager', 'member')).toBe(true)
    expect(atLeast('member', 'manager')).toBe(false)
    expect(atLeast(null, 'viewer')).toBe(false)
  })

  it('maps permissions to minimum roles', () => {
    expect(can('viewer', 'read')).toBe(true)
    expect(can('viewer', 'items.write')).toBe(false)
    expect(can('member', 'items.write')).toBe(true)
    expect(can('member', 'sprints.manage')).toBe(false)
    expect(can('manager', 'sprints.manage')).toBe(true)
    expect(can('manager', 'members.invite')).toBe(false)
    expect(can('admin', 'audit.read')).toBe(true)
  })
})

describe('canAssignRole', () => {
  it('lets owners grant any role, including owner', () => {
    for (const next of ROLES) expect(canAssignRole('owner', 'member', next).ok).toBe(true)
    expect(canAssignRole('owner', 'owner', 'admin').ok).toBe(true)
  })

  it('caps admins below their own level', () => {
    expect(canAssignRole('admin', 'member', 'manager').ok).toBe(true)
    expect(canAssignRole('admin', null, 'viewer').ok).toBe(true)
    expect(canAssignRole('admin', 'member', 'admin').ok).toBe(false)
    expect(canAssignRole('admin', 'member', 'owner').ok).toBe(false)
    expect(canAssignRole('admin', 'admin', 'member').ok).toBe(false)
    expect(canAssignRole('admin', 'owner', 'member').ok).toBe(false)
  })

  it('refuses everyone below admin', () => {
    for (const actor of ['viewer', 'member', 'manager'] as const) {
      expect(canAssignRole(actor, 'viewer', 'member').ok).toBe(false)
    }
  })

  it('applies the same ladder to removals', () => {
    expect(canRemoveMember('admin', 'manager').ok).toBe(true)
    expect(canRemoveMember('admin', 'admin').ok).toBe(false)
    expect(canRemoveMember('owner', 'owner').ok).toBe(true)
    expect(canRemoveMember('manager', 'viewer').ok).toBe(false)
  })
})
