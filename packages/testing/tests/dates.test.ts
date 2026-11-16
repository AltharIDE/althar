import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { type Node, parseSync } from 'oxc-parser'
import { expect, test } from 'vite-plus/test'

import { isoAfter } from '../src/time'

type Any = Node & Record<string, unknown>
const root = join(import.meta.dirname, '../../..')

/** Inspect strings and SQL/template parts, leaving comments and regular expressions alone. */
const futureDatesIn = (file: string, source: string, now: number) => {
  const found: Array<string> = []
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(visit)
    const one = node as Any
    if ((one.type === 'Literal' && typeof one.value === 'string') || one.type === 'TemplateElement') {
      const text = source.slice(one.start, one.end)
      // A calendar date in prose is copy (and may mirror the app's wording), not a clock read. Standalone date
      // values and timestamps, including ones embedded in SQL or JSON, are fixtures that could expire.
      const dates =
        one.type === 'Literal' && typeof one.value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(one.value)
          ? /\b\d{4}-\d{2}-\d{2}/g
          : /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?/g
      for (const match of text.matchAll(dates)) {
        if (Date.parse(match[0]) > now)
          found.push(
            `${file}:${source.slice(0, one.start + match.index).split('\n').length} ${match[0]}: use isoAfter from @althar/testing for a live future time, or historical dates with an explicit test clock`,
          )
      }
    }
    for (const [key, value] of Object.entries(one)) if (key !== 'type') visit(value)
  }
  const { program, errors } = parseSync(file, source)
  if (errors.length > 0) return [`${file}: does not parse: ${errors[0]!.message}`]
  visit(program)
  return found
}

test('finds future dates in strings, embedded JSON and SQL, but not comments', () => {
  const now = Date.now()
  const future = isoAfter(86_400_000, now)
  const source = `const date = '${future}'; const json = '{"at":"${future}"}'; sql\`SELECT '${future}'\`; // ${future}`
  expect(futureDatesIn('sample.ts', source, now)).toHaveLength(3)
  expect(futureDatesIn('sample.ts', `const at = '${isoAfter(-86_400_000, now)}'`, now)).toEqual([])
})

test('no test or fixture depends on a hard-coded future date', () => {
  const files = globSync(
    ['packages/*/tests/**/*.{ts,tsx}', 'apps/*/tests/**/*.{ts,tsx}', 'apps/*/e2e/**/*.ts', 'brand/tests/**/*.{ts,tsx}'],
    { cwd: root },
  )
  expect(files.length).toBeGreaterThan(300)
  const now = Date.now()
  expect(files.flatMap((file) => futureDatesIn(file, readFileSync(join(root, file), 'utf8'), now))).toEqual([])
})

test('builds ISO times relative to the supplied clock, across a calendar boundary', () => {
  const now = Date.parse('2025-12-31T23:59:59.000Z')
  expect(isoAfter(2000, now)).toBe('2026-01-01T00:00:01.000Z')
  expect(isoAfter(-1000, now)).toBe('2025-12-31T23:59:58.000Z')
})
