import { globSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { type Node, parseSync } from 'oxc-parser'
import { expect, test } from 'vite-plus/test'

/*
 * No end-to-end spec sets a time of its own either, nor sleeps: Playwright's test and expect times come from the budget
 * (src/budget.ts, in the desktop app's playwright.config.ts), and so do the app's actions (its e2e/support.ts), and a
 * spec waits for what it looks for, with Playwright's own waiting, never for a while. A time picked where a spec once ran out is right for the machine it ran out on; a
 * sleep is too short on a slow one and wasted on a fast one. This finds any that comes back.
 */

const root = join(import.meta.dirname, '../../..')

/*
 * The specs that drive real agents keep their own times: they run only by hand, with the person's own sign-in, and a
 * real agent's turn takes as long as it and its service do, which no budget for the machine bounds. The real speech
 * model runs on the machine, so its spec takes the budget as every other does.
 */
const apart = (file: string) => file.endsWith('/e2e/real.spec.ts') || file.endsWith('/e2e/real-tools.spec.ts')

const specs = globSync('apps/desktop/e2e/**/*.ts', { cwd: root })
  .map((file) => file.replaceAll('\\', '/'))
  .filter((file) => !apart(file))

const CONFIG = 'apps/desktop/playwright.config.ts'

type Any = Node & Record<string, unknown>

/** The name a call starts from: `test` for `test.setTimeout(…)`, `page` for `page.getByText(…).waitFor(…)`. */
const rootOf = (node: Any | undefined): string | undefined => {
  for (let at = node; at !== undefined;) {
    if (at.type === 'Identifier') return at.name as string
    at = (at.type === 'MemberExpression' ? at.object : at.type === 'CallExpression' ? at.callee : undefined) as Any | undefined
  }
  return undefined
}

/** A property's name, written as a name or as a string. */
const keyOf = (node: Any): string | undefined => {
  const key = node.key as Any | undefined
  return key?.type === 'Identifier' ? (key.name as string) : key?.type === 'Literal' ? String(key.value) : undefined
}

/** Whether a time is a size's budget, by name: `budget.medium`. */
const budgeted = (node: Any | undefined) =>
  node?.type === 'MemberExpression' && (node.object as Any).type === 'Identifier' && (node.object as Any).name === 'budget'

/** Times a page or a test is given for every wait after. */
const DEFAULTS = new Set(['setDefaultTimeout', 'setDefaultNavigationTimeout'])

/** Visits every node of `file`, calling `look` with each and a way to note what it found there, as `file:line what`. */
const walk = (file: string, look: (node: Any, at: (what: string) => void, text: (node: Any) => string) => void) => {
  const source = readFileSync(join(root, file), 'utf8')
  const found: Array<string> = []
  const text = (node: Any) => source.slice(node.start, node.end)
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) return node.forEach(visit)
    const one = node as Any
    if (typeof one.type === 'string')
      look(one, (what) => found.push(`${file}:${source.slice(0, one.start).split('\n').length} ${what}`), text)
    for (const [key, value] of Object.entries(one)) if (key !== 'type') visit(value)
  }
  const { program, errors } = parseSync(file, source)
  if (errors.length > 0) return [`${file}: doesn't parse: ${errors[0]!.message}`]
  visit(program)
  return found
}

/** Where a spec sets a time of its own, or sleeps. */
const limitsIn = (file: string) =>
  walk(file, (one, at, text) => {
    // `{ timeout: … }` given to an assertion, an action, a wait or a launch, or `{ actionTimeout: … }` to `test.use`; a size by
    // name is the one way, as for the unit tests.
    if (one.type === 'Property' && /timeout$/i.test(keyOf(one) ?? '') && !budgeted(one.value as Any)) at(`a time of its own: ${text(one)}`)
    if (one.type !== 'CallExpression') {
      // A loop that tries so many times, sleeping between, is a wait with a time of its own.
      if (
        one.type === 'ForStatement' &&
        one.test !== null &&
        /<\s*[0-9_]+/.test(text(one.test as Any)) &&
        /setTimeout|waitForTimeout|sleep/.test(text(one.body as Any))
      )
        at('a wait that gives up after so many tries: wait for what it looks for')
      return
    }
    const callee = one.callee as Any
    const named = callee.type === 'MemberExpression' ? keyOf({ key: callee.property } as Any) : undefined
    if (named === 'waitForTimeout') at(`a sleep: ${text(one)}`)
    // `test.setTimeout(…)`, `test.info().setTimeout(…)` or a fixture's `testInfo.setTimeout(…)`; in a page, `window.setTimeout(…)`.
    else if (named === 'setTimeout' || named === 'setInterval')
      at(rootOf(callee) === 'window' ? `a sleep: ${text(one)}` : `a test's time of its own: ${text(one)}`)
    else if (named === 'slow' && rootOf(callee) === 'test') at(`a test's time of its own: ${text(one)}`)
    else if (named !== undefined && DEFAULTS.has(named) && !budgeted((one.arguments as Array<Any>)[0]))
      at(`a time of its own for every wait: ${text(one)}`)
    else if (callee.type === 'Identifier' && (callee.name === 'setTimeout' || callee.name === 'setInterval')) at(`a sleep: ${text(one)}`)
  })

/*
 * Nor presses a key only a Mac has. The end-to-end run is on Linux and Windows too, where Althar's shortcuts are Ctrl's
 * and the Super key is no modifier of ours: `Meta+n` there opens nothing, and the spec waits out its time for what it
 * opened. `ControlOrMeta+n` is each system's own; a spec that means one system names it.
 */
const macKeysIn = (file: string) =>
  walk(file, (one, at, text) => {
    if (one.type !== 'CallExpression') return
    const callee = one.callee as Any
    const first = (one.arguments as Array<Any>)[0]
    if (
      callee.type === 'MemberExpression' &&
      keyOf({ key: callee.property } as Any) === 'press' &&
      first?.type === 'Literal' &&
      String(first.value).startsWith('Meta+')
    )
      at(`a Mac's key on every system: ${text(one)}`)
  })

/** Where the config gives a time that isn't the budget's. */
const configLimits = () =>
  walk(CONFIG, (one, at, text) => {
    const key = one.type === 'Property' ? keyOf(one) : undefined
    if (key !== undefined && /timeout$/i.test(key) && !budgeted(one.value as Any)) at(`not the budget's: ${text(one)}`)
  })

test('finds the end-to-end specs', () => {
  expect(specs.length).toBeGreaterThan(40)
  expect(specs).toContain('apps/desktop/e2e/support.ts')
})

test('no end-to-end spec sets a time of its own or sleeps', () => {
  expect(specs.flatMap(limitsIn)).toEqual([])
})

test("no end-to-end spec presses a Mac's key on every system", () => {
  expect(specs.flatMap(macKeysIn)).toEqual([])
})

test('the end-to-end run takes its times from the budget', () => {
  expect(readFileSync(join(root, CONFIG), 'utf8')).toMatch(/timeout: budget\.large/)
  expect(configLimits()).toEqual([])
})
