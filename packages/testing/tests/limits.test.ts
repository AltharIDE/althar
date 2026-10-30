import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { type Node, parseSync } from 'oxc-parser'
import { expect, test } from 'vite-plus/test'

/*
 * No test sets a time of its own: each takes its size's budget, scaled for the machine (src/budget.ts), and its waits
 * go by that (src/deadline.ts). A time picked where a test once ran out is right for the machine it ran out on; this
 * finds any that comes back.
 */

const root = join(import.meta.dirname, '../../..')

/*
 * Tests that keep their own times by design: those that drive real agents and real accounts, run by hand with configs
 * of their own; a benchmark that runs only when BENCH_MERGED is set; and this package's own, which test the budget.
 */
const apart = (file: string) =>
  file.includes('/tests/agents/') ||
  file.includes('/tests/real/') ||
  file.endsWith('/openBenchMerged.test.ts') ||
  file.startsWith('packages/testing/')

const files = globSync(['packages/*/tests/**/*.{ts,tsx}', 'apps/*/tests/**/*.{ts,tsx}', 'brand/tests/**/*.{ts,tsx}'], { cwd: root })
  .map((file) => file.replaceAll('\\', '/'))
  .filter((file) => !apart(file))

type Any = Node & Record<string, unknown>

/** The name a call starts from: `it` for `it.live.skipIf(…)(…)`. */
const rootOf = (node: Any | undefined): string | undefined => {
  for (let at = node; at !== undefined;) {
    if (at.type === 'Identifier') return at.name as string
    at = (at.type === 'MemberExpression' ? at.object : at.type === 'CallExpression' ? at.callee : undefined) as Any | undefined
  }
  return undefined
}

const TESTS = new Set(['it', 'test', 'describe'])
const HOOKS = new Set(['beforeAll', 'beforeEach', 'afterAll', 'afterEach'])
const WAITS = new Set(['until', 'waitFor'])

/** Where in the file a time of its own is set, as `file:line what`. */
const limitsIn = (file: string) => {
  const source = readFileSync(join(root, file), 'utf8')
  const found: Array<string> = []
  const at = (node: Any, what: string) => found.push(`${file}:${source.slice(0, node.start).split('\n').length} ${what}`)
  const text = (node: Any) => source.slice(node.start, node.end)
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(visit)
    const one = node as Any
    if (one.type === 'CallExpression') {
      const callee = one.callee as Any
      const args = one.arguments as Array<Any>
      const name = rootOf(callee)
      // A test's time is its third argument, or a `timeout` in options given second; a size by name is the one way.
      if (name !== undefined && TESTS.has(name)) {
        if (args[2] !== undefined && !text(args[2]).startsWith('budget.')) at(one, `a time of its own: ${text(args[2])}`)
        if (args[1]?.type === 'ObjectExpression' && /\btimeout\b/.test(text(args[1]))) at(one, `a time of its own: ${text(args[1])}`)
      }
      if (callee.type === 'Identifier' && HOOKS.has(callee.name as string) && args[1] !== undefined)
        at(one, `a hook's time of its own: ${text(args[1])}`)
      if (callee.type === 'Identifier' && WAITS.has(callee.name as string) && args.length > 2)
        at(one, `a wait's time of its own: ${text(args[2]!)}`)
    }
    // A loop that tries so many times, sleeping between, is a wait with a time of its own.
    if (
      one.type === 'ForStatement' &&
      one.test !== null &&
      /<\s*[0-9_]+/.test(text(one.test as Any)) &&
      /setTimeout|Effect\.sleep/.test(text(one.body as Any))
    )
      at(one, 'a wait that gives up after so many tries: use until or waitFor')
    for (const [key, value] of Object.entries(one)) if (key !== 'type') visit(value)
  }
  const { program, errors } = parseSync(file, source)
  if (errors.length > 0) return [`${file}: doesn't parse: ${errors[0]!.message}`]
  visit(program)
  return found
}

test('finds the test files', () => {
  expect(files.length).toBeGreaterThan(300)
})

test('no test, hook or wait sets a time of its own', () => {
  expect(files.flatMap(limitsIn)).toEqual([])
})
