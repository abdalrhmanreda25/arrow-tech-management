import { rankBetween } from '@domain/rank'

type Ranked = { id: string }

/** Stable sort by a numeric rank field; missing ranks go last. */
export function sortByRank<T extends Ranked>(list: T[], rank: (item: T) => number | undefined | null): T[] {
  return [...list].sort((a, b) => (rank(a) ?? Number.MAX_SAFE_INTEGER) - (rank(b) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id))
}

/**
 * Rank for `movingId` dropped just before `beforeId` (or at the end when
 * beforeId is null) in an ordered list. The moving item is ignored when
 * finding neighbours, so dropping a card back onto itself is a no-op rank.
 */
export function rankForDrop<T extends Ranked>(ordered: T[], movingId: string, beforeId: string | null, rank: (item: T) => number | undefined | null): number {
  const rest = ordered.filter((i) => i.id !== movingId)
  const index = beforeId ? rest.findIndex((i) => i.id === beforeId) : rest.length
  const at = index < 0 ? rest.length : index
  const prev = at > 0 ? rank(rest[at - 1]) : null
  const next = at < rest.length ? rank(rest[at]) : null
  return rankBetween(prev, next)
}

/** Labels typed as "api, ui, urgent": trimmed, unique, at most 20 of 40 chars each. */
export function parseLabels(text: string): string[] {
  const seen = new Set<string>()
  for (const raw of text.split(',')) {
    const label = raw.trim().slice(0, 40)
    if (label) seen.add(label)
  }
  return [...seen].slice(0, 20)
}
