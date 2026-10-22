import { describe, expect, it } from 'vitest'
import { csvCell, toCsv } from '@domain/csv'
import { rankBetween, RANK_STEP } from '@domain/rank'
import { addDays, dayKey, daysBetween, eachDay, isDayKey } from '@domain/dates'

describe('csv', () => {
  it('quotes separators, quotes and newlines', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"')
    expect(csvCell(null)).toBe('')
    expect(csvCell(0)).toBe('0')
  })

  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvCell('+1')).toBe("'+1")
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)")
  })

  it('builds a document with a header row', () => {
    const csv = toCsv([{ label: 'Key', value: (r: { k: string; p: number }) => r.k }, { label: 'Points', value: (r) => r.p }], [{ k: 'ARW-1', p: 3 }])
    expect(csv).toBe('Key,Points\r\nARW-1,3\r\n')
  })
})

describe('rank', () => {
  it('finds midpoints and appends', () => {
    expect(rankBetween(null, null)).toBe(RANK_STEP)
    expect(rankBetween(1024, null)).toBe(2048)
    expect(rankBetween(null, 1024)).toBe(0)
    expect(rankBetween(1024, 2048)).toBe(1536)
  })
})

describe('dates', () => {
  it('handles day keys', () => {
    expect(isDayKey('2026-02-29')).toBe(false)
    expect(isDayKey('2028-02-29')).toBe(true)
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(daysBetween('2026-03-01', '2026-03-15')).toBe(14)
    expect(eachDay('2026-03-30', '2026-04-02')).toEqual(['2026-03-30', '2026-03-31', '2026-04-01', '2026-04-02'])
    expect(eachDay('2026-04-02', '2026-04-01')).toEqual([])
    expect(dayKey(Date.parse('2026-06-01T22:30:00Z'), 'Africa/Cairo')).toBe('2026-06-02')
  })
})
