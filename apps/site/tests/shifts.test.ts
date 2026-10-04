import { describe, expect, it } from 'vite-plus/test'

import { SHIFTS, ShiftKind, type Shift } from '../src/content/shifts'
import { byMonth, countByKind, daysCovered, latest, newestFirst, onlyKind } from '../src/shifts/group'

const shift = (id: string, date: string, kind = ShiftKind.Model): Shift => ({
  id,
  date,
  kind,
  who: 'Lab',
  title: `Title ${id}`,
  what: `What ${id}.`,
  source: { name: 'Source', url: `https://example.com/${id}` },
})

describe('the shifts we list', () => {
  it('has unique ids', () => {
    const ids = SHIFTS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('dates every shift as a real calendar day', () => {
    for (const s of SHIFTS) {
      expect(s.date, s.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(new Date(`${s.date}T00:00:00Z`).toISOString().slice(0, 10), s.id).toBe(s.date)
    }
  })

  it('links every shift to a source over https', () => {
    for (const s of SHIFTS) {
      expect(new URL(s.source.url).protocol, s.id).toBe('https:')
      expect(s.source.name.length, s.id).toBeGreaterThan(0)
    }
  })

  it('says what happened in one short sentence or two', () => {
    for (const s of SHIFTS) {
      expect(s.title.length, s.id).toBeLessThanOrEqual(64)
      expect(s.what.length, s.id).toBeLessThanOrEqual(200)
      expect(s.what.endsWith('.'), s.id).toBe(true)
    }
  })

  it('uses only the kinds the page can show', () => {
    const kinds = new Set(Object.values(ShiftKind))
    for (const s of SHIFTS) expect(kinds.has(s.kind), s.id).toBe(true)
  })
})

describe('ordering and grouping', () => {
  const list = [shift('a', '2026-08-03'), shift('b', '2026-09-30'), shift('c', '2026-09-22'), shift('d', '2026-09-22')]

  it('puts the newest first, and same-day shifts in a stable order', () => {
    expect(newestFirst(list).map((s) => s.id)).toEqual(['b', 'c', 'd', 'a'])
  })

  it('does not reorder the list it was given', () => {
    newestFirst(list)
    expect(list.map((s) => s.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('takes the latest few', () => {
    expect(latest(list, 2).map((s) => s.id)).toEqual(['b', 'c'])
    expect(latest(list, 10)).toHaveLength(4)
  })

  it('groups by month, newest month first', () => {
    const months = byMonth(list)
    expect(months.map((m) => [m.key, m.label, m.items.length])).toEqual([
      ['2026-09', 'September 2026', 3],
      ['2026-08', 'August 2026', 1],
    ])
    expect(months[0]?.items.map((s) => s.id)).toEqual(['b', 'c', 'd'])
  })

  it('counts the days the list covers, both ends included', () => {
    expect(daysCovered(list)).toBe(59)
    expect(daysCovered([shift('x', '2026-09-01')])).toBe(1)
    expect(daysCovered([])).toBe(0)
  })

  it('counts each kind, with zero for kinds that have none', () => {
    const counts = countByKind([
      shift('a', '2026-09-01', ShiftKind.Limits),
      shift('b', '2026-09-02', ShiftKind.Limits),
      shift('c', '2026-09-03'),
    ])
    expect(counts[ShiftKind.Limits]).toBe(2)
    expect(counts[ShiftKind.Model]).toBe(1)
    expect(counts[ShiftKind.Outage]).toBe(0)
  })

  it('filters to one kind, or keeps everything', () => {
    const mixed = [shift('a', '2026-09-01', ShiftKind.Limits), shift('b', '2026-09-02')]
    expect(onlyKind(mixed, ShiftKind.Limits).map((s) => s.id)).toEqual(['a'])
    expect(onlyKind(mixed, null)).toHaveLength(2)
  })
})
