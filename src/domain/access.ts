/**
 * Who may see a project: the people picked on the project plus the members
 * of its team. Stored on the project as memberIds so firestore.rules and the
 * member's project query need no extra reads.
 */
export function projectMemberIds(direct: readonly string[] | null | undefined, team: readonly string[] | null | undefined): string[] {
  return [...new Set([...(direct ?? []), ...(team ?? [])])].sort()
}
