import { describe, expect, it } from 'vitest'
import { projectMemberIds } from '@domain/access'

describe('project access', () => {
  it('joins hand-picked people and the team without duplicates', () => {
    expect(projectMemberIds(['b', 'a'], ['a', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('treats a missing list or team as empty', () => {
    expect(projectMemberIds(undefined, ['x'])).toEqual(['x'])
    expect(projectMemberIds(['x'], null)).toEqual(['x'])
    expect(projectMemberIds(null, undefined)).toEqual([])
  })
})
