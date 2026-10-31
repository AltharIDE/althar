import { existsSync, globSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

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

/*
 * Nor imports what Node can't load. Playwright loads a spec, and everything it imports, in Node, which has no CSS: a
 * spec that reaches the UI kit's components (`@althar/ui`, `@althar/ui/screens`) or the renderer's modules, which import
 * their styles, fails to load, and every spec run with it fails too (#217). What a spec may take from the kit is what
 * reaches no styles, as `@althar/ui/device`. This follows every end-to-end file's imports through the repository's own
 * files and packages, and finds any that reaches a stylesheet, or anything else only Vite loads (an asset, `?raw`).
 */

const e2eFiles = globSync('apps/desktop/e2e/**/*.ts', { cwd: root }).map((file) => file.replaceAll('\\', '/'))

/** What only Vite loads: a stylesheet, an asset, or a Vite query. */
const ONLY_VITE = /\?|\.(css|scss|sass|less|svg|png|jpe?g|gif|webp|woff2?|ttf|mdx?)$/

/** The repository's own packages, by name: their folder, and what each export names. */
const ownPackages = new Map(
  globSync('{apps/*,packages/*,brand}/package.json', { cwd: root }).map((file) => {
    const manifest = JSON.parse(readFileSync(join(root, file), 'utf8')) as { name: string; exports?: Record<string, unknown> }
    return [manifest.name, { folder: dirname(file), exports: manifest.exports ?? {} }] as const
  }),
)

const isFile = (path: string) => existsSync(path) && statSync(path).isFile()

/** Where an import from `from` goes, as a path from the root; undefined for a package outside the repository, such as Node's. */
const resolved = (from: string, specifier: string): string | undefined => {
  if (specifier.startsWith('.')) {
    const at = resolve(root, dirname(from), specifier)
    const found = [at, `${at}.ts`, `${at}.tsx`, join(at, 'index.ts'), join(at, 'index.tsx')].find(isFile)
    return relative(root, found ?? at).replaceAll('\\', '/')
  }
  const [scope = '', name = '', ...rest] = specifier.split('/')
  const own = ownPackages.get(`${scope}/${name}`)
  if (own === undefined) return undefined
  const named = own.exports[rest.length === 0 ? '.' : `./${rest.join('/')}`]
  return typeof named === 'string' ? join(own.folder, named).replaceAll('\\', '/') : `${own.folder}/${rest.join('/')}`
}

/** What a file imports, and so loads: not an import of types alone, which the loader drops. */
const importsOf = (file: string): ReadonlyArray<string> => {
  const found: Array<string> = []
  walk(file, (one) => {
    const source = one.source as Any | null | undefined
    if (source?.type !== 'Literal' || typeof source.value !== 'string') return
    const specifiers = (one.specifiers ?? []) as Array<Any>
    const typesAlone = specifiers.length > 0 && specifiers.every((specifier) => specifier.importKind === 'type')
    if (one.type === 'ImportDeclaration' && one.importKind !== 'type' && !typesAlone) found.push(source.value)
    else if ((one.type === 'ExportNamedDeclaration' || one.type === 'ExportAllDeclaration') && one.exportKind !== 'type')
      found.push(source.value)
    else if (one.type === 'ImportExpression') found.push(source.value)
  })
  return found
}

/** What a file reaches that only Vite loads, as the chain of imports to it; undefined where it reaches none. */
const onlyViteFrom = (() => {
  const known = new Map<string, ReadonlyArray<string> | undefined>()
  const from = (file: string): ReadonlyArray<string> | undefined => {
    if (known.has(file)) return known.get(file)
    // Taken as reaching none while it is followed, so an import back to it ends there.
    known.set(file, undefined)
    let chain: ReadonlyArray<string> | undefined
    for (const specifier of /\.(ts|tsx|mts|js|mjs)$/.test(file) && isFile(join(root, file)) ? importsOf(file) : []) {
      if (ONLY_VITE.test(specifier)) chain = [specifier]
      else {
        const next = resolved(file, specifier)
        const further = next === undefined ? undefined : from(next)
        if (further !== undefined) chain = [specifier, ...further]
      }
      if (chain !== undefined) break
    }
    known.set(file, chain)
    return chain
  }
  return from
})()

/** Where an end-to-end file imports what Node can't load, and through what. */
const onlyViteIn = (file: string) =>
  importsOf(file).flatMap((specifier) => {
    const next = resolved(file, specifier)
    const chain = ONLY_VITE.test(specifier) ? [] : next === undefined ? undefined : onlyViteFrom(next)
    return chain === undefined ? [] : [`${file} imports ${[specifier, ...chain].join(' → ')}, which Node can't load`]
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

test('no end-to-end spec imports what Node can’t load', () => {
  expect(e2eFiles.flatMap(onlyViteIn)).toEqual([])
})

test('finds styles through the UI kit’s components and the renderer, and none through what a spec may use', () => {
  const from = (specifier: string) => onlyViteFrom(resolved('apps/desktop/e2e/support.ts', specifier) ?? '')
  expect(from('@althar/ui')?.at(-1)).toMatch(ONLY_VITE)
  expect(from('@althar/ui/screens')?.at(-1)).toMatch(ONLY_VITE)
  expect(from('../src/renderer/main.tsx')?.at(-1)).toMatch(ONLY_VITE)
  expect(from('@althar/ui/device')).toBeUndefined()
  expect(from('@althar/testing/budget')).toBeUndefined()
})

test('the end-to-end run takes its times from the budget', () => {
  expect(readFileSync(join(root, CONFIG), 'utf8')).toMatch(/timeout: budget\.large/)
  expect(configLimits()).toEqual([])
})
