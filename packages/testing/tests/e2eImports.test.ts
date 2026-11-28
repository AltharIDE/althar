import { existsSync, globSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import { type Node, parseSync } from 'oxc-parser'
import { expect, test } from 'vite-plus/test'

/*
 * No end-to-end spec imports what Node can't load. Playwright loads a spec, and everything it imports, in Node, which
 * has no CSS: a spec that reaches the UI kit's components (`@althar/ui`, `@althar/ui/screens`) or the renderer's
 * modules, which import their styles, fails to load, and every spec run with it fails too (#217). What a spec may take
 * from the kit is what reaches no styles, as `@althar/ui/device`. This follows every end-to-end file's imports through
 * the repository's own files and packages, and finds any that reaches a stylesheet, or anything else only Vite loads (an
 * asset, `?raw`).
 *
 * What a spec does with its times and its keys is lint's, on the spec itself (lint/budget.js, lint/keys.js). This
 * reads across the repository, so a change to what a spec imports breaks it without touching a spec: select.ts runs it
 * with the app's tests whenever a change reaches a spec.
 */

const root = join(import.meta.dirname, '../../..')

type Any = Node & Record<string, unknown>

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

test('finds the end-to-end files', () => {
  expect(e2eFiles.length).toBeGreaterThan(40)
  expect(e2eFiles).toContain('apps/desktop/e2e/support.ts')
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
