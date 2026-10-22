import type { Role } from './types'

export const ROLES: Role[] = ['viewer', 'member', 'manager', 'admin', 'owner']

export const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  member: 2,
  manager: 3,
  admin: 4,
  owner: 5,
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  member: 'Member',
  viewer: 'Viewer',
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && value in ROLE_RANK
}

export function atLeast(role: Role | null | undefined, min: Role): boolean {
  return Boolean(role) && ROLE_RANK[role as Role] >= ROLE_RANK[min]
}

/**
 * Minimum role for each action. firestore.rules encodes the same thresholds,
 * and the emulator tests check the two stay in step.
 */
export const PERMISSIONS = {
  read: 'viewer',
  'items.write': 'member',
  'comments.write': 'member',
  'ceremonies.write': 'member',
  'items.deleteAny': 'manager',
  'projects.manage': 'manager',
  'teams.manage': 'manager',
  'sprints.manage': 'manager',
  'org.update': 'admin',
  'members.invite': 'admin',
  'members.manage': 'admin',
  'audit.read': 'admin',
} as const satisfies Record<string, Role>

export type Permission = keyof typeof PERMISSIONS

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return atLeast(role, PERMISSIONS[permission])
}

export type RoleCheck = { ok: true } | { ok: false; reason: string }

/**
 * Whether `actor` may give someone the role `next`. `current` is the target's
 * existing role, or null for a new invite.
 *
 * - Only admins and owners manage roles.
 * - Admins may grant up to manager and only act on people ranked below them.
 * - Owners may grant any role, including owner, and act on anyone.
 * Self-changes and the last-owner guard are checked by the caller, which
 * knows who the actor is and how many owners remain.
 */
export function canAssignRole(actor: Role, current: Role | null, next: Role): RoleCheck {
  if (!atLeast(actor, 'admin')) return { ok: false, reason: 'Only admins and owners can manage roles.' }
  if (actor === 'owner') return { ok: true }
  if (ROLE_RANK[next] >= ROLE_RANK[actor]) {
    return { ok: false, reason: 'Admins can only grant roles below admin.' }
  }
  if (current && ROLE_RANK[current] >= ROLE_RANK[actor]) {
    return { ok: false, reason: 'You cannot change the role of someone at or above your level.' }
  }
  return { ok: true }
}

/** Whether `actor` may remove a member who holds `target`. */
export function canRemoveMember(actor: Role, target: Role): RoleCheck {
  if (!atLeast(actor, 'admin')) return { ok: false, reason: 'Only admins and owners can remove members.' }
  if (actor === 'owner') return { ok: true }
  if (ROLE_RANK[target] >= ROLE_RANK[actor]) {
    return { ok: false, reason: 'You cannot remove someone at or above your level.' }
  }
  return { ok: true }
}
